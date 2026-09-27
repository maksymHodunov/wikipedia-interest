/** Small helpers shared by the CLI scripts: argument parsing/validation, exit codes, dates, output. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Exit codes, documented in every script's --help and in SKILL.md. */
export const EXIT = {
  OK: 0,
  USAGE: 2,          // bad or missing arguments
  NO_DATA: 3,        // nothing to analyse (no article / no pageviews)
  API: 4,            // Wikimedia API failed after retries (e.g. HTTP 429) — wait and re-run
  SETUP: 5,          // dependencies missing — run `npm ci` in the skill directory
  CHECK_FAILED: 6,   // report written, but quality checks failed — see "problems" in the output
} as const;

export const EXIT_CODES_HELP = `Exit codes: 0 ok · 2 bad arguments · 3 no data · 4 Wikimedia API failure (wait ~60 s, re-run; cached calls are free) · 5 missing deps (run npm ci) · 6 report checks failed (see "problems")`;

export type Args = { [key: string]: string | true | undefined } & { _: string[] };

/** Minimal argv parser: --key value, --flag. Positional args go to `_`. */
export function parseArgs(argv: string[]): Args {
  const opts: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else opts[key] = true;
    } else positional.push(a);
  }
  return { ...opts, _: positional } as Args;
}

/**
 * Print help and exit on --help; reject unknown flags with the list of valid ones.
 * Cheap models often guess flag names (--language, --period); a precise error fixes that in one turn.
 */
export function handleCli(args: Args, help: string, allowed: string[]): void {
  if (args.help) {
    process.stdout.write(help.trim() + "\n\n" + EXIT_CODES_HELP + "\n");
    process.exit(EXIT.OK);
  }
  const unknown = Object.keys(args).filter((k) => k !== "_" && !allowed.includes(k));
  if (unknown.length) fail(`unknown option(s): ${unknown.map((u) => "--" + u).join(", ")}. Valid: ${allowed.map((a) => "--" + a).join(" ")}. Run with --help for examples.`);
  if (args._.length) fail(`unexpected positional argument(s): ${args._.join(" ")}. Values must follow a flag, e.g. --topic "Astronomy".`);
}

export function str(v: string | true | undefined, flag: string): string | undefined {
  if (v === undefined) return undefined;
  if (v === true) fail(`--${flag} needs a value`);
  return v;
}

export function list(v: string | true | undefined): string[] {
  if (!v || v === true) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Wikipedia language codes are subdomains: uk, pl, zh-yue, be-tarask, simple … */
export const LANG_RE = /^[a-z]{2,3}(-[a-z]{2,8})*$|^simple$/;

/** YYYYMMDD for the REST API. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const DATE_RE = /^\d{4}-?\d{2}-?\d{2}$/;
export const DATA_START = "20150701"; // Wikimedia REST pageviews start here

/** Resolve a date range. `months` back from the last complete month by default. Validates input. */
export function dateRange(opts: { start?: string; end?: string; months?: number }, now = new Date()): { start: string; end: string } {
  for (const [k, v] of [["start", opts.start], ["end", opts.end]] as const) {
    if (v !== undefined && !DATE_RE.test(v)) fail(`--${k} must be YYYY-MM-DD, got "${v}"`);
  }
  if (opts.months !== undefined && (!Number.isInteger(opts.months) || opts.months < 1 || opts.months > 135)) {
    fail(`--months must be an integer 1–135 (data starts 2015-07), got "${opts.months}"`);
  }
  // Pageview data lags ~1–2 days; the current month is always incomplete, so end at the last full month.
  const lastFull = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const end = opts.end ? opts.end.replace(/-/g, "") : ymd(lastFull);
  let start: string;
  if (opts.start) start = opts.start.replace(/-/g, "");
  else {
    const m = opts.months ?? 24;
    start = ymd(new Date(Date.UTC(lastFull.getUTCFullYear(), lastFull.getUTCMonth() - m + 1, 1)));
  }
  if (start < DATA_START) start = DATA_START;
  if (start >= end) fail(`start (${start}) must be before end (${end})`);
  return { start, end };
}

/** "20240901" or "2024090100" -> "2024-09" */
export function fmtMonth(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}`;
}

export function writeOut(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function printJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 1) + "\n");
}

export function fail(msg: string, code: number = EXIT.USAGE): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}
