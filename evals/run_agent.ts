#!/usr/bin/env node
/**
 * Minimal agent harness: run one eval of this skill on any OpenAI-compatible chat API (default: OpenRouter).
 *
 *   OPENROUTER_API_KEY=… node evals/run_agent.ts --eval 1 [--model anthropic/claude-haiku-4.5] [--out DIR]
 *   OPENROUTER_API_KEY=… node evals/run_agent.ts --prompt "…"            # ad-hoc prompt
 *
 * The model sees only the skill's name/description/location (like a skills-enabled client) and two tools:
 *   bash       — commands are tokenized and run WITHOUT a shell (see evals/safety.ts): node scripts/*.ts, ls, cat, head, tail, wc, jq
 *   read_file  — files inside the skill directory
 * Writes <out>/transcript.md, <out>/answer.md and <out>/timing.json ({ total_tokens, duration_ms }), the layout
 * used by agentskills.io "Evaluating skill output quality". Env: OPENROUTER_BASE_URL overrides the API base URL.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, str } from "../scripts/lib/util.ts";
import { checkCommand } from "./safety.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const model = str(args.model, "model") ?? "anthropic/claude-haiku-4.5";
const evals = JSON.parse(readFileSync(join(ROOT, "evals", "evals.json"), "utf8")) as { evals: { id: number; prompt: string }[] };
const evalId = args.eval !== undefined ? Number(str(args.eval, "eval")) : undefined;
const prompt = str(args.prompt, "prompt") ?? evals.evals.find((e) => e.id === evalId)?.prompt;
if (!prompt) { console.error(`pass --eval <id> (one of ${evals.evals.map((e) => e.id).join(", ")}) or --prompt "…"`); process.exit(2); }
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY is required"); process.exit(2); }
const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const maxTurns = Number(str(args["max-turns"], "max-turns") ?? 16);
const outDir = resolve(str(args.out, "out") ?? join(ROOT, "evals", "runs", `${evalId ?? "adhoc"}-${new Date().toISOString().replace(/[:.]/g, "-")}`));

const description = /^description:\s*(.+)$/m.exec(readFileSync(join(ROOT, "SKILL.md"), "utf8"))?.[1] ?? "";
const system = `You are a helpful analyst agent with tools. Your working directory is ${ROOT}.
<available_skills>
<skill><name>wikipedia-interest</name><description>${description}</description><location>SKILL.md</location></skill>
</available_skills>
Skills are loaded on demand: when a request matches a skill, read its SKILL.md with read_file first and follow it.`;
const tools = [
  { type: "function", function: { name: "bash", description: "Run one command in the working directory. No shell: pipes, redirects and ; are not interpreted. Allowed: node scripts/<name>.ts …, ls, cat, head, tail, wc, jq.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "read_file", description: "Read a text file inside the working directory.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
];

function runTool(name: string, input: Record<string, string>): string {
  try {
    if (name === "bash") {
      const c = checkCommand(input.command ?? "", ROOT);
      if (!c.ok) return `refused: ${c.reason}`;
      const [prog, ...rest] = c.argv;
      return execFileSync(prog === "node" ? process.execPath : prog!, rest, { cwd: ROOT, encoding: "utf8", timeout: 240_000, maxBuffer: 8e6, stdio: ["ignore", "pipe", "pipe"] }).slice(0, 15000);
    }
    if (name === "read_file") {
      const p = resolve(ROOT, input.path ?? "");
      const rel = relative(ROOT, p);
      if (rel.startsWith("..") || isAbsolute(rel)) return "refused: path outside the working directory";
      return readFileSync(p, "utf8").slice(0, 15000);
    }
    return `unknown tool ${name}`;
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string; message: string };
    return `exit ${err.status ?? "?"}\n${err.stdout ?? ""}\n${err.stderr ?? err.message}`.slice(0, 6000);
  }
}

type Msg = { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string };
const messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: prompt }];
const log: string[] = [`# ${model}\n\n**Prompt:** ${prompt}\n`];
const usage = { prompt_tokens: 0, completion_tokens: 0 };
const t0 = Date.now();

for (let turn = 0; turn < maxTurns; turn++) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, temperature: 0.2 }),
  });
  const data = (await res.json()) as { choices?: { message: Msg }[]; usage?: typeof usage; error?: { message: string } };
  if (data.error || !data.choices?.length) throw new Error(`API error: ${data.error?.message ?? res.status}`);
  if (data.usage) { usage.prompt_tokens += data.usage.prompt_tokens; usage.completion_tokens += data.usage.completion_tokens; }
  const msg = data.choices[0]!.message;
  messages.push(msg);
  if (msg.content) log.push(`\n## assistant (turn ${turn + 1})\n\n${msg.content}\n`);
  if (!msg.tool_calls?.length) break;
  for (const tc of msg.tool_calls) {
    let input: Record<string, string> = {};
    try { input = JSON.parse(tc.function.arguments || "{}"); } catch { /* malformed JSON from the model */ }
    const out = runTool(tc.function.name, input);
    log.push(`\n### tool ${tc.function.name}\n\`\`\`\n${JSON.stringify(input)}\n\`\`\`\n<details><summary>output</summary>\n\n\`\`\`\n${out.slice(0, 3000)}\n\`\`\`\n</details>\n`);
    messages.push({ role: "tool", tool_call_id: tc.id, content: out });
  }
}

const answer = [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "(no final answer)";
const timing = { total_tokens: usage.prompt_tokens + usage.completion_tokens, duration_ms: Date.now() - t0, model };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "transcript.md"), log.join("\n") + `\n---\n${JSON.stringify(timing)}\n`);
writeFileSync(join(outDir, "answer.md"), answer);
writeFileSync(join(outDir, "timing.json"), JSON.stringify(timing, null, 2));
console.log(answer);
console.error(`\nsaved to ${outDir} · ${JSON.stringify(timing)}`);
