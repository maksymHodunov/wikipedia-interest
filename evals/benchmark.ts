#!/usr/bin/env node
/**
 * Aggregate grading.json + timing.json of one eval iteration into benchmark.json (agentskills.io eval layout).
 *
 *   node evals/benchmark.ts evals/results/iteration-3 [--baseline evals/results/iteration-1]
 *
 * with_skill comes from <iteration>/eval-*\/with_skill; without_skill from the same folder or from --baseline.
 * Follow-up evals (no baseline) count towards pass rate but not towards time/token deltas.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [iterDir, ...rest] = process.argv.slice(2);
if (!iterDir) { console.error("usage: node evals/benchmark.ts <iteration-dir> [--baseline <iteration-dir>]"); process.exit(2); }
const baselineDir = rest[0] === "--baseline" ? rest[1]! : iterDir;

type Run = { eval: string; passRate: number; passed: number; total: number; seconds?: number; tokens?: number; calls?: number };
const load = (dir: string, config: string): Run[] =>
  readdirSync(dir).filter((d) => d.startsWith("eval-") && existsSync(join(dir, d, config, "grading.json"))).map((d) => {
    const g = JSON.parse(readFileSync(join(dir, d, config, "grading.json"), "utf8")).summary;
    const tPath = join(dir, d, config, "timing.json");
    const t = existsSync(tPath) ? JSON.parse(readFileSync(tPath, "utf8")) : {};
    return { eval: d, passRate: g.pass_rate, passed: g.passed, total: g.total, seconds: t.duration_ms / 1000, tokens: t.total_tokens, calls: t.tool_calls };
  });

const stats = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean: +mean.toFixed(2), stddev: +sd.toFixed(2), n: v.length };
};
const summary = (runs: Run[]) => ({
  pass_rate: stats(runs.map((r) => r.passRate)),
  assertions: `${runs.reduce((a, r) => a + r.passed, 0)}/${runs.reduce((a, r) => a + r.total, 0)}`,
  time_seconds: stats(runs.map((r) => r.seconds!)),
  tokens: stats(runs.map((r) => r.tokens!)),
  tool_calls: stats(runs.map((r) => r.calls!)),
});

const withSkill = load(iterDir, "with_skill");
const without = load(baselineDir, "without_skill");
const paired = withSkill.filter((r) => without.some((b) => b.eval === r.eval));
const w = summary(paired), b = summary(without);
const d = (k: "pass_rate" | "time_seconds" | "tokens" | "tool_calls") => (w[k] && b[k] ? +(w[k]!.mean - b[k]!.mean).toFixed(2) : null);
const out = {
  iteration: iterDir, baseline: baselineDir,
  run_summary: { with_skill: w, without_skill: b, delta: { pass_rate: d("pass_rate"), time_seconds: d("time_seconds"), tokens: d("tokens"), tool_calls: d("tool_calls") } },
  with_skill_all_evals: summary(withSkill),
  per_eval: withSkill.map((r) => ({ ...r, baseline: without.find((x) => x.eval === r.eval) ?? null })),
};
writeFileSync(join(iterDir, "benchmark.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.run_summary, null, 1));
console.log("all with_skill evals (incl. follow-up):", JSON.stringify(out.with_skill_all_evals.pass_rate), out.with_skill_all_evals.assertions);
