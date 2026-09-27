#!/usr/bin/env node
/**
 * Verify that every number in a draft answer exists in analysis.json. See HELP.
 */
import { existsSync, readFileSync } from "node:fs";
import { checkClaims, checkLabels, checkLanguage } from "./lib/claims.ts";
import { EXIT, fail, handleCli, parseArgs, printJson, str } from "./lib/util.ts";

const HELP = `
Usage: node scripts/check_claims.ts --analysis <analysis.json> --file <draft.md> [--lang uk]
       node scripts/check_claims.ts --analysis <analysis.json> --text "short text" [--lang uk]

Checks the numbers in your draft answer against analysis.json (report.ts runs the same check on the PDF text).
Output: {"ok": bool, "checked": N, "unverified": ["+45%", …], "labelProblems": […], "languageProblems": […]}.
Fix every item, then re-run.
Label check: a sentence naming one language must not call it growing when its verdict is flat or declining.
Language check (--lang): uk → Russian words and forms; any language but en → untranslated tool terms (flat, YoY…).
Dates, years and small counts (≤ 12) are ignored. For a difference between two series, state both numbers.
`;

const args = parseArgs(process.argv.slice(2));
handleCli(args, HELP, ["analysis", "file", "text", "lang", "help"]);
const analysisPath = str(args.analysis, "analysis") ?? fail("--analysis is required");
if (!existsSync(analysisPath)) fail(`analysis file not found: ${analysisPath}`, EXIT.NO_DATA);
const file = str(args.file, "file");
const text = file !== undefined ? (existsSync(file) ? readFileSync(file, "utf8") : fail(`file not found: ${file}`)) : str(args.text, "text");
if (text === undefined) fail("pass --file draft.md or --text \"…\"");

const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
const r = checkClaims(text, analysis);
const labelProblems = analysis.series ? checkLabels(text, analysis.series) : [];
const lang = str(args.lang, "lang");
const properNames = [...(analysis.series ?? []).map((s: { article: string }) => s.article), ...(analysis.topics ?? [])];
const languageProblems = lang ? checkLanguage(text, lang.toLowerCase(), properNames) : [];
const ok = r.unverified.length === 0 && labelProblems.length === 0 && languageProblems.length === 0;
printJson({ ok, ...r, labelProblems, languageProblems });
if (!ok) process.exit(EXIT.CHECK_FAILED);
