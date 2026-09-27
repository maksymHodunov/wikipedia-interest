import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, densify, logLinearTrend, spikeMonths, trustScore, rankSeries, monthsBetween, type Point } from "../scripts/lib/metrics.ts";
import { indexSeries, lineChart } from "../scripts/lib/svg.ts";
import { dateRange, parseArgs } from "../scripts/lib/util.ts";

const months = (n: number, start = "2024-01"): string[] => {
  const [y, m] = start.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 + i, 1)); return d.toISOString().slice(0, 7); });
};
const series = (values: number[]): Point[] => months(values.length).map((month, i) => ({ month, views: values[i]! }));

test("logLinearTrend recovers a clean exponential growth", () => {
  const v = Array.from({ length: 24 }, (_, i) => 1000 * 1.05 ** i); // +5%/month ≈ +79.6%/yr
  const t = logLinearTrend(v)!;
  assert.ok(Math.abs(t.annualPct - 79.6) < 0.5, `got ${t.annualPct}`);
  assert.ok(t.r2 > 0.999);
});

test("logLinearTrend needs at least 6 points", () => {
  assert.equal(logLinearTrend([1, 2, 3]), null);
});

test("spikeMonths flags outliers relative to neighbours", () => {
  const s = series([100, 110, 95, 105, 2000, 100, 98, 104, 101, 99]);
  assert.deepEqual(spikeMonths(s).map((p) => p.month), ["2024-05"]);
});

test("computeMetrics: flat series is 'flat', 24 months, robust growth ~0", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user: series(Array(24).fill(1000)) });
  assert.equal(m.months, 24);
  assert.equal(m.verdict.label, "flat");
  assert.equal(m.robustGrowth, 0);
  assert.equal(m.yoy, 0);
  assert.equal(m.completeness, 1);
});

test("computeMetrics: spike-driven growth is caught by median and lowers trust", () => {
  const prev = Array(12).fill(1000);
  const last = [...Array(11).fill(900), 40000]; // one viral month
  const m = computeMetrics({ lang: "pl", project: "pl.wikipedia", article: "X", user: series([...prev, ...last]) });
  assert.ok(m.yoy! > 100, "naive YoY should look like huge growth");
  assert.equal(m.robustGrowth, -10, "median-based growth shows the truth");
  assert.equal(m.verdict.label, "flat");
  assert.ok(m.trust.reasons.some((r) => r.includes("spikes are removed")));
});

test("computeMetrics: normalisation by project total and bot share", () => {
  const user = series(Array(24).fill(500));
  const automated = series(Array(24).fill(500));
  const projectTotal = series(Array(24).fill(1_000_000));
  const m = computeMetrics({ lang: "cs", project: "cs.wikipedia", article: "X", user, automated, projectTotal });
  assert.equal(m.perMillionLast12, 500);
  assert.equal(m.botShare, 0.5);
  assert.equal(m.trust.label, "medium");
});

test("computeMetrics: short series → insufficient data, low trust", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user: series([10, 12, 11, 13]) });
  assert.equal(m.verdict.label, "insufficient-data");
  assert.equal(m.trust.label, "low");
});

test("trustScore penalties are bounded 0..100", () => {
  const t = trustScore({ months: 3, completeness: 0.5, spikeShare: 0.5, botShare: 0.9, r2: 0, avgMonthly: 10, spikeDriven: true });
  assert.equal(t.score, 0);
});

test("rankSeries prefers trustworthy growth over noisy growth", () => {
  const good = computeMetrics({ lang: "a", project: "a.wikipedia", article: "X", user: series(Array.from({ length: 24 }, (_, i) => 1000 + i * 40)) });
  const noisy = computeMetrics({ lang: "b", project: "b.wikipedia", article: "X", user: series(Array.from({ length: 24 }, (_, i) => (i % 2 ? 100 : 3000))) });
  const r = rankSeries([{ ...good, name: "a" }, { ...noisy, name: "b" }]);
  assert.equal(r[0]!.name, "a");
});

test("monthsBetween and dateRange", () => {
  assert.equal(monthsBetween("2024-01", "2024-12"), 11);
  const r = dateRange({ start: "2024-01-01", end: "2024-12-31" });
  assert.deepEqual(r, { start: "20240101", end: "20241231" });
  assert.match(dateRange({ months: 12 }).start, /^\d{8}$/);
});

test("indexSeries rebases to 100 and lineChart renders every series", () => {
  const idx = indexSeries(series([200, 200, 200, 400]));
  assert.equal(idx[0]!.views, 100);
  assert.equal(idx[3]!.views, 200);
  const svg = lineChart([{ name: "uk", points: series([1, 2, 3]) }, { name: "pl", points: series([3, 2, 1]) }], { title: "t <x>" });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("t &lt;x&gt;"), "title is escaped");
  assert.equal((svg.match(/<path /g) ?? []).length, 2);
});

test("parseArgs handles values, flags and lists", () => {
  const a = parseArgs(["pos", "--topic", "x y", "--langs", "uk,pl", "--no-bots"]);
  assert.equal(a.topic, "x y");
  assert.equal(a["no-bots"], true);
  assert.deepEqual(a._, ["pos"]);
});

test("densify fills months the API omitted (zero views) and computeMetrics uses calendar months", () => {
  const pts: Point[] = [{ month: "2024-01", views: 10 }, { month: "2024-04", views: 40 }];
  assert.deepEqual(densify(pts, "2024-05").map((p) => `${p.month}:${p.views}`), ["2024-01:10", "2024-02:0", "2024-03:0", "2024-04:40", "2024-05:0"]);
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user: pts, window: { start: "2024-01", end: "2024-05" } });
  assert.equal(m.months, 5);
  assert.equal(m.completeness, 0.4);
  assert.ok(m.trust.reasons.some((r) => r.includes("gaps in data")));
});

test("computeMetrics flags a series that starts long after the requested window (article created/renamed)", () => {
  const user = series(Array(12).fill(1000)).map((p, i) => ({ ...p, month: months(12, "2025-01")[i]! }));
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user, window: { start: "2024-01", end: "2025-12" } });
  assert.ok(m.trust.reasons.some((r) => r.startsWith("data starts 2025-01, 12 months after")), m.trust.reasons.join("; "));
});

test("indexSeries base is a median, so one spike in the base period does not fake a collapse", () => {
  const idx = indexSeries(series([4000, 1000, 1000, 1000, 1000, 1000, 1000]));
  assert.equal(idx[1]!.views, 100);
  assert.equal(idx[0]!.views, 400);
});

test("relativeGrowth removes an edition-wide decline: topic −20% while the whole edition is −20% → flat", () => {
  const topic = series([...Array(12).fill(1000), ...Array(12).fill(800)]);
  const edition = series([...Array(12).fill(1e8), ...Array(12).fill(8e7)]);
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user: topic, projectTotal: edition });
  assert.equal(m.robustGrowth, -20);
  assert.equal(m.editionGrowth, -20);
  assert.equal(m.relativeGrowth, 0);
  assert.equal(m.verdict.label, "flat");
  assert.match(m.verdict.basis, /share of edition views 0% YoY \(raw -20%, whole edition -20%\)/);
});

test("trust drops when raw and relative growth disagree in direction", () => {
  const topic = series([...Array(12).fill(1000), ...Array(12).fill(850)]);   // raw −15 %
  const edition = series([...Array(12).fill(1e8), ...Array(12).fill(6e7)]);  // edition −40 % → relative +41.7 %
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user: topic, projectTotal: edition });
  assert.equal(m.verdict.label, "growing");
  assert.ok(m.trust.reasons.some((r) => r.includes("opposite directions")));
});
