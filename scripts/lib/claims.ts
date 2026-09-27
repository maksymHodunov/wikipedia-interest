/**
 * Claim check: every number the agent writes (verdict, findings, chat answer) must exist in analysis.json.
 *
 * SKILL.md rule this enforces: cite numbers from the script output only; for a difference, state both numbers.
 * Heuristics (documented in references/metrics.md → "Claim check"):
 *  - dates and years (2024, 2025-09) are ignored; bare integers ≤ 12 are ignored ("3 languages", "12 months")
 *  - "1,431" / "1 431" = 1431; "36,8" / "36.8" = 36.8; k / тис / M / млн multipliers are applied; "1M" as a unit is ignored
 *  - a claim matches a known value within ±0.55 (or ±2.5 % for values ≥ 100, so "~1 400" matches 1 431)
 *  - an explicit sign must match ("+63 %" does not match −63); unsigned numbers match either sign ("fell 63 %")
 *  - a range "78–82 %" is two percentages (the dash is not a minus sign)
 *  - ratios ("4×", "2.3x", "4 times", "в 4 рази") are never in the data: reported under `ratios` — state both numbers
 */
import type { SeriesMetrics } from "./metrics.ts";

export interface Claim { raw: string; value: number; signed: boolean; percent: boolean; ratio?: boolean }
export interface ClaimCheck { checked: number; unverified: string[]; ratios: string[] }
type AnalysisLike = { series: SeriesMetrics[]; ranking?: { score: number }[] };

const MULT: Record<string, number> = { k: 1e3, "тис": 1e3, m: 1e6, "млн": 1e6 };
// Constants the skill itself uses in explanations. Percentages and plain numbers are kept apart:
// a "12 %" claim must match a percentage metric, not some month that happened to have 12 views per 1M.
const CONST_PCT = [10, 15, 30, 40];            // verdict threshold ±10 %, bot-share thresholds
const CONST_NUM = [100, 2.5, 40, 70, 300, 1000]; // index base, spike factor, trust thresholds, volume thresholds
const CONST_RATIO = [2.5, 20];                   // the skill's own rules: spike = 2.5× neighbours, level shift = 20×
// "4×", "2.3x", "4 times", "4-fold", "у 4 рази", "в 2,3 раза", "у 18 разів"
const RATIO_AFTER = /^\s?(×|x(?!\p{L})|times(?!\p{L})|-fold|-кратн|раз(и|ів|а)?(?!\p{L}))/iu;

export function extractNumbers(text: string): Claim[] {
  const t = text
    // year ranges and dates: 2025–26, 2025−26, 2024-2026, 2025-09 (hyphen, en/em dash, or U+2212 minus sign)
    .replace(/(?<![\d.])(?:19|20)\d{2}\s?[-–—−]\s?(?:(?:19|20)\d{2}|\d{2})(?:-\d{2})?(?![\d%])/g, " ")
    .replace(/(?<![\d.,])(?:19|20)\d{2}(?![\d%])/g, " ")
    // ranges: "78–82%" → "78% 82%" (the unit belongs to both; the dash is not a minus), "500–600" → "500; 600"
    .replace(/(\d)\s?[-–—]\s?(\d+(?:[.,]\d+)?)\s?(%|pp\b|п\.\s?п\.)/gu, (_m, a: string, b: string, u: string) => `${a}${u} ${b}${u}`)
    .replace(/(\d)\s?[-–—]\s?(?=\d)/gu, "$1; "); // not a space: "2 094" is one number (thousands separator)
  const re = /(?<![\p{L}\d.,])([-+−–]?)(\d{1,3}(?:[   ,]\d{3})+|\d+)(?:[.,](\d+))?\s?(%|pp\b|п\.\s?п\.|k\b|тис\.?|m\b|млн)?/giu;
  const out: Claim[] = [];
  for (const m of t.matchAll(re)) {
    const [raw, sign, intPart, frac, suffix] = m as unknown as [string, string, string, string | undefined, string | undefined];
    const base = Number(intPart.replace(/[   ,]/g, "") + (frac ? "." + frac : ""));
    if (!Number.isFinite(base)) continue;
    const suf = (suffix ?? "").toLowerCase().replace(".", "");
    const mult = MULT[suf] ?? 1;
    if (mult === 1e6 && base === 1) continue; // "per 1M views" is a unit, not a claim
    const isPct = suf === "%" || suf.startsWith("pp") || suf.startsWith("п");
    const value = (sign && sign !== "+" ? -1 : 1) * base * mult;
    if (!isPct && mult === 1 && RATIO_AFTER.test(t.slice(m.index! + raw.length))) {
      out.push({ raw: `${raw.trim()}×`, value: base, signed: false, percent: false, ratio: true });
      continue;
    }
    if (!isPct && mult === 1 && !frac && Math.abs(value) <= 12) continue;
    out.push({ raw: raw.trim(), value, signed: sign !== "", percent: isPct });
  }
  return out;
}

