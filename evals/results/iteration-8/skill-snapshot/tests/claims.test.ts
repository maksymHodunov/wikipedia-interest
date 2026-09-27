import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClaims, checkLabels, checkLanguage, extractNumbers } from "../scripts/lib/claims.ts";
import { computeMetrics } from "../scripts/lib/metrics.ts";

// 12 months at 1182 views, then 12 months at 437 — the medians of the real uk/Астрономія series
const user = Array.from({ length: 24 }, (_, i) => ({ month: new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 7), views: i < 12 ? 1182 : 437 }));

test("extractNumbers: percent, signs, thousands, decimals, multipliers; ignores dates, years, small counts, '1M'", () => {
  const got = extractNumbers("У 2025-09 (2025 рік) uk: −63% р/р, 1 431 переглядів, 36,8%, +12.5%, 1,431 views, ~1.4k, 3 мови, per 1M views, 47% ботів").map((c) => c.value);
  assert.deepEqual(got, [-63, 1431, 36.8, 12.5, 1431, 1400, 47]);
});

test("small plain numbers must be nearly exact (regression: '2.4x' matched the spike factor 2.5)", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user });
  assert.deepEqual(checkClaims("R² = 0.7 у 2.4 рази вище", { series: [m] }).unverified, ["0.7"]);
  assert.deepEqual(checkClaims("спайк = 2.5× медіани; R² = " + m.r2, { series: [m] }).unverified, []);
  assert.deepEqual(checkClaims("−63% (округлено з −63.0%)", { series: [m] }).unverified, []);
});

test("extractNumbers ignores year ranges (regression: 'in 2025–26' was read as −26)", () => {
  assert.deepEqual(extractNumbers("traffic fell in 2025–26, 2024-2026 and 2024 — 25%").map((c) => c.value), [25]);
  // regression (iteration 4): Haiku wrote the range with U+2212 MINUS SIGN
  assert.deepEqual(extractNumbers("у 2025\u221226 (−22%)").map((c) => c.value), [-22]);
});

test("checkClaims: exact and rounded values pass; invented numbers and wrong signs fail", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user });
  const a = { series: [m] };
  assert.equal(m.robustGrowth, -63);
  assert.deepEqual(checkClaims("Інтерес впав на 63% (−63%), ~440 переглядів на місяць.", a).unverified, []);
  assert.deepEqual(checkClaims("Інтерес зріс на +63% і на 45%.", a).unverified, ["+63%", "45%"]);
});

test("checkClaims: a percentage never matches a monthly count/rate (regression: '12%' matched a month with 12 views per 1M)", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user, projectTotal: user.map((p) => ({ month: p.month, views: 1e8 })) });
  assert.ok(m.perMillionSeries!.some((p) => Math.abs(p.views - 11.82) < 0.01), "fixture has a per-1M value ≈ 11.8");
  assert.deepEqual(checkClaims("Інтерес виріс на 12% у вересні", { series: [m] }).unverified, ["12%"]);
  assert.deepEqual(checkClaims("11.8 переглядів на 1M", { series: [m] }).unverified, []);
});

