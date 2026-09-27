#!/usr/bin/env node
/**
 * Build a one-page PDF from analysis.json. The agent supplies the narrative; numbers come from the data. See HELP.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { checkClaims, checkLabels } from "./lib/claims.ts";
import { EXIT, fail, handleCli, parseArgs, printJson, str } from "./lib/util.ts";
import type { SeriesMetrics } from "./lib/metrics.ts";

const HELP = `
Usage: node scripts/report.ts --analysis <path/to/analysis.json> [options]

Render a one-page A4 PDF: your verdict + findings, a metrics table and a chart from analysis.json.
Checks that every number in your text exists in analysis.json and that the PDF fits on one page.

Options:
  --title "…"          ≤ 90 chars (default: topics + languages)
  --verdict "…"        one-sentence answer with numbers, ≤ 240 chars (default: auto-generated draft)
  --findings "a|b|c"   3–5 bullets separated by |, each ≤ 280 chars (default: auto-generated draft)
  --caveats "a|b"      up to 3 extra caveats, separated by | (standard caveats are always added)
  --chart indexed|absolute   indexed = growth comparison (default), absolute = size per 1M views
  --out FILE           default: report.pdf next to analysis.json

Write --verdict/--findings in the user's language. Every number must come from analyze.ts output;
for a difference between two series, state both numbers instead of computing it.

Example:
  node scripts/report.ts --analysis out/astronomy/analysis.json --chart indexed \\
    --verdict "Інтерес до астрономії в uk падає: −63% медіанних переглядів р/р, довіра висока." \\
    --findings "uk: −63% р/р, 559 переглядів/міс|pl: −36.8% р/р, але 47% трафіку — боти|cs: −34.6% р/р"
`;

const args = parseArgs(process.argv.slice(2));
handleCli(args, HELP, ["analysis", "title", "verdict", "findings", "caveats", "chart", "out", "help"]);

let renderPdf: typeof import("./lib/pdf.ts").renderPdf;
try {
  ({ renderPdf } = await import("./lib/pdf.ts"));
} catch (e) {
  fail(`PDF dependencies are missing (${String((e as Error).message).split("\n")[0]}). Run \`npm ci\` in the skill directory, then retry.`, EXIT.SETUP);
}

const analysisPath = str(args.analysis, "analysis") ?? fail("--analysis path/to/analysis.json is required (printed by analyze.ts under files.analysis)");
if (!existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}. Run scripts/analyze.ts first; its output lists files.analysis.`, EXIT.NO_DATA);
const chartMode = str(args.chart, "chart") ?? "indexed";
if (chartMode !== "indexed" && chartMode !== "absolute") fail(`--chart must be one of: indexed, absolute. Received: "${chartMode}"`);

type Analysis = {
  topics: string[]; langs: string[]; period: { start: string; end: string }; normalized: boolean;
  files: { chart: string; chartIndexed: string };
  series: (SeriesMetrics & { name: string; spikes: string[] })[];
  ranking: { name: string; score: number; why: string }[];
  warnings: string[];
};
const a = JSON.parse(readFileSync(analysisPath, "utf8")) as Analysis;
const problems: string[] = [];
const split = (v: string | undefined) => (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : []);
const cap = (s: string, n: number, what: string) => {
  if (s.length <= n) return s;
  problems.push(`${what} is ${s.length} chars (max ${n}) — shortened with "…"; rewrite it shorter`);
  return s.slice(0, n - 1) + "…";
};
const fmt = (n: number | null, suffix = "") => (n === null ? "n/a" : `${n > 0 && suffix === "%" ? "+" : ""}${n}${suffix}`);

// resolve chart paths relative to analysis.json if they were written as relative paths by an older version
const base = dirname(resolvePath(analysisPath));
const chartFile = resolvePath(base, chartMode === "indexed" ? a.files.chartIndexed : a.files.chart);
const chartSvg = existsSync(chartFile) ? readFileSync(chartFile, "utf8") : readFileSync(join(base, chartMode === "indexed" ? "chart_indexed.svg" : "chart.svg"), "utf8");

// auto-generated draft text (used only when the agent does not pass its own)
const best = a.ranking[0];
const autoVerdict = !best ? "No usable data."
  : a.series.some((s) => s.verdict.label === "growing") ? `${best.name} shows the strongest trustworthy growth: ${best.why}.`
  : `No series is growing over this period; least weak is ${best.name}: ${best.why}.`;
const autoFindings = a.series.slice(0, 5).map((s) =>
  `${s.name} ("${s.article}"): ${s.verdict.label} — ${s.verdict.basis}; ${s.avgMonthlyLast12.toLocaleString("en")} views/mo` +
  (s.perMillionLast12 !== null ? `, ${s.perMillionLast12} per 1M` : "") + `; trust ${s.trust.label}` + (s.trust.reasons[0] ? ` (${s.trust.reasons[0]})` : ""));

const title = cap(str(args.title, "title") ?? `${a.topics.join(", ")} — Wikipedia interest in ${a.langs.join(", ")}`, 90, "--title");
const verdict = cap(str(args.verdict, "verdict") ?? autoVerdict, 240, "--verdict");
let findings = split(str(args.findings, "findings"));
if (findings.length > 5) { problems.push(`${findings.length} findings given (max 5) — kept the first 5`); findings = findings.slice(0, 5); }
findings = findings.length ? findings.map((f, i) => cap(f, 280, `finding ${i + 1}`)) : autoFindings;
const userCaveats = split(str(args.caveats, "caveats")).slice(0, 3).map((c, i) => cap(c, 200, `caveat ${i + 1}`));

// claim check on everything the agent wrote
const agentText = [str(args.title, "title"), str(args.verdict, "verdict"), str(args.findings, "findings"), str(args.caveats, "caveats")].filter(Boolean).join("\n");
const numbers = checkClaims(agentText, a);
if (numbers.unverified.length) problems.push(`numbers not found in analysis.json: ${numbers.unverified.join(", ")} — use the exact values from analyze.ts output (state both numbers instead of a computed difference)`);
const labels = checkLabels(agentText, a.series);
for (const l of labels) problems.push(`${l} — use the verdict label from analyze.ts`);

const baseCaveats = [
  "Pageviews measure curiosity, not willingness to pay; validate promising directions with a landing page or ads test.",
  "Human traffic only (agent=user); undetected bots may remain. Spike months are marked; median-based growth ignores them.",
  ...(a.normalized ? ["Rel. YoY = change of the topic's share of all views in that edition; it assumes the edition-wide decline (Edition column) hits all topics equally."] : []),
  a.normalized ? "Per-1M values divide by all views of each language edition: fair across editions, but a small edition can look ‘hotter’ while tiny in absolute terms." : "Absolute views are not adjusted for the size of each language edition.",
  "One article per topic; broad topics (a course) deserve a basket of related articles.",
];
const caveats = [...userCaveats, ...a.warnings.slice(0, 2).map((w) => `Data warning: ${w}`), ...baseCaveats].slice(0, 6);

const table = a.normalized
  ? {
      header: ["Series (article)", "Views/mo", "Per 1M", "Rel. YoY", "Raw YoY", "Edition", "Verdict", "Trust"],
      rows: a.series.map((s) => [`${s.name} (${s.article})`, s.avgMonthlyLast12.toLocaleString("en"), fmt(s.perMillionLast12),
        fmt(s.relativeGrowth, "%"), fmt(s.robustGrowth, "%"), fmt(s.editionGrowth, "%"), s.verdict.label, `${s.trust.label} ${s.trust.score}`]),
    }
  : {
      header: ["Series (article)", "Views/mo", "Total 12m", "Med. YoY", "Naive YoY", "Trend/yr", "Verdict", "Trust"],
      rows: a.series.map((s) => [`${s.name} (${s.article})`, s.avgMonthlyLast12.toLocaleString("en"), s.totalLast12.toLocaleString("en"),
        fmt(s.robustGrowth, "%"), fmt(s.yoy, "%"), fmt(s.trendAnnual, "%"), s.verdict.label, `${s.trust.label} ${s.trust.score}`]),
    };

const out = resolvePath(str(args.out, "out") ?? join(base, "report.pdf"));
const p = `${a.period.start.slice(0, 4)}-${a.period.start.slice(4, 6)} – ${a.period.end.slice(0, 4)}-${a.period.end.slice(4, 6)}`;
const { pages } = await renderPdf({
  title, verdict, table, chartSvg, findings, caveats,
  subtitle: `Wikimedia pageviews API · ${p} · monthly, human (non-bot) traffic, all platforms`,
  sources: ["wikimedia.org/api/rest_v1/metrics/pageviews", ...a.series.map((s) => `${s.project}/wiki/${s.article}`)],
}, out);
if (pages > 1) problems.push(`PDF has ${pages} pages (must be 1) — shorten --findings/--caveats or use fewer languages`);
if (!args.verdict || !args.findings) problems.push("used auto-generated draft text — for a shared report pass your own --verdict and --findings in the user's language");

printJson({ ok: problems.length === 0, pdf: out, pages, chart: chartMode, numbers, labels: labels.length, problems });
if (problems.length) process.exit(EXIT.CHECK_FAILED);