/** Known values from analysis.json, split into percentages and plain numbers (counts, scores, per-1M rates). */
export function knownNumbers(a: AnalysisLike): { pct: number[]; num: number[] } {
  const pct: number[] = [...CONST_PCT], num: number[] = [...CONST_NUM];
  const add = (to: number[], ...xs: (number | null | undefined)[]) => { for (const x of xs) if (typeof x === "number" && Number.isFinite(x)) to.push(x); };
  for (const s of a.series) {
    add(pct, s.yoy, s.robustGrowth, s.relativeGrowth, s.editionGrowth, s.trendAnnual, s.botShare !== null ? s.botShare * 100 : null, s.spikeShare * 100, s.completeness * 100);
    add(num, s.r2, s.avgMonthlyLast12, s.totalLast12, s.perMillionLast12, s.trust.score, s.months, s.peakMonth?.views);
    add(num, ...s.points.map((p) => p.views), ...(s.perMillionSeries ?? []).map((p) => p.views));
  }
  for (const r of a.ranking ?? []) add(num, r.score);
  return { pct, num };
}

/**
 * Tolerance: percentages may be rounded to whole numbers (−36.8 % → "−37 %"); large counts may be rounded (~2.5 %);
 * small plain numbers (ratios, r², per-1M rates < 10) must be nearly exact — otherwise "2.4x" would match the
 * spike factor 2.5 (regression found in eval 3).
 */
function tolerance(k: number, percent: boolean): number {
  const ak = Math.abs(k);
  if (ak >= 100) return ak * 0.025;
  if (percent || ak >= 10) return 0.55;
  return Math.max(0.05, ak * 0.02);
}

function matches(c: Claim, pools: { pct: number[]; num: number[] }): boolean {
  return (c.percent ? pools.pct : pools.num).some((k) => {
    if (c.signed && c.value !== 0 && k !== 0 && Math.sign(c.value) !== Math.sign(k)) return false;
    return Math.abs(Math.abs(c.value) - Math.abs(k)) <= tolerance(k, c.percent);
  });
}

/**
 * Label check: a sentence that names exactly one analysed language edition must not call it growing when its verdict
 * is flat/declining (or declining when it is growing). Found in eval 3: "Турецька хвиля: єдиний растущий ринок" in a
 * PDF whose own table says tr = flat (+6.7 % is inside the ±10 % band). Conservative on purpose: sentences with two
 * languages, both directions, or a negation ("не зростає", "not growing") are skipped. Works for per-language series.
 */
