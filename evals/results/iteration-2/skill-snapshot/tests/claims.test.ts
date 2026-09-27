import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClaims, extractNumbers } from "../scripts/lib/claims.ts";
import { computeMetrics } from "../scripts/lib/metrics.ts";

// 12 months at 1182 views, then 12 months at 437 — the medians of the real uk/Астрономія series
const user = Array.from({ length: 24 }, (_, i) => ({ month: new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 7), views: i < 12 ? 1182 : 437 }));

test("extractNumbers: percent, signs, thousands, decimals, multipliers; ignores dates, years, small counts, '1M'", () => {
  const got = extractNumbers("У 2025-09 (2025 рік) uk: −63% р/р, 1 431 переглядів, 36,8%, +12.5%, 1,431 views, ~1.4k, 3 мови, per 1M views, 47% ботів").map((c) => c.value);
  assert.deepEqual(got, [-63, 1431, 36.8, 12.5, 1431, 1400, 47]);
});

test("small plain numbers must be nearly exact (regression: '2.4x' matched the spike factor 2.5)", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user });
  assert.deepEqual(checkClaims("у 2.4x більше", { series: [m] }).unverified, ["2.4"]);
  assert.deepEqual(checkClaims("спайк = 2.5× медіани; R² = " + m.r2, { series: [m] }).unverified, []);
  assert.deepEqual(checkClaims("−63% (округлено з −63.0%)", { series: [m] }).unverified, []);
});

test("extractNumbers ignores year ranges (regression: 'in 2025–26' was read as −26)", () => {
  assert.deepEqual(extractNumbers("traffic fell in 2025–26, 2024-2026 and 2024 — 25%").map((c) => c.value), [25]);
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