test("checkLabels flags 'growing' for a flat series and respects negation, two-language sentences and consistent labels", () => {
  const series = [
    { lang: "tr", verdict: { label: "flat" as const, basis: "no clear change — +7% is inside the ±10% noise band" } },
    { lang: "fr", verdict: { label: "declining" as const, basis: "share −13%" } },
    { lang: "id", verdict: { label: "declining" as const, basis: "share −15%" } },
  ];
  // regression: the iteration-3 PDF verdict and finding
  assert.equal(checkLabels("Турецька хвиля: єдиний растущий ринок.", series).length, 1);
  assert.equal(checkLabels("Турецька вікіпедія — єдина країна, де інтерес до англійської ЗРОСТАЄ (на +7% YoY).", series).length, 1);
  assert.equal(checkLabels("tr: interest is growing (+7%)", series).length, 1);
  // not flagged
  assert.deepEqual(checkLabels("Інтерес у турецькій Вікіпедії не зростає: +7% у межах шуму.", series), []);
  assert.deepEqual(checkLabels("Французька показує найсильніше скорочення (−13%).", series), []);
  assert.deepEqual(checkLabels("Chess is growing in Turkish but declining in Indonesian.", series), []);
  assert.deepEqual(checkLabels("Простий висновок: турецька аудиторія стабільна.", series), []);
  // regression (false positive in iteration-1 eval 4): the decline word describes the platform, not the series
  assert.deepEqual(checkLabels("Chess is gaining relative share in Turkish Wikipedia despite the platform-wide traffic decline.",
    [{ lang: "tr", verdict: { label: "growing", basis: "" } }]), []);
  // multi-topic, single-language runs are skipped (sentences name topics, not languages)
  assert.deepEqual(checkLabels("Українська: зростає", [{ lang: "uk", verdict: { label: "flat", basis: "" } }, { lang: "uk", verdict: { label: "flat", basis: "" } }]), []);
});

test("checkLanguage (uk) catches the Russian and English leaks seen in real Haiku answers, and passes clean Ukrainian", () => {
  const leaks = [
    "Claude Code растет 112% англійська, 399% іспанська.",   // user's PM test, report verdict
    "Турецька Wikipedia — ЄДИНА РАСТУЧА МОВА",               // eval 3, iteration 3
    "Турецька хвиля: єдиний растущий ринок.",                // eval 3 PDF verdict
    "Аналіз інтересу до фотографії в Польщі на основі Википедии", // PM sandbox dry run
    "**Исключена**: На словацькій Вікіпедії немає статті",   // eval 5
    "Чому обрати чеськую: більше переглядів",                // trigger test
    "Англійська: Copilot flat -6%, AI growing +12%.",        // user's PM test, report verdict
    "Іспанська має найбільшу аудиторію (26K views/місяць)",  // eval 3
  ];
  for (const s of leaks) assert.notDeepEqual(checkLanguage(s, "uk", ["Claude Code", "Copilot"]), [], s);
  const clean = [
    "Інтерес до астрономії в україномовній Вікіпедії спадає: частка переглядів −47% р/р, довіра висока (80).",
    "Рекомендую спершу перевірити попит лендингом. Інтерес продовжує рости в турецькому розділі, а в польському — ні.",
    "Мости, хвости й пости — звичайні українські слова, як і «знаходиться», «дякую» та «статей».",
    "Стаття en · Integrated development environment: без змін (−6,5%).",
  ];
  for (const s of clean) assert.deepEqual(checkLanguage(s, "uk", ["Integrated development environment"]), [], s);
  // for other languages only untranslated tool terms are flagged; English is never checked
  assert.deepEqual(checkLanguage("Zainteresowanie jest flat", "pl").length, 1);
  assert.deepEqual(checkLanguage("Interest is flat, trust high", "en"), []);
});

test("checkLanguage (uk) flags Russian calques only in the phrases where they are wrong", () => {
  assert.notDeepEqual(checkLanguage("Відносна доля інтересу практично не змінилась", "uk"), []);  // seen in testing
  assert.notDeepEqual(checkLanguage("детальне пояснення на українській мові", "uk"), []);          // seen in testing
  assert.deepEqual(checkLanguage("Така вже доля цього розділу; звіт українською мовою.", "uk"), []);
});

test("titleMatches: topic words must be in the article title (regression: 'Claude Code' → 'Claude (AI)')", async () => {
  const { titleMatches } = await import("../scripts/lib/resolve.ts");
  assert.equal(titleMatches("Claude Code", "Claude (AI)"), false);
  assert.equal(titleMatches("Python", "Python (programming language)"), true);
  assert.equal(titleMatches("Electric cars", "Electric car"), true);
  assert.equal(titleMatches("Intermittent fasting", "Intermittent fasting"), true);
  assert.equal(titleMatches("GitHub Copilot", "GitHub Copilot"), true);
});

