/**
 * The sentences analyze.ts writes about each series — trust reasons and the verdict basis — in every built-in
 * language. metrics.ts records { key, vars }; English text goes into analysis.json, and `analyze.ts --lang uk`
 * prints the same notes in Ukrainian so the model copies them instead of translating ("small numbers swing wildly"
 * came back as «малі числа коливаються дико» in testing).
 */
import { fill } from "./i18n.ts";

export type NoteKey =
  | "levelShift" | "matchLow" | "matchMedium" | "lateStart" | "months6" | "months12" | "months24" | "gaps"
  | "spikesMany" | "spikesSome" | "spikeDriven" | "bots40" | "bots30" | "bots15" | "noisy" | "lowVolume" | "rawVsRelative"
  | "basisRelative" | "basisMedian" | "basisTrend" | "basisNone" | "basisShift" | "flat";
export interface Note { key: NoteKey; vars?: Record<string, string | number>; inner?: Note }

const en: Record<NoteKey, string> = {
  levelShift: "the article jumped from ~{from} to ~{to} views/month around {month} — it was probably created, renamed or merged then, so growth describes the article's history, not interest",
  matchLow: "article was found by text search with no interlanguage link to the topic — probably a different subject",
  matchMedium: "article was found by text search, not by an interlanguage link — check it really is the topic",
  lateStart: "data starts {first}, {months} months after the requested start — article was created or renamed then (views under an old title are not counted)",
  months6: "only {months} months of data (<6: no trend can be fitted)",
  months12: "only {months} months of data (<12: no year-over-year comparison)",
  months24: "{months} months of data (<24: seasonality not separable from trend)",
  gaps: "gaps in data ({pct}% of months present)",
  spikesMany: "{pct}% of months are spikes — interest is event-driven, not steady",
  spikesSome: "some spike months ({pct}%)",
  spikeDriven: "headline growth disappears when spikes are removed (median-based growth disagrees)",
  bots40: "very high automated traffic ({pct}% of views are bots) — human counts may be contaminated too",
  bots30: "high automated traffic ({pct}% of views are bots)",
  bots15: "notable automated traffic ({pct}%)",
  noisy: "trend is noisy (R²={rsq}) — direction is not consistent month to month",
  lowVolume: "low volume ({n} views/month) — small numbers swing wildly",
  rawVsRelative: "raw ({raw}%) and relative ({rel}%) growth point in opposite directions — the verdict rests on adjusting for the edition-wide trend ({ed}%)",
  basisRelative: "share of edition views {rel} YoY — the edition-wide change ({ed}) is already removed; raw views {raw}",
  basisMedian: "median monthly views {raw} YoY",
  basisTrend: "trend {g}/yr",
  basisNone: "fewer than 24 months and no fittable trend",
  basisShift: "not comparable: the article changed around {month} (~{from} → ~{to} views/month: created, renamed or merged)",
  flat: "no clear change — {g} is inside the ±10% noise band ({inner})",
};

const uk: Record<NoteKey, string> = {
  levelShift: "перегляди статті стрибнули з ~{from} до ~{to} на місяць близько {month} — імовірно, тоді її створили, перейменували або об'єднали, тож зростання описує історію статті, а не інтерес",
  matchLow: "статтю знайдено текстовим пошуком без міжмовного посилання на тему — імовірно, це інший предмет",
  matchMedium: "статтю знайдено текстовим пошуком, а не за міжмовним посиланням — перевірте, що це саме ця тема",
  lateStart: "дані починаються з {first}, на {months} міс. пізніше за початок періоду — тоді статтю створили або перейменували (перегляди під старою назвою не враховано)",
  months6: "лише {months} міс. даних (менше 6: тренд не побудувати)",
  months12: "лише {months} міс. даних (менше 12: порівняння рік до року неможливе)",
  months24: "{months} міс. даних (менше 24: сезонність не відокремити від тренду)",
  gaps: "пропуски в даних (є {pct}% місяців)",
  spikesMany: "{pct}% місяців — сплески: інтерес тримається на подіях, а не стабільний",
  spikesSome: "є місяці-сплески ({pct}%)",
  spikeDriven: "без місяців-сплесків зростання зникає (зміна за медіаною його не підтверджує)",
  bots40: "дуже багато автоматичного трафіку ({pct}% переглядів — боти) — навіть людські перегляди можуть бути неточні",
  bots30: "багато автоматичного трафіку ({pct}% переглядів — боти)",
  bots15: "помітна частка автоматичного трафіку ({pct}%)",
  noisy: "тренд нестабільний (R²={rsq}) — напрям змінюється з місяця в місяць",
  lowVolume: "малий обсяг (переглядів на місяць: {n}) — малі числа сильно коливаються",
  rawVsRelative: "сирі ({raw}%) і відносні ({rel}%) зміни мають протилежний напрям — висновок тримається на поправці на зміну всього розділу ({ed}%)",
  basisRelative: "частка в переглядах розділу {rel} р/р — зміну всього розділу ({ed}) уже враховано; сирі перегляди {raw}",
  basisMedian: "медіанні місячні перегляди {raw} р/р",
  basisTrend: "тренд {g} на рік",
  basisNone: "менше 24 місяців, і тренд не побудувати",
  basisShift: "порівнювати не можна: стаття змінилася близько {month} (~{from} → ~{to} на місяць: створення, перейменування або об'єднання)",
  flat: "явної зміни немає — {g} у межах шуму ±10% ({inner})",
};

export const NOTES: Record<string, Record<NoteKey, string>> = { en, uk };

/** Render a note in `lang` (English when the language has no built-in notes); decimals use a comma in uk. */
export function renderNote(n: Note, lang = "en"): string {
  const t = NOTES[lang] ?? en;
  const comma = lang !== "en" && NOTES[lang] !== undefined;
  const vars = Object.fromEntries(Object.entries(n.vars ?? {}).map(([k, v]) => [k, comma && typeof v === "string" && /^\d+\.\d+$/.test(v) ? v.replace(".", ",") : v]));
  return fill(t[n.key], { ...vars, ...(n.inner && { inner: renderNote(n.inner, lang) }) });
}
