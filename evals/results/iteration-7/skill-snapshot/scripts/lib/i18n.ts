/**
 * Report localisation. Every string the code puts into a PDF comes from here, so a report is in one language:
 * the agent writes title/verdict/findings in the user's language and passes the same language as --lang.
 *
 * Built-in: en, uk. Any other language: `report.ts --labels-template` prints the English labels as JSON, the agent
 * translates the values (keeping {placeholders}) and passes the file with --labels.
 */
export const LABEL_KEYS = [
  "title", "subtitle",
  "colSeries", "colViews", "colPer1M", "colRel", "colRaw", "colEdition", "colVerdict", "colTrust",
  "colTotal12", "colMedYoY", "colNaiveYoY", "colTrend",
  "verdict_growing", "verdict_flat", "verdict_declining", "verdict_insufficient",
  "trust_high", "trust_medium", "trust_low",
  "chartTitle", "chartSubtitle", "chartTitleAbsolute", "chartSubtitleAbsolute", "chartYAbsolute",
  "findings", "caveats",
  "cav_curiosity", "cav_human", "cav_relative", "cav_perMillion", "cav_basket", "cav_excluded", "cav_search",
  "footer", "draft_verdict_growing", "draft_verdict_none", "draft_finding",
] as const;
export type LabelKey = (typeof LABEL_KEYS)[number];
export type Labels = Record<LabelKey, string>;

const en: Labels = {
  title: "{topics}: Wikipedia interest ({langs})",
  subtitle: "Wikimedia Pageviews API · {period} · monthly human (non-bot) views, all platforms",
  colSeries: "Edition · article", colViews: "Views/mo", colPer1M: "Per 1M", colRel: "Rel. YoY", colRaw: "Raw YoY",
  colEdition: "Wiki YoY", colVerdict: "Verdict", colTrust: "Trust",
  colTotal12: "Total 12m", colMedYoY: "Med. YoY", colNaiveYoY: "Naive YoY", colTrend: "Trend/yr",
  verdict_growing: "growing", verdict_flat: "flat", verdict_declining: "declining", verdict_insufficient: "too little data",
  trust_high: "high", trust_medium: "medium", trust_low: "low",
  chartTitle: "Interest over time (median month = 100)",
  chartSubtitle: "{period} · human views; each line is rebased to its own median month · ○ = spike month",
  chartTitleAbsolute: "Views per 1M views of the edition",
  chartSubtitleAbsolute: "{period} · human (non-bot) views per 1M views of the whole language edition · ○ = spike month",
  chartYAbsolute: "per 1M edition views",
  findings: "Findings",
  caveats: "Assumptions & limits",
  cav_curiosity: "Pageviews measure curiosity, not willingness to pay; validate promising directions with a landing page or an ads test.",
  cav_human: "Human traffic only; undetected bots may remain. Spike months are marked; median-based growth ignores them.",
  cav_relative: "Rel. YoY = change of the topic's share of all views in that edition; it assumes the edition-wide change (Wiki YoY) affects all topics equally.",
  cav_perMillion: "Per 1M = views per million views of the edition: fair across editions, but a small edition can look ‘hotter’ while being tiny in absolute terms.",
  cav_basket: "One article per topic; a broad topic (such as a course) deserves a basket of related articles.",
  cav_excluded: "No article on the topic in: {list}. Wikipedia cannot measure interest there; this is not proof of low demand.",
  cav_search: "Matched by text search, check that it is the topic: {list}.",
  footer: "Sources: {sources}. Generated {date} by the wikipedia-interest skill.",
  draft_verdict_growing: "{name} shows the strongest trustworthy growth.",
  draft_verdict_none: "No series is growing in this period.",
  draft_finding: "{name}: {verdict}, share of views {rel} YoY, {views} views/month, trust {trust}.",
};

