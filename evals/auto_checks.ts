#!/usr/bin/env node
/**
 * Automatic checks for one eval run (Claude Code subagent transcript, JSONL), per conversation turn:
 * the final answer of each turn is checked against every analysis.json the agent produced so far —
 * numbers (checkClaims), verdict labels (checkLabels) and language (checkLanguage) — and every
 * report.ts call is listed with its JSON result.
 *
 *   node evals/auto_checks.ts <transcript.jsonl> --lang uk [--data DIR] [--out auto_checks.json]
 *
 * Turns: the first user message, then every message containing "Follow-up message from the same user" (the eval
 * runner's marker); harness notices in between are ignored. --data DIR holds copies taken right after each turn
 * (turn<N>__<slug>__analysis.json) — out/ is shared and later runs overwrite it, so paths in the transcript go stale.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { checkClaims, checkLabels, checkLanguage } from "../scripts/lib/claims.ts";
import { parseArgs, str } from "../scripts/lib/util.ts";

type Block = { type: string; name?: string; text?: string; input?: Record<string, unknown>; content?: unknown };
type Line = { type: string; message?: { content?: Block[] | string } };

const args = parseArgs(process.argv.slice(2));
const file = args._[0];
const lang = str(args.lang, "lang");
if (!file || !lang) { console.error("usage: node evals/auto_checks.ts <transcript.jsonl> --lang <code> [--out file]"); process.exit(2); }

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line);
const resultText = (b: Block) => (typeof b.content === "string" ? b.content : Array.isArray(b.content) ? (b.content as Block[]).map((c) => c.text ?? "").join("") : "");
const parseJsonTail = (s: string) => { const i = s.indexOf("{"); try { return i >= 0 ? JSON.parse(s.slice(i)) : null; } catch { return null; } };

type Turn = { prompt: string; answer: string; analyses: string[]; reports: { command: string; result: unknown }[]; toolCalls: number };
const turns: Turn[] = [];
const pendingReport = new Map<string, string>(); // tool_use id -> command
for (const l of lines) {
  const content = Array.isArray(l.message?.content) ? (l.message!.content as Block[]) : [];
  if (l.type === "user") {
    const text = typeof l.message?.content === "string" ? l.message.content : content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    const isPrompt = turns.length === 0 ? text.trim().length > 0 : text.includes("Follow-up message from the same user");
    if (isPrompt) turns.push({ prompt: text.slice(0, 400), answer: "", analyses: [], reports: [], toolCalls: 0 });
    for (const b of content) {
      if (b.type !== "tool_result") continue;
      const t = resultText(b);
      const cur = turns.at(-1);
      if (!cur) continue;
      for (const m of t.matchAll(/"analysis":\s*"([^"]+analysis\.json)"/g)) if (!cur.analyses.includes(m[1]!)) cur.analyses.push(m[1]!);
      const id = (b as unknown as { tool_use_id?: string }).tool_use_id;
      if (id && pendingReport.has(id)) cur.reports.push({ command: pendingReport.get(id)!.slice(0, 600), result: parseJsonTail(t) });
    }
  }
  if (l.type === "assistant") {
    const cur = turns.at(-1);
    if (!cur) continue;
    for (const b of content) {
      if (b.type === "tool_use") {
        cur.toolCalls++;
        const cmd = String((b.input as { command?: string })?.command ?? "");
        if (cmd.includes("scripts/report.ts")) pendingReport.set((b as unknown as { id: string }).id, cmd);
        if (b.name === "SubagentHandback") cur.answer = String((b.input as { message?: string })?.message ?? "");
      }
      if (b.type === "text" && b.text && !cur.answer) cur.answer = b.text;
    }
  }
}

// check each turn against all analyses produced up to that turn (follow-ups may cite earlier numbers)
const dataDir = str(args.data, "data");
const copies = dataDir && existsSync(dataDir) ? readdirSync(dataDir).filter((f) => /^turn\d+__.*analysis\.json$/.test(f)) : [];
const seen: string[] = [];
const out = turns.map((t, i) => {
  const mine = copies.filter((f) => Number(/^turn(\d+)__/.exec(f)![1]) === i + 1).map((f) => join(dataDir!, f));
  for (const a of dataDir ? mine : t.analyses) if (!seen.includes(a)) seen.push(a);
  const data = seen.filter((p) => existsSync(p)).map((p) => JSON.parse(readFileSync(p, "utf8")));
  const merged = { series: data.flatMap((d) => d.series), ranking: data.flatMap((d) => d.ranking ?? []) };
  const names = [...merged.series.map((s: { article: string }) => s.article), ...data.flatMap((d) => d.topics ?? []),
    ...data.flatMap((d) => (d.excluded ?? []).flatMap((x: { searchHits?: string[] }) => x.searchHits ?? []))];
  const numbers = checkClaims(t.answer, merged);
  // label check over ALL series seen so far: with two topics sharing a language (Copilot pt, Claude pt) it cannot tell
  // which one a sentence means and stays silent — comparing against only the latest analysis gave false alarms
  return {
    turn: i + 1, prompt: t.prompt, toolCalls: t.toolCalls, answerWords: t.answer.split(/\s+/).filter(Boolean).length,
    analyses: t.analyses, numbers, labelProblems: checkLabels(t.answer, merged.series), languageProblems: checkLanguage(t.answer, lang, names),
    reports: t.reports.map((r) => ({ command: r.command, ...(r.result && typeof r.result === "object" ? { ok: (r.result as { ok?: boolean }).ok, pages: (r.result as { pages?: number }).pages, lang: (r.result as { lang?: string }).lang, pdf: (r.result as { pdf?: string }).pdf, problems: (r.result as { problems?: string[] }).problems } : {}) })),
    answer: t.answer,
  };
});
const outFile = str(args.out, "out");
if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 2));
for (const t of out) {
  const n = t.numbers, bad = n.unverified.length + (n.ratios?.length ?? 0);
  console.log(`turn ${t.turn}: ${t.toolCalls} tool calls, ${t.answerWords} words · numbers ${n.checked - bad}/${n.checked}${n.unverified.length ? ` (unverified: ${n.unverified.join(", ")})` : ""}${n.ratios?.length ? ` (ratios: ${n.ratios.join(", ")})` : ""} · labels ${t.labelProblems.length} · language ${t.languageProblems.length}`);
  for (const p of t.languageProblems) console.log(`   language: ${p.slice(0, 180)}`);
  for (const p of t.labelProblems) console.log(`   label: ${p.slice(0, 180)}`);
  for (const r of t.reports) console.log(`   report.ts → ok=${r.ok} pages=${r.pages} lang=${r.lang}${r.problems?.length ? ` problems: ${r.problems.join(" | ").slice(0, 200)}` : ""}`);
}