test("ratios are never in the data: '4×', '2.3x', '18 times', 'в 4 рази' (evals 7: three of four scenarios)", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user });
  const r = checkClaims("ChatGPT has 4× the traffic, 2.3x the audience, 18 times more views; майже в 4 рази більше, у 2,5 раза", { series: [m] });
  assert.deepEqual(r.ratios, ["4×", "2.3×", "18×"]);
  assert.deepEqual(r.unverified, []);
  // the skill's own rules are not claims: spike = 2.5× neighbours, level shift = 20×
  assert.deepEqual(checkClaims("місяць > 2.5× сусідніх; стрибок понад 20×", { series: [m] }).ratios, []);
});

test("a range is two percentages, not a minus sign (regression: '78–82%/year' left 78 unverified)", () => {
  assert.deepEqual(extractNumbers("fell 78–82%/year").map((c) => [c.value, c.percent, c.signed]), [[78, true, false], [82, true, false]]);
  assert.deepEqual(extractNumbers("видання втратили 8–13% в році").map((c) => c.value), [8, 13]);
  assert.deepEqual(extractNumbers("between 500-600 views and +10–15%").map((c) => c.value), [500, 600, 10, 15]);
  assert.deepEqual(extractNumbers("спадає на -21% р/р").map((c) => c.value), [-21]);
});

test("Ukrainian: words in Latin letters, Russian spellings and calques are flagged; names, codes and paths are not", () => {
  const p = checkLanguage("тому interesse не можна виміряти; 133 vs 30; перевірте keyword volumes і landing page", "uk");
  assert.ok(p.some((x) => x.includes('"interesse"') && x.includes('"vs"') && x.includes('"keyword"') && x.includes('"landing"')), p.join("\n"));
  assert.ok(checkLanguage("при меньших темпах падіння", "uk").some((x) => x.includes("меньших")));
  assert.ok(checkLanguage("немає артиклю про фінансову грамотність", "uk").some((x) => x.includes("артиклю")));
  const clean = "Французька (fr · Course à pied) — 2 094 переглядів; перевірте Google Trends і ChatGPT. Файл: `out/running/report.pdf`, " +
    "дані: wikimedia.org/api/rest_v1, розділи uk, kk, de, rm; course à pied; R² = 0,2; A/B-тест; SEO.";
  assert.deepEqual(checkLanguage(clean, "uk", ["Course à pied", "Running"]), []);
});

test("platform excuse: a relative decline must not be blamed on the platform (evals 3, 6, 7)", () => {
  const rel = [{ lang: "fr", verdict: { label: "declining" as const, basis: "share of edition views −21% YoY — the edition-wide change (−10%) is already removed; raw views −28%" } }];
  for (const bad of [
    "Інтерес до бігу спадає на всіх платформах через загальну втрату трафіку Вікіпедії.",
    "The 2-year sharp decline appears to be recent platform-wide effect (Wikipedia traffic dropped overall).",
    "The drop is mostly due to the platform-wide decline.",
  ]) assert.equal(checkLabels(bad, rel).length, 1, bad);
  for (const ok of [
    "Chess is gaining relative share despite the platform-wide traffic decline.",
    "Raw views fell 28%, largely due to the platform-wide decline; the share removes that effect.",
    "Усі видання втратили людський трафік (uk −28%) через AI-пошук.",
    "Відносна частка вже враховує спад усього розділу, тож падіння — саме теми.",
  ]) assert.deepEqual(checkLabels(ok, rel), [], ok);
  // without relative growth (--no-normalize) there is nothing to blame on
  assert.deepEqual(checkLabels("The drop is mostly due to the platform-wide decline.", [{ lang: "fr", verdict: { label: "declining", basis: "median monthly views −28% YoY" } }]), []);
});
