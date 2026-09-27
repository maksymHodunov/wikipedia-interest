/**
 * Command sandbox for the eval harness. Model-issued commands are tokenized here and executed WITHOUT a shell
 * (execFile), so `;`, `|`, `&&`, `$(…)` and backticks are plain characters, never operators.
 * Allowed: `node scripts/<name>.ts …` and read-only ls/cat/head/tail/wc/jq; every path must stay inside the skill dir.
 */
import { isAbsolute, relative, resolve } from "node:path";

/** POSIX-like tokenizer: whitespace splits; '…' is literal; "…" allows \" and \\; backslash escapes outside quotes. */
export function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "", inTok = false, q: "'" | '"' | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (q === "'") { if (ch === "'") q = null; else cur += ch; continue; }
    if (q === '"') {
      if (ch === '"') q = null;
      else if (ch === "\\" && (cmd[i + 1] === '"' || cmd[i + 1] === "\\")) cur += cmd[++i];
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; inTok = true; continue; }
    if (ch === "\\" && i + 1 < cmd.length) { cur += cmd[++i]; inTok = true; continue; }
    if (/\s/.test(ch)) { if (inTok) { out.push(cur); cur = ""; inTok = false; } continue; }
    cur += ch; inTok = true;
  }
  if (q) throw new Error("unbalanced quotes");
  if (inTok) out.push(cur);
  return out;
}

const READ_ONLY = new Set(["ls", "cat", "head", "tail", "wc", "jq"]);

export function checkCommand(cmd: string, root: string): { ok: true; argv: string[] } | { ok: false; reason: string } {
  let argv: string[];
  try { argv = tokenize(cmd); } catch (e) { return { ok: false, reason: (e as Error).message }; }
  if (!argv.length) return { ok: false, reason: "empty command" };
  const [prog, first] = argv;
  if (prog === "node") {
    if (!first || !/^scripts\/[\w-]+\.ts$/.test(first)) return { ok: false, reason: "node may only run scripts/<name>.ts" };
  } else if (!READ_ONLY.has(prog!)) {
    return { ok: false, reason: `"${prog}" is not allowed; use node scripts/*.ts or ${[...READ_ONLY].join("/")}` };
  }
  for (const a of argv.slice(1)) {
    if (!a.includes("/") || a.startsWith("--")) continue; // flags and plain words; text like "р/р" resolves inside root
    if (a.startsWith("~")) return { ok: false, reason: "~ paths are not allowed" };
    const rel = relative(root, resolve(root, a));
    if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, reason: `path outside the skill directory: ${a}` };
  }
  return { ok: true, argv };
}