const uk: Labels = {
  title: "{topics}: інтерес у Вікіпедії ({langs})",
  subtitle: "Wikimedia Pageviews API · {period} · помісячні перегляди людьми (без ботів), усі платформи",
  colSeries: "Розділ · стаття", colViews: "На місяць", colPer1M: "На 1 млн", colRel: "Відн. р/р", colRaw: "Сирі р/р",
  colEdition: "Вікі р/р", colVerdict: "Висновок", colTrust: "Довіра",
  colTotal12: "За 12 міс", colMedYoY: "Медіана р/р", colNaiveYoY: "Сума р/р", colTrend: "Тренд/рік",
  verdict_growing: "зростає", verdict_flat: "без змін", verdict_declining: "спадає", verdict_insufficient: "мало даних",
  trust_high: "висока", trust_medium: "середня", trust_low: "низька",
  chartTitle: "Динаміка інтересу (медіанний місяць = 100)",
  chartSubtitle: "{period} · перегляди людьми; кожну лінію зведено до її медіанного місяця · ○ = місяць-сплеск",
  chartTitleAbsolute: "Перегляди на 1 млн переглядів розділу",
  chartSubtitleAbsolute: "{period} · перегляди людьми (без ботів) на 1 млн усіх переглядів мовного розділу · ○ = місяць-сплеск",
  chartYAbsolute: "на 1 млн переглядів розділу",
  findings: "Висновки",
  caveats: "Припущення й обмеження",
  cav_curiosity: "Перегляди Вікіпедії показують цікавість, а не готовність платити; перспективні напрями варто перевірити лендингом або рекламним тестом.",
  cav_human: "Враховано лише перегляди людьми; частина неявних ботів могла лишитися. Місяці-сплески позначено, а медіанне зростання їх не враховує.",
  cav_relative: "Відн. р/р — зміна частки теми серед усіх переглядів мовного розділу; припускаємо, що загальна зміна розділу (Вікі р/р) зачіпає всі теми однаково.",
  cav_perMillion: "«На 1 млн» — перегляди на мільйон переглядів розділу: так чесно порівнювати різні мови, але малий розділ може виглядати «гарячішим», хоча в абсолютних числах він невеликий.",
  cav_basket: "Одна стаття на тему; для широкої теми (наприклад, курсу) краще брати кілька пов’язаних статей.",
  cav_excluded: "Немає статті на цю тему в розділах: {list}. Там Вікіпедія не може виміряти інтерес; це не доказ низького попиту.",
  cav_search: "Статтю знайдено текстовим пошуком, перевірте, що це саме та тема: {list}.",
  footer: "Джерела: {sources}. Згенеровано {date} скілом wikipedia-interest.",
  draft_verdict_growing: "Найсильніше надійне зростання: {name}.",
  draft_verdict_none: "За цей період жоден ряд не зростає.",
  draft_finding: "{name}: {verdict}, частка переглядів {rel} р/р, {views} переглядів/міс, довіра {trust}.",
};

export const BUILT_IN: Record<string, Labels> = { en, uk };

const PLACEHOLDER = /\{[a-z]+\}/g;

/** Validate a labels file produced by the agent: every key present, a string, same {placeholders} as English. */
export function validateLabels(raw: unknown): { labels?: Labels; problems: string[] } {
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null) return { problems: ["labels file must be a JSON object"] };
  const obj = raw as Record<string, unknown>;
  for (const k of LABEL_KEYS) {
    const v = obj[k];
    if (typeof v !== "string" || !v.trim()) { problems.push(`missing or empty label "${k}"`); continue; }
    const want = (en[k].match(PLACEHOLDER) ?? []).sort().join(",");
    const got = (v.match(PLACEHOLDER) ?? []).sort().join(",");
    if (want !== got) problems.push(`label "${k}" must keep the placeholders ${want || "(none)"}, got ${got || "(none)"}`);
  }
  return problems.length ? { problems } : { labels: obj as Labels, problems };
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (m) => {
    const k = m.slice(1, -1);
    return k in vars ? String(vars[k]) : m;
  });
}

/**
 * Guess the language of the agent's text when --lang is missing. Deliberately conservative:
 * Ukrainian letters → uk; plain ASCII → en; anything else → null (the caller must ask for --lang).
 */
export function detectLang(text: string): string | null {
  if (/[іїєґІЇЄҐ]/.test(text)) return "uk";
  if (/[Ѐ-ӿ]/.test(text)) return null;
  if (/^[\x00-\x7F’‘“”–—…·×]*$/.test(text)) return "en";
  return null;
}

/** Locale-aware number formatting: 27 791 and 4,2 for uk; 27,791 and 4.2 for en. */
export function numberFormat(lang: string, opts: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  try { return new Intl.NumberFormat(lang, opts); } catch { return new Intl.NumberFormat("en", opts); }
}
