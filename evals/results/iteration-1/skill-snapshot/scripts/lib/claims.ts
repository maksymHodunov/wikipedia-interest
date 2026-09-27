/**
 * Claim check: every number the agent writes (verdict, findings, chat answer) must exist in analysis.json.
 *
 * SKILL.md rule this enforces: cite numbers from the script output only; for a difference, state both numbers.
 * Heuristics (documented in references/metrics.md → "Claim check"):
 *  - dates and years (2024, 2025-09) are ignored; bare integers ≤ 12 are ignored ("3 languages", "12 months")
 *  - "1,431" / "1 431" = 1431; "36,8" / "36.8" = 36.8; k / тис / M / млн multipliers are applied; "1M" as a unit is ignored
 *  - a claim matches a known value within ±0.55 (or ±2.5 % for values ≥ 100, so "~1 400" matches 1 431)
 *  - an explicit sign must match ("+63 %" does not match −63); unsigned numbers match either sign ("fell 63 %")
 */
import type { SeriesMetrics } from "./metrics.ts";

export interface Claim { raw: string; value: number; signed: boolean; percent: boolean }
export interface ClaimCheck { checked: number; unverified: string[] }
type AnalysisLike = { series: SeriesMetrics[]; ranking?: { score: number }[] };

const MULT: Record<string, number> = { k: 1e3, "тис": 1e3, m: 1e6, "млн": 1e6 };
// Constants the skill itself uses in explanations. Percentages and plain numbers are kept apart:
// a "12 %" claim must match a percentage metric, not some month that happened to have 12 views per 1M.
const CONST_PCT = [10, 15, 30, 40];            // verdict threshold ±10 %, bot-share thresholds
const CONST_NUM = [100, 2.5, 40, 70, 300, 1000]; // index base, spike factor, trust thresholds, volume thresholds

export function extractNumbers(text: string): Claim[] {
  const t = text
    // year ranges and dates: 2025–26, 2024-2026, 2025-09, 2025-09-01 (hyphen, en or em dash)
    .replace(/(?<![\d.])(?:19|20)\d{2}\s?[-–—]\s?(?:(?:19|20)\d{2}|\d{2})(?:-\d{2})?(?![\d%])/g, " ")
    .replace(/(?<![\d.,])(?:19|20)\d{2}(?![\d%])/g, " ");
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

function matches(c: Claim, pools: { pct: number[]; num: number[] }): boolean {
  return (c.percent ? pools.pct : pools.num).some((k) => {
    if (c.signed && c.value !== 0 && k !== 0 && Math.sign(c.value) !== Math.sign(k)) return false;
    const ak = Math.abs(k), av = Math.abs(c.value);
    return Math.abs(av - ak) <= (ak >= 100 ? ak * 0.025 : 0.55);
  });
}

export function checkClaims(text: string, a: AnalysisLike): ClaimCheck {
  const known = knownNumbers(a);
  const claims = extractNumbers(text);
  return { checked: claims.length, unverified: [...new Set(claims.filter((c) => !matches(c, known)).map((c) => c.raw))] };
}
