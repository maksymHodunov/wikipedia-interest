/** Eval harness tests: command sandbox + the full agent loop against a local mock of the chat-completions API. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommand, tokenize } from "../evals/safety.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("tokenize keeps quoted text (incl. | ; $) as one argument", () => {
  assert.deepEqual(tokenize(`node scripts/report.ts --findings "a|b; c \\"q\\"" --x 'y $(z)'`),
    ["node", "scripts/report.ts", "--findings", 'a|b; c "q"', "--x", "y $(z)"]);
  assert.throws(() => tokenize(`cat "open`), /unbalanced/);
});

test("checkCommand allows skill scripts and read-only tools inside the skill dir only", () => {
  assert.equal(checkCommand(`node scripts/analyze.ts --topic "X" --langs uk`, ROOT).ok, true);
  assert.equal(checkCommand(`cat SKILL.md`, ROOT).ok, true);
  assert.equal(checkCommand(`node scripts/report.ts --analysis ${join(ROOT, "out/x/analysis.json")} --findings "uk: −63% р/р"`, ROOT).ok, true);
  for (const bad of [`rm -rf /`, `cat /etc/passwd`, `cat ../../secret`, `cat ~/.ssh/id_rsa`, `node -e "process.exit()"`, `node scripts/analyze.ts; rm -rf ~`, `curl https://x.y`]) {
    assert.equal(checkCommand(bad, ROOT).ok, false, bad);
  }
});

test("run_agent.ts: full loop against a mock API — tools run, refusals returned, outputs written", async () => {
  const bodies: { messages: { role: string; content: string | null }[] }[] = [];
  const replies = [
    { tool_calls: [{ id: "1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "node scripts/analyze.ts --help" }) } }] },
    { tool_calls: [
      { id: "2", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "SKILL.md" }) } },
      { id: "3", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "cat /etc/passwd" }) } },
    ] },
    { content: "done" },
  ];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      bodies.push(JSON.parse(body));
      const r = replies[bodies.length - 1]!;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: r.content ?? null, tool_calls: r.tool_calls } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const out = mkdtempSync(join(tmpdir(), "wi-harness-"));
  const code = await new Promise<number | null>((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, "evals", "run_agent.ts"), "--prompt", "hi", "--out", out], {
      env: { ...process.env, OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: `http://127.0.0.1:${port}` }, stdio: "ignore",
    });
    p.on("exit", resolve);
  });
  server.close();
  assert.equal(code, 0);
  assert.equal(bodies.length, 3);
  const toolMsgs = bodies[2]!.messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
  assert.ok(toolMsgs.some((c) => c.startsWith("Usage: node scripts/analyze.ts")), "analyze --help output was returned to the model");
  assert.ok(toolMsgs.some((c) => c.startsWith("---\nname: wikipedia-interest")), "SKILL.md was read");
  assert.ok(toolMsgs.some((c) => c.startsWith("refused: path outside")), "/etc/passwd was refused");
  assert.equal(readFileSync(join(out, "answer.md"), "utf8"), "done");
  assert.equal(JSON.parse(readFileSync(join(out, "timing.json"), "utf8")).total_tokens, 330);
});
