/** CLI contract tests: run the real scripts as subprocesses. None of these reach the network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], { encoding: "utf8", cwd: tmpdir() });

for (const script of ["analyze.ts", "report.ts", "resolve.ts", "check_claims.ts"]) {
  test(`${script} --help prints usage and exit codes, exits 0`, () => {
    const r = run(script, "--help");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Usage: node scripts\//);
    assert.match(r.stdout, /Exit codes:/);
  });
}

test("analyze.ts rejects an unknown flag with the list of valid ones (exit 2)", () => {
  const r = run("analyze.ts", "--topic", "Astronomy", "--language", "uk");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option\(s\): --language\. Valid: .*--langs/);
});

test("analyze.ts validates language codes, months and --articles before any API call", () => {
  assert.match(run("analyze.ts", "--topic", "X", "--langs", "Ukrainian").stderr, /invalid language code/);
  assert.match(run("analyze.ts", "--topic", "X", "--langs", "uk", "--months", "500").stderr, /--months must be an integer 1–135/);
  assert.match(run("analyze.ts", "--topics", "A,B", "--langs", "uk", "--articles", "uk=Foo").stderr, /single --topic only/);
  assert.match(run("analyze.ts", "--topic", "X", "--langs", "uk", "--articles", "pl=Foo").stderr, /not in --langs: pl/);
});

test("report.ts: missing analysis → exit 3; bad --chart → exit 2", () => {
  assert.equal(run("report.ts", "--analysis", "/nonexistent/analysis.json").status, 3);
  const dir = mkdtempSync(join(tmpdir(), "wi-"));
  writeFileSync(join(dir, "analysis.json"), "{}");
  const r = run("report.ts", "--analysis", join(dir, "analysis.json"), "--chart", "pie");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--chart must be one of: indexed, absolute/);
});

test("check_claims.ts flags an invented number (exit 6) and passes real ones (exit 0)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-"));
  const analysis = join(dir, "analysis.json");
  writeFileSync(analysis, JSON.stringify({
    series: [{ yoy: -59.6, robustGrowth: -63, trendAnnual: -63.9, r2: 0.66, avgMonthlyLast12: 559, totalLast12: 6708, perMillionLast12: 9.7,
      trust: { score: 80 }, months: 24, peakMonth: { month: "2024-09", views: 4687 }, botShare: 0.28, spikeShare: 0.08, completeness: 1, points: [] }],
  }));
  const bad = run("check_claims.ts", "--analysis", analysis, "--text", "Зростання +45% за рік");
  assert.equal(bad.status, 6);
  assert.deepEqual(JSON.parse(bad.stdout).unverified, ["+45%"]);
  const ok = run("check_claims.ts", "--analysis", analysis, "--text", "Падіння −63% (наївно −59.6%), 559 переглядів/міс, 28% ботів");
  assert.equal(ok.status, 0, ok.stdout);
});

test("analyze.ts validates --lang before any API call", () => {
  const r = run("analyze.ts", "--topic", "X", "--langs", "uk", "--lang", "Ukrainian!");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--lang must be a language code/);
});