const LANG_STEMS: Record<string, string[]> = {
  de: ["німец", "german", "deutsch"], fr: ["француз", "french"], es: ["іспан", "spanish", "españ"], pl: ["польськ", "polish"],
  tr: ["турец", "turkish", "türk"], uk: ["українськ", "україномов", "ukrainian"], cs: ["чеськ", "czech"], sk: ["словацьк", "slovak"],
  id: ["індонез", "indonesian"], pt: ["португал", "portugu"], it: ["італ", "italian"], ru: ["російськ", "russian"],
  ja: ["японськ", "japanese"], zh: ["китайськ", "chinese"], ar: ["арабськ", "arabic"], nl: ["нідерланд", "dutch"],
  sv: ["шведськ", "swedish"], ro: ["румунськ", "romanian"], hu: ["угорськ", "hungarian"], ko: ["корейськ", "korean"],
  el: ["грецьк", "greek"], bg: ["болгарськ", "bulgarian"], fi: ["фінськ", "finnish"], da: ["данськ", "danish"],
  he: ["іврит", "hebrew"], fa: ["перськ", "persian"], sr: ["сербськ", "serbian"], hr: ["хорватськ", "croatian"],
  be: ["білоруськ", "belarusian"], ka: ["грузинськ", "georgian"], lt: ["литовськ", "lithuanian"], vi: ["в'єтнам", "vietnamese"],
};
const UP = /(?<!\p{L})(зроста|зріс|зросл|росте|ростуть|растущ|збільшу|підвищу|grow|rising|increas)|[↑📈]/giu;
const DOWN = /(?<!\p{L})(пада|спад|скороч|знижу|знижен|зменшу|впа[вл]|declin|falling|fell|drop|decreas)|[↓📉]/giu;
const NEGATION = /(?<!\p{L})(не|ні|not|no|isn't|doesn't|don't|без)\s+(\p{L}+\s+)?$/iu;

// direction words next to these describe the whole edition, not the series ("despite the platform-wide traffic decline")
const PLATFORM = /(platform|edition|overall|traffic|платформ|видання|загальн|трафік)/iu;

function directions(sentence: string, re: RegExp): number {
  let n = 0;
  for (const m of sentence.matchAll(re)) {
    const i = m.index!;
    if (NEGATION.test(sentence.slice(Math.max(0, i - 25), i))) continue;
    if (PLATFORM.test(sentence.slice(Math.max(0, i - 30), i + m[0].length + 30))) continue;
    n++;
  }
  return n;
}

/**
 * Platform excuse: the verdict uses relativeGrowth, which already removes the edition-wide change, yet small models
 * keep explaining a relative decline by the platform («спадає … через загальну втрату трафіку Вікіпедії», "appears
 * to be a platform-wide effect" — evals 3, 6 and 7). Flagged only when the platform is the object of a causal phrase
 * and the sentence is not about raw numbers ("raw views fell, largely due to the platform-wide decline" is correct).
 */
const EXCUSE = [
  /(due to|because of|driven by|caused by|explained by|result of|reflects?|reflecting|attributable to)[^.;]{0,40}?(platform|wikipedia[- ]wide|edition[- ]wide|overall (wikipedia |edition )?(traffic|decline)|general (traffic|decline)|whole (edition|wikipedia))/iu,
  /(is|are|appears to be|seems to be|looks like|mostly|largely|mainly)\s+(an? |the )?(\p{L}+ )?platform[- ]wide effect/iu,
  /(через|внаслідок|пояснюєт\p{L}*|спричинен\p{L}*|зумовлен\p{L}*|є наслідком|відображає|відбив\p{L}*|вплину\p{L}*|вплива\p{L}*)[^.;]{0,40}?(платформ|загальн\p{L}* (втрат|падінн|спад|зниженн|скороченн)|(всієї|усієї) Вікіпеді|(всього|усього) розділу|трафік\p{L}* (в |у )?Вікіпеді)/iu,
  /(це|є|схоже на|переважно|здебільшого)\s+(\p{L}+\s+)?(ефект|вплив)\p{L}* платформ/iu,
];
const RAW_CONTEXT = /(raw|absolute|removes|already removed|сир\p{L}*|абсолютн|без поправки|вже враховано|уже враховано|прибира|видаля)/iu;
// trust is a 0–100 score, not a percentage: "100% довіра", "trust high (90%)" (iterations 1 and 8; the number itself
// passes the claim check because completeness is 100 %)
const TRUST_PCT = /\d+(?:[.,]\d+)?\s?%\s*(trust|confidence|довір\p{L}*)|(trust|confidence|довір\p{L}*)(\s+\p{L}+)?\s*[(:]?\s*\d+(?:[.,]\d+)?\s?%/iu;

export function checkLabels(text: string, series: { lang: string; verdict: { label: SeriesMetrics["verdict"]["label"]; basis: string } }[]): string[] {
  const problems: string[] = [];
  for (const raw of text.split(/(?<=[.!?;])\s+|\n+|\|/)) {
    const m = TRUST_PCT.exec(raw);
    if (m) problems.push(`"${m[0]}" writes trust as a percentage — trust is a 0–100 score: "trust high (90)", «довіра висока (90)»`);
  }
  if (series.some((s) => /share of edition views/.test(s.verdict?.basis ?? ""))) {
    for (const raw of text.split(/(?<=[.!?;])\s+|\n+/)) {
      const sentence = raw.trim();
      if (sentence && EXCUSE.some((re) => re.test(sentence)) && !RAW_CONTEXT.test(sentence)) {
        problems.push(`"${sentence.slice(0, 90)}" explains the decline by the platform, but the verdict uses the topic's share of views, which already removes the edition-wide change — the topic lost share within Wikipedia; only raw views include the platform effect`);
      }
    }
  }
  const byLang = new Map(series.map((s) => [s.lang, s]));
  if (byLang.size < series.length) return problems; // several topics per language: sentences name topics, not languages
  for (const raw of text.split(/(?<=[.!?;])\s+|\n+|\|/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const low = sentence.toLowerCase();
    const named = [...byLang.keys()].filter((l) =>
      (LANG_STEMS[l] ?? []).some((stem) => low.includes(stem)) || new RegExp(`(^|[\\s(])${l}(:|\\))`).test(low));
    if (named.length !== 1) continue;
    const s = byLang.get(named[0]!)!;
    const up = directions(sentence, UP), down = directions(sentence, DOWN);
    if (up && down) continue;
    const label = s.verdict.label;
    if (up && label !== "growing") problems.push(`"${sentence.slice(0, 90)}" says ${s.lang} is growing, but its verdict is ${label} (${s.verdict.basis})`);
    if (down && label === "growing") problems.push(`"${sentence.slice(0, 90)}" says ${s.lang} is declining, but its verdict is growing (${s.verdict.basis})`);
  }
  return problems;
}

/**
 * Language check: the answer and the report must be in ONE language — the user's.
 *  - uk: flag Russian forms small models mix in ("растет", "Википедия"): Russian-only letters (ы э ъ ё), Russian-only
 *    endings (-ия/-ии/-ию/-ией, -ость, -уется/-ается/-яется, -тся without ь) and frequent Russian words seen in testing.
 *  - any language except en: flag tool terms copied untranslated from analyze.ts output (flat, growing, YoY, views…).
 * Article titles from the analysis are removed first — they are proper names in their own language.
 * Heuristic by design: low false-positive rate on real answers, not a full language identifier.
 */
const RU_WORDS = /(?<!\p{L})(растет|растут|растущ\p{L}*|растуч\p{L}*|рост|меньш\p{L}*|больш\p{L}*|лучш\p{L}*|всего|прокси|википеди\p{L}*|также|котор\p{L}*|если|чтобы|только|сейчас|однако|исключ\p{L}*|нужно|можно|очень|сегодня|что|как|или|и|еще|сниж\p{L}*|падени\p{L}*|увелич\p{L}*|интерес\p{L}*|статья|статьи|статью|пользоват\p{L}*|приложени\p{L}*|трафик\p{L}*|аналитик\p{L}*|мобильн\p{L}*|стабильн\p{L}*|английск\p{L}*|испанск\p{L}*|немецк\p{L}*|французск\p{L}*|польск\p{L}*|турецк\p{L}*|чешск\p{L}*|украинск\p{L}*|сравнени\p{L}*)(?!\p{L})/giu;
const RU_LETTERS = /\p{L}*[ыэъёЫЭЪЁ]\p{L}*/gu;
const RU_ENDINGS = /(?<!\p{L})\p{Script=Cyrillic}{3,}(ия|ии|ию|ией|ость|остью|уется|ается|яется)(?!\p{L})|(?<!\p{L})\p{Script=Cyrillic}+(ськую|цькую)(?!\p{L})|(?<!\p{L})\p{Script=Cyrillic}{2,}[^ь\P{Script=Cyrillic}]тся(?!\p{L})/giu;
const TOOL_TERMS = /(?<![\p{L}-])(flat|growing|declining|insufficient-data|trust|high|medium|low|yoy|views|verdict|relativegrowth|robustgrowth|editiongrowth|permillion|botshare|spikemonths)(?![\p{L}-])/giu;
const TOOL_TERMS_SET = new Set(["flat", "growing", "declining", "insufficient-data", "trust", "high", "medium", "low", "yoy", "views", "verdict"]);
const UK_FOR: Record<string, string> = {
  flat: "без змін", growing: "зростає", declining: "спадає", "insufficient-data": "мало даних", trust: "довіра",
  high: "висока", medium: "середня", low: "низька", yoy: "р/р", views: "переглядів", verdict: "висновок",
  relativegrowth: "відносна зміна", robustgrowth: "зміна переглядів", editiongrowth: "зміна всього розділу",
  permillion: "на 1 млн переглядів", botshare: "частка ботів", spikemonths: "місяці-сплески",
};

// language codes are fine in any text ("uk · Фінансова грамотність", "kk: немає статті")
const LANG_CODES = new Set([...Object.keys(LANG_STEMS), "en", "kk", "rm", "no", "nb", "lv", "et", "sl", "hi", "th", "ms", "ca", "eu", "gl", "az", "uz", "hy"]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function checkLanguage(text: string, lang: string, properNames: string[] = []): string[] {
  // template placeholders, code, links, file paths and the skill's own name are not prose
  let t = text.replace(/\{[a-z]+\}/g, " ").replace(/wikipedia-interest/gi, " ")
    .replace(/`[^`]*`/g, " ").replace(/\]\([^)]*\)/g, "] ").replace(/https?:\/\/\S+/g, " ").replace(/(?:[\w.-]*\/)+[\w.-]+/g, " ");
  // article titles and topic names are proper names in their own language (any capitalisation)
  for (const n of [...properNames].sort((a, b) => b.length - a.length)) if (n.length > 1) t = t.replace(new RegExp(escape(n), "giu"), " ");
  const problems: string[] = [];
  const add = (kind: string, words: string[]) => {
    const uniq = [...new Set(words.map((w) => w.trim()).filter(Boolean))];
    if (uniq.length) problems.push(`${kind}: ${uniq.slice(0, 8).map((w) => `"${w}"`).join(", ")}`);
  };
  if (lang === "uk") {
    // calques from Russian built from real Ukrainian words — only in the phrases where they are wrong
    add("Russian calques — «доля» here means fate: write «частка»", [...t.matchAll(/(?<!\p{L})(відносна\s+)?дол[яіюею]\p{L}*(?=\s+(інтерес|перегляд|трафік|бот|ринк|аудитор|статт))/giu)].map((m) => m[0]));
    add("Russian calque «на …ській мові» / «на французькому» — write «…ською мовою» / «французькою»", [
      // -ський / -цький / -зький: англійській, німецькій, французькій
      ...[...t.matchAll(/(?<!\p{L})на\s+\p{L}+(с|ц|з)ькій\s+мові(?!\p{L})/giu)].map((m) => m[0]),
      // "шукати інформацію на французькому," — but "на французькому ринку" is correct, so only at the end of a phrase
      ...[...t.matchAll(/(?<!\p{L})на\s+\p{L}+(с|ц|з)ькому(?=\s*[,.;:!?)]|\s*$)/gimu)].map((m) => m[0]),
    ]);
    add("calques — a Wikipedia article is «стаття» (артикль is grammar); «цілеуказ…» is not Ukrainian", [...t.matchAll(/(?<!\p{L})(артикл\p{L}*|цілеуказ\p{L}*)/giu)].map((m) => m[0]));
    add("Russian words in Ukrainian text — rewrite in Ukrainian (e.g. растет → зростає, Википедия → Вікіпедія)", [
      ...[...t.matchAll(RU_LETTERS)].map((m) => m[0]),
      ...[...t.matchAll(RU_WORDS)].map((m) => m[0]),
      ...[...t.matchAll(RU_ENDINGS)].map((m) => m[0]),
    ]);
  }
  if (lang === "uk") {
    // "Wikipedia" in Latin letters mixes scripts in Ukrainian prose (Polish/Spanish/German spell it "Wikipedia" correctly)
    add("Latin \"Wikipedia\" in Ukrainian text — write «Вікіпедія»", [...t.matchAll(/(?<![\p{L}.])wikipedi\p{L}*/giu)].map((m) => m[0]));
    // other words in Latin letters: "interesse", "keyword volumes", "vs", "landing page" (evals 7). Capitalised words
    // are names (Google Trends, ChatGPT) and are kept; tool terms are reported below with their translation.
    // quoted text is exempt: search keywords in the target language ("apprendre l'anglais") are quoted on purpose
    const unquoted = t.replace(/"[^"\n]*"|«[^»\n]*»|“[^”\n]*”|„[^“”\n]*[“”]/g, " ");
    add("words in Latin letters in Ukrainian text — write them in Ukrainian (vs → проти, keyword → ключові слова, landing page → цільова сторінка)",
      [...unquoted.matchAll(/(?<![\p{L}\d_.\/\\@#'’-])[a-z][a-z'’-]*[a-z](?![\p{L}\d_\/\\@-])(?!\.\p{L})/gu)].map((m) => m[0])
        .filter((w) => !LANG_CODES.has(w) && !/^wikipedi/.test(w) && !TOOL_TERMS_SET.has(w)));
  }
  if (lang !== "en") {
    const terms = [...t.matchAll(TOOL_TERMS)].map((m) => m[0]);
    if (terms.length) {
      const hint = lang === "uk" ? ` (${[...new Set(terms.map((x) => x.toLowerCase()))].map((x) => `${x} → ${UK_FOR[x]}`).join(", ")})` : "";
      add(`untranslated tool terms — write them in the user's language${hint}`, terms);
    }
  }
  return problems;
}

export function checkClaims(text: string, a: AnalysisLike): ClaimCheck {
  const known = knownNumbers(a);
  const claims = extractNumbers(text);
  const ratios = claims.filter((c) => c.ratio && !CONST_RATIO.some((k) => Math.abs(k - c.value) < 0.01));
  const plain = claims.filter((c) => !c.ratio);
  return {
    checked: claims.length,
    unverified: [...new Set(plain.filter((c) => !matches(c, known)).map((c) => c.raw))],
    ratios: [...new Set(ratios.map((c) => c.raw))],
  };
}
