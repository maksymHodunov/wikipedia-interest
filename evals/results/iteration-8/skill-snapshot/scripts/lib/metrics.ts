/**
 * Pure metric functions over monthly pageview series. No I/O — unit-tested in tests/metrics.test.ts.
 *
 * Vocabulary (also documented in references/metrics.md):
 *  - yoy            last 12 months vs the 12 before, in %  (naive: spikes count)
 *  - robustGrowth   same comparison on *median* monthly views (spike-resistant)
 *  - trendAnnual    annualised slope of a log-linear fit, in %/year; r2 = how consistent the trend is
 *  - spikeShare     fraction of months that are > 2.5x the rolling median (viral / news-driven)
 *  - botShare       automated / (user + automated) views — high values mean the numbers are polluted
 *  - perMillion     views per 1M pageviews of the whole language edition (audience-size adjusted)
 *  - trust          0–100 score with reasons: how much the growth signal can be believed
 */
import { renderNote, type Note, type NoteKey } from "./notes.ts";

export interface Point { month: string; views: number } // month = "YYYY-MM"

export interface SeriesInput {
  lang: string;
  project: string;
  article: string;
  user: Point[];          // agent=user
  automated?: Point[];    // agent=automated (optional)
  projectTotal?: Point[]; // whole-edition monthly views (optional)
  window?: { start: string; end: string }; // requested period, "YYYY-MM" — enables gap filling and late-start detection
  match?: "high" | "medium" | "low";       // how sure we are the article IS the topic (from resolve.ts)
}

// basis = note rendered in English; the note lets analyze.ts --lang print it in the user's language (older files lack it)
export interface Verdict { label: "growing" | "flat" | "declining" | "insufficient-data"; basis: string; note?: Note }

export interface SeriesMetrics {
  lang: string;
  project: string;
  article: string;
  months: number;
  completeness: number;         // 0..1 months with data over expected
  totalLast12: number;
  avgMonthlyLast12: number;
  perMillionLast12: number | null;
  yoy: number | null;
  robustGrowth: number | null;
  relativeGrowth: number | null; // robustGrowth of the per-1M share: topic vs. the whole edition
  editionGrowth: number | null;  // median YoY of the whole edition's human views (platform-wide trend)
  trendAnnual: number | null;
  r2: number | null;
  spikeShare: number;
  peakMonth: Point | null;
  botShare: number | null;
  trust: { score: number; label: "high" | "medium" | "low"; reasons: string[]; notes?: Note[] }; // reasons = notes in English
  verdict: Verdict;
  points: Point[];              // the gap-filled monthly series all metrics were computed from
  levelShift: { month: string; from: number; to: number } | null; // article created/renamed/merged inside the period
  perMillionSeries?: Point[];
}

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (now: number, before: number): number | null => (before > 0 ? ((now - before) / before) * 100 : null);
export const round = (x: number | null, d = 1): number | null => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Log-linear regression views ~ exp(a + b*t). Returns annualised % growth and R². */
export function logLinearTrend(views: number[]): { annualPct: number; r2: number } | null {
  const ys = views.map((v) => Math.log(Math.max(v, 1)));
  const n = ys.length;
  if (n < 6) return null;
  const xs = ys.map((_, i) => i);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, sst = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; sst += (ys[i]! - my) ** 2; }
  if (sxx === 0) return null;
  const b = sxy / sxx, a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i]! - (a + b * xs[i]!)) ** 2;
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  return { annualPct: (Math.exp(b * 12) - 1) * 100, r2 };
}

/**
 * The REST API omits months with zero views. Fill them with 0 from the first observed month to `endMonth`,
 * so "last 12 points" always means "last 12 calendar months".
 */
export function densify(points: Point[], endMonth?: string): Point[] {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(sorted.map((p) => [p.month, p.views]));
  const lastObserved = sorted[sorted.length - 1]!.month;
  const last = endMonth && endMonth > lastObserved ? endMonth : lastObserved;
  const out: Point[] = [];
  let [y, m] = sorted[0]!.month.split("-").map(Number) as [number, number];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: key, views: byMonth.get(key) ?? 0 });
    if (key >= last) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Abrupt, lasting jump in the article's level — the signature of an article created, renamed or merged inside the
 * period, not of interest. Calibrated on real series: pt "Claude" 5 → 4 471 views/month (×894) and en "Claude (AI)"
 * 64 → 132 501 (×2 070) were renames; genuine surges stayed below ×6 (es "Claude (chatbot)" ×5.1, en "Claude" ×4).
 * Rule: median of the last 3 months > 20 × median of the first half, and at least 100 views/month now.
 */
