#!/usr/bin/env node
/**
 * Build a one-page PDF from analysis.json, entirely in the user's language. See HELP.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { checkClaims, checkLabels, checkLanguage } from "./lib/claims.ts";
import { BUILT_IN, LABEL_KEYS, detectLang, validateLabels, type Labels } from "./lib/i18n.ts";
import { buildReportContent, type AnalysisForReport } from "./lib/report-content.ts";
import { EXIT, fail, handleCli, parseArgs, printJson, str } from "./lib/util.ts";

const HELP = `
Usage: node scripts/report.ts --analysis <path/to/analysis.json> --lang <code> [options]

Render a one-page A4 PDF — your title, verdict and findings plus a table and a chart from analysis.json —
entirely in ONE language: the language the user wrote in. Checks numbers, verdict labels, language and layout.

Options:
  --lang uk|en         language of the whole report (built-in: ${Object.keys(BUILT_IN).join(", ")}). Guessed from your text if omitted.
  --labels FILE        translations for any other language: create it with --labels-template, translate the values
  --labels-template    print the English UI labels as JSON (translate the values, keep {placeholders} and keys)
  --title "…"          ≤ 90 chars, in the user's language (required unless --lang en)
  --verdict "…"        one sentence with numbers, ≤ 240 chars
  --findings "a|b|c"   3–5 bullets separated by |, each ≤ 280 chars
  --caveats "a|b"      up to 3 extra caveats separated by | (standard caveats are added in the report language)
  --chart indexed|absolute   indexed = interest over time (default), absolute = views per 1M edition views
  --out FILE           default: report.pdf next to analysis.json

Every number must come from analyze.ts output; for a difference between two series, state both numbers.
Translate tool terms: flat, growing, declining, trust, YoY… (uk: без змін, зростає, спадає, довіра, р/р).

Example:
  node scripts/report.ts --analysis out/astronomy/analysis.json --lang uk \\
    --title "Астрономія: інтерес в українській Вікіпедії" \\
    --verdict "Інтерес до астрономії спадає: частка переглядів −47,2% р/р, довіра висока (80)." \\
    --findings "uk: −63% переглядів р/р, уся uk-Вікіпедія −28,2%|pl: −29,6% частки, але 47% трафіку — боти"
`;

const args = parseArgs(process.argv.slice(2));
handleCli(args, HELP, ["analysis", "lang", "labels", "labels-template", "title", "verdict", "findings", "caveats", "chart", "out", "help"]);

if (args["labels-template"]) {
  printJson(Object.fromEntries(LABEL_KEYS.map((k) => [k, BUILT_IN.en![k]])));
  process.exit(EXIT.OK);
}

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
const a = JSON.parse(readFileSync(analysisPath, "utf8")) as AnalysisForReport;

const problems: string[] = [];
const split = (v: string | undefined) => (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : []);
const cap = (s: string, n: number, what: string) => {
  if (s.length <= n) return s;
  problems.push(`${what} is ${s.length} chars (max ${n}) — shortened with "…"; rewrite it shorter`);
  return s.slice(0, n - 1) + "…";
};

// the agent's own text, as passed
const rawTitle = str(args.title, "title"), rawVerdict = str(args.verdict, "verdict");
const rawFindings = str(args.findings, "findings"), rawCaveats = str(args.caveats, "caveats");
const agentText = [rawTitle, rawVerdict, rawFindings, rawCaveats].filter(Boolean).join("\n");

// one language for the whole report
const lang = (str(args.lang, "lang") ?? detectLang(agentText) ?? fail(
  "pass --lang <code>: the language the user wrote in (e.g. uk, en, pl). The whole report is rendered in that language.",
)).toLowerCase();
let L: Labels;
const labelsFile = str(args.labels, "labels");
if (labelsFile !== undefined) {
  if (!existsSync(labelsFile)) fail(`labels file not found: ${labelsFile}`);
  const v = validateLabels(JSON.parse(readFileSync(labelsFile, "utf8")));
  if (!v.labels) fail(`labels file ${labelsFile} is incomplete: ${v.problems.join("; ")}`);
  L = v.labels;
} else {
  L = BUILT_IN[lang] ?? fail(
    `no built-in labels for "${lang}" (built-in: ${Object.keys(BUILT_IN).join(", ")}). Run \`node scripts/report.ts --labels-template > labels.${lang}.json\`, ` +
    `translate every value into the user's language (keep the keys and {placeholders}), then re-run with --labels labels.${lang}.json`,
  );
}

let findings = split(rawFindings);
if (findings.length > 5) { problems.push(`${findings.length} findings given (max 5) — kept the first 5`); findings = findings.slice(0, 5); }
findings = findings.map((f, i) => cap(f, 280, `finding ${i + 1}`));
const input = {
  title: rawTitle !== undefined ? cap(rawTitle, 90, "--title") : undefined,
  verdict: rawVerdict !== undefined ? cap(rawVerdict, 240, "--verdict") : undefined,
  findings,
  caveats: split(rawCaveats).slice(0, 3).map((c, i) => cap(c, 200, `caveat ${i + 1}`)),
  chart: chartMode as "indexed" | "absolute",
};

// quality checks on everything the agent wrote
const numbers = checkClaims(agentText, a);
if (numbers.unverified.length) problems.push(`numbers not found in analysis.json: ${numbers.unverified.join(", ")} — use the exact values from analyze.ts output (state both numbers instead of a computed difference)`);
const labels = checkLabels(agentText, a.series);
for (const l of labels) problems.push(`${l} — use the verdict label from analyze.ts`);
const properNames = [...a.series.map((s) => s.article), ...a.topics];
const language = checkLanguage(agentText, lang, properNames);
for (const l of language) problems.push(`language (${lang}): ${l}`);
if (!rawVerdict || !rawFindings) problems.push("used auto-generated draft text — for a shared report pass your own --verdict and --findings in the user's language");
if (!rawTitle && lang !== "en") problems.push("no --title: the default title uses the English topic names — pass a title in the user's language");

const base = dirname(resolvePath(analysisPath));
const out = resolvePath(str(args.out, "out") ?? join(base, "report.pdf"));
const content = buildReportContent(a, input, L, lang, new Date().toISOString().slice(0, 10));
const { pages } = await renderPdf(content, out);
if (pages > 1) problems.push(`PDF has ${pages} pages (must be 1) — shorten --findings/--caveats or use fewer languages`);

printJson({ ok: problems.length === 0, pdf: out, pages, lang, chart: chartMode, numbers, labels: labels.length, language: language.length, problems });
if (problems.length) process.exit(EXIT.CHECK_FAILED);
