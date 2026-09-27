#!/usr/bin/env node
/**
 * Check a draft answer against analysis.json: numbers, ratios, verdict labels, language. See HELP.
 */
import { existsSync, readFileSync } from "node:fs";
import { checkClaims, checkLabels, checkLanguage } from "./lib/claims.ts";
import { EXIT, fail, handleCli, parseArgs, printJson, str } from "./lib/util.ts";

const HELP = `
Usage: node scripts/check_claims.ts --analysis <analysis.json>[,<more.json>] --file <draft.md> --lang <code>
       node scripts/check_claims.ts --analysis <analysis.json> --text "short text" --lang <code>

Checks your draft answer against analysis.json (report.ts runs the same checks on the PDF text). Run it on every
answer with numbers, in every language, and send exactly the text that passed.
Output: {"ok": bool, "checked": N, "unverified": ["+45%", …], "ratios": ["4×"], "labelProblems": […], "languageProblems": […]}.
Fix every item, then re-run.
  numbers  every number must be in the data; ratios ("4×", "в 4 рази") never are — write both numbers instead
  labels   a sentence naming one language must not call it growing when its verdict is flat or declining, and a
           relative decline must not be explained by the platform (the share already removes the edition-wide change)
  language (--lang) uk → Russian words and forms, calques, words in Latin letters; any language but en → untranslated
           tool terms (flat, YoY…)
A follow-up that compares with an earlier run: pass both files, --analysis first.json,second.json.
Dates, years and small counts (≤ 12) are ignored.
`;

const args = parseArgs(process.argv.slice(2));
handleCli(args, HELP, ["analysis", "file", "text", "lang", "help"]);
const analysisPaths = (str(args.analysis, "analysis") ?? fail("--analysis is required")).split(",").map((p) => p.trim()).filter(Boolean);
for (const p of analysisPaths) if (!existsSync(p)) fail(`analysis file not found: ${p}`, EXIT.NO_DATA);
const file = str(args.file, "file");
const text = file !== undefined ? (existsSync(file) ? readFileSync(file, "utf8") : fail(`file not found: ${file}`)) : str(args.text, "text");
if (text === undefined) fail("pass --file draft.md or --text \"…\"");

// several files (a follow-up comparing with an earlier run) are checked as one
const parts = analysisPaths.map((p) => JSON.parse(readFileSync(p, "utf8")));
const analysis = { series: parts.flatMap((a) => a.series ?? []), ranking: parts.flatMap((a) => a.ranking ?? []), topics: parts.flatMap((a) => a.topics ?? []),
  hits: parts.flatMap((a) => (a.excluded ?? []).flatMap((x: { searchHits?: string[] }) => x.searchHits ?? [])) };
const r = checkClaims(text, analysis);
const labelProblems = checkLabels(text, analysis.series);
const lang = str(args.lang, "lang");
const properNames = [...analysis.series.map((s: { article: string }) => s.article), ...analysis.topics, ...analysis.hits];
const languageProblems = lang ? checkLanguage(text, lang.toLowerCase(), properNames) : [];
const ok = r.unverified.length === 0 && r.ratios.length === 0 && labelProblems.length === 0 && languageProblems.length === 0;
printJson({ ok, ...r, labelProblems, languageProblems });
if (!ok) process.exit(EXIT.CHECK_FAILED);