export function levelShift(points: Point[]): { month: string; from: number; to: number } | null {
  const v = points.map((p) => p.views);
  if (v.length < 8) return null;
  const m1 = median(v.slice(0, Math.floor(v.length / 2)));
  const m3 = median(v.slice(-3));
  if (m3 < 100 || (m1 > 0 && m3 / m1 <= 20)) return null;
  const thr = Math.max(5 * m1, 1);
  const i = v.findIndex((x, k) => x > thr && median(v.slice(k)) > thr);
  return { month: points[Math.max(0, i)]!.month, from: Math.round(m1), to: Math.round(m3) };
}

/** Months whose views exceed `k` × the median of the surrounding window. */
export function spikeMonths(points: Point[], k = 2.5, window = 6): Point[] {
  const out: Point[] = [];
  points.forEach((p, i) => {
    const neigh = points.slice(Math.max(0, i - window), i).concat(points.slice(i + 1, i + 1 + window)).map((q) => q.views);
    const m = median(neigh);
    if (m > 0 && p.views > k * m) out.push(p);
  });
  return out;
}

/** Trust score: penalise short series, spikes, bots, gaps and noisy trends. Each penalty adds a note (notes.ts). */
export function trustScore(a: {
  months: number; completeness: number; spikeShare: number; botShare: number | null;
  r2: number | null; avgMonthly: number; spikeDriven: boolean; lateStart?: { months: number; first: string };
  match?: "high" | "medium" | "low"; levelShift?: { month: string; from: number; to: number } | null;
}): SeriesMetrics["trust"] {
  let score = 100;
  const notes: Note[] = [];
  const pen = (points: number, key: NoteKey, vars?: Note["vars"]) => { score -= points; notes.push({ key, ...(vars && { vars }) }); };
  const pc = (x: number) => Math.round(x * 100);
  if (a.levelShift) pen(40, "levelShift", { ...a.levelShift });
  if (a.match === "low") pen(50, "matchLow");
  else if (a.match === "medium") pen(20, "matchMedium");
  if (a.lateStart && a.lateStart.months >= 3) pen(10, "lateStart", { ...a.lateStart });
  if (a.months < 6) pen(60, "months6", { months: a.months });
  else if (a.months < 12) pen(40, "months12", { months: a.months });
  else if (a.months < 24) pen(15, "months24", { months: a.months });
  if (a.completeness < 0.95) pen(15, "gaps", { pct: pc(a.completeness) });
  if (a.spikeShare > 0.15) pen(25, "spikesMany", { pct: pc(a.spikeShare) });
  else if (a.spikeShare > 0.05) pen(10, "spikesSome", { pct: pc(a.spikeShare) });
  if (a.spikeDriven) pen(20, "spikeDriven");
  if (a.botShare !== null && a.botShare > 0.4) pen(35, "bots40", { pct: pc(a.botShare) });
  else if (a.botShare !== null && a.botShare > 0.3) pen(25, "bots30", { pct: pc(a.botShare) });
  else if (a.botShare !== null && a.botShare > 0.15) pen(10, "bots15", { pct: pc(a.botShare) });
  if (a.r2 !== null && a.r2 < 0.2) pen(15, "noisy", { rsq: a.r2.toFixed(2) });
  if (a.avgMonthly < 300) pen(20, "lowVolume", { n: Math.round(a.avgMonthly) });
  score = Math.max(0, Math.min(100, score));
  return { score, label: score >= 70 ? "high" : score >= 40 ? "medium" : "low", reasons: notes.map((n) => renderNote(n)), notes };
}

