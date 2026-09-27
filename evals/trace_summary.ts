#!/usr/bin/env node
/**
 * Summarise a Claude Code subagent transcript (JSONL) for grading: model, every tool call in order, errors.
 * Used to grade eval runs from what the agent actually did, not from its own account of it.
 *
 *   node evals/trace_summary.ts <transcript.jsonl> [--json]
 */
import { readFileSync } from "node:fs";

type Block = { type: string; name?: string; input?: Record<string, unknown>; content?: unknown; is_error?: boolean; text?: string };
type Line = { type: string; message?: { model?: string; role?: string; content?: Block[] | string } };

const file = process.argv[2];
if (!file) { console.error("usage: node evals/trace_summary.ts <transcript.jsonl> [--json]"); process.exit(2); }
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line);
// cut by code points, not UTF-16 units: slicing through an emoji leaves a lone surrogate that breaks JSON consumers (jq)
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");

const models = new Set<string>();
const calls: { tool: string; input: string; error?: string }[] = [];
let finalText = "";
for (const l of lines) {
  const content = Array.isArray(l.message?.content) ? l.message!.content : [];
  if (l.type === "assistant") {
    if (l.message?.model) models.add(l.message.model);
    for (const b of content) {
      if (b.type === "tool_use") {
        const i = b.input ?? {};
        const shown = (i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? JSON.stringify(i)) as string;
        calls.push({ tool: b.name ?? "?", input: cut(String(shown).replace(/\s+/g, " "), 400) });
      }
      if (b.type === "text" && b.text) finalText = b.text;
    }
  }
  if (l.type === "user") {
    for (const b of content) {
      if (b.type === "tool_result" && b.is_error && calls.length) {
        const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        calls[calls.length - 1]!.error = cut(c.replace(/\s+/g, " "), 300);
      }
    }
  }
}
const summary = { models: [...models], toolCalls: calls.length, calls, finalAnswerChars: finalText.length };
if (process.argv.includes("--json")) console.log(JSON.stringify(summary, null, 1));
else {
  console.log(`models: ${summary.models.join(", ")} · tool calls: ${calls.length}`);
  calls.forEach((c, n) => console.log(`${String(n + 1).padStart(2)}. ${c.tool}: ${c.input}${c.error ? `\n    ✖ ${c.error}` : ""}`));
}