export function computeMetrics(s: SeriesInput): SeriesMetrics {
  const observed = s.user.length;
  const pts = densify(s.user, s.window?.end);
  const months = pts.length;
  const views = pts.map((p) => p.views);
  const last12 = pts.slice(-12), prev12 = pts.slice(-24, -12);
  const totalLast12 = last12.reduce((a, p) => a + p.views, 0);
  const avgMonthlyLast12 = mean(last12.map((p) => p.views));

  // share of calendar months (first observed → end of window) that actually had a record
  const completeness = months ? observed / months : 0;
  const lateStart = s.window && pts.length ? { months: Math.max(0, monthsBetween(s.window.start, pts[0]!.month)), first: pts[0]!.month } : undefined;

  const yoy = prev12.length === 12 ? pct(totalLast12, prev12.reduce((a, p) => a + p.views, 0)) : null;
  const robustGrowth = prev12.length === 12 ? pct(median(last12.map((p) => p.views)), median(prev12.map((p) => p.views))) : null;
  const trend = logLinearTrend(views);
  const spikes = spikeMonths(pts);
  const spikeShare = months ? spikes.length / months : 0;
  const peakMonth = pts.length ? pts.reduce((a, b) => (b.views > a.views ? b : a)) : null;

  let botShare: number | null = null;
  if (s.automated?.length) {
    const byMonth = new Map(s.automated.map((p) => [p.month, p.views]));
    const bot = last12.reduce((a, p) => a + (byMonth.get(p.month) ?? 0), 0);
    botShare = totalLast12 + bot > 0 ? bot / (totalLast12 + bot) : null;
  }

  let perMillionLast12: number | null = null;
  let perMillionSeries: Point[] | undefined;
  let relativeGrowth: number | null = null;
  let editionGrowth: number | null = null;
  if (s.projectTotal?.length) {
    const tot = new Map(s.projectTotal.map((p) => [p.month, p.views]));
    perMillionSeries = pts.filter((p) => tot.has(p.month)).map((p) => ({ month: p.month, views: (p.views / tot.get(p.month)!) * 1e6 }));
    const l12 = perMillionSeries.slice(-12);
    perMillionLast12 = l12.length ? mean(l12.map((p) => p.views)) : null;
    if (perMillionSeries.length >= 24) relativeGrowth = pct(median(l12.map((p) => p.views)), median(perMillionSeries.slice(-24, -12).map((p) => p.views)));
    const totals = [...s.projectTotal].sort((a, b) => a.month.localeCompare(b.month)).map((p) => p.views);
    if (totals.length >= 24) editionGrowth = pct(median(totals.slice(-12)), median(totals.slice(-24, -12)));
  }

  const spikeDriven = yoy !== null && robustGrowth !== null && yoy > 10 && robustGrowth < 0;
  const shift = levelShift(pts);
  const trust = trustScore({ months, completeness, spikeShare, botShare, r2: trend?.r2 ?? null, avgMonthly: avgMonthlyLast12, spikeDriven, lateStart, match: s.match, levelShift: shift });
  if (relativeGrowth !== null && robustGrowth !== null && Math.abs(relativeGrowth) > 10 && Math.abs(robustGrowth) > 10 && Math.sign(relativeGrowth) !== Math.sign(robustGrowth)) {
    trust.score = Math.max(0, trust.score - 10);
    trust.label = trust.score >= 70 ? "high" : trust.score >= 40 ? "medium" : "low";
    const n: Note = { key: "rawVsRelative", vars: { raw: round(robustGrowth)!, rel: round(relativeGrowth)!, ed: String(round(editionGrowth)) } };
    trust.notes?.push(n);
    trust.reasons.push(renderNote(n));
  }

  // Verdict: prefer growth relative to the whole edition (removes the platform-wide decline), then raw median growth, then trend.
  let verdict: Verdict;
  const f = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(0)}%`;
  const g = relativeGrowth ?? robustGrowth ?? trend?.annualPct ?? null;
  const basis: Note = g === null ? { key: "basisNone" }
    : relativeGrowth !== null ? { key: "basisRelative", vars: { rel: f(relativeGrowth), ed: editionGrowth !== null ? f(editionGrowth) : "n/a", raw: f(robustGrowth!) } }
    : robustGrowth !== null ? { key: "basisMedian", vars: { raw: f(robustGrowth) } } : { key: "basisTrend", vars: { g: f(g) } };
  const v = (label: Verdict["label"], note: Note): Verdict => ({ label, basis: renderNote(note), note });
  if (shift) verdict = v("insufficient-data", { key: "basisShift", vars: { ...shift } });
  else if (g === null) verdict = v("insufficient-data", basis);
  else if (g > 10) verdict = v("growing", basis);
  else if (g < -10) verdict = v("declining", basis);
  // "flat" is spelled out first: agents otherwise read "+7%" as growth
  else verdict = v("flat", { key: "flat", vars: { g: f(g) }, inner: basis });

  return {
    lang: s.lang, project: s.project, article: s.article, months,
    completeness: round(completeness, 2)!,
    totalLast12, avgMonthlyLast12: Math.round(avgMonthlyLast12),
    perMillionLast12: round(perMillionLast12, 1),
    yoy: round(yoy), robustGrowth: round(robustGrowth), relativeGrowth: round(relativeGrowth), editionGrowth: round(editionGrowth),
    trendAnnual: round(trend?.annualPct ?? null), r2: round(trend?.r2 ?? null, 2),
    spikeShare: round(spikeShare, 2)!, peakMonth, botShare: round(botShare, 2),
    trust, verdict, points: pts, levelShift: shift, perMillionSeries,
  };
}

export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}

/** Rank languages for "where to invest next". Score = growth signal × trust, tie-broken by relative interest. */
export function rankSeries<T extends SeriesMetrics & { name: string }>(ms: T[]): { name: string; score: number; why: string }[] {
  return ms
    .map((m) => {
      const g = m.relativeGrowth ?? m.robustGrowth ?? m.trendAnnual ?? 0;
      const level = m.perMillionLast12 ?? 0;
      const score = (Math.max(-50, Math.min(g, 200)) + 50) * (m.trust.score / 100) + Math.log10(level + 1) * 10;
      const why = `${m.verdict.label} (${m.verdict.basis}), trust ${m.trust.label}, ${m.perMillionLast12 !== null ? `${m.perMillionLast12} views per 1M edition views` : `${m.avgMonthlyLast12} views/month`}`;
      return { name: m.name, score: Math.round(score), why };
    })
    .sort((a, b) => b.score - a.score);
}
