/** Report localisation: dictionaries, labels files, language detection, and a Ukrainian report with no English UI text. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN, LABEL_KEYS, detectLang, validateLabels } from "../scripts/lib/i18n.ts";
import { buildReportContent, type AnalysisForReport } from "../scripts/lib/report-content.ts";
import { computeMetrics } from "../scripts/lib/metrics.ts";
import { checkLanguage } from "../scripts/lib/claims.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every built-in dictionary has every key with the same {placeholders} as English", () => {
  for (const [lang, labels] of Object.entries(BUILT_IN)) {
    const v = validateLabels(labels);
    assert.deepEqual(v.problems, [], lang);
    assert.equal(Object.keys(labels).length, LABEL_KEYS.length, lang);
  }
});

test("validateLabels rejects missing keys and broken placeholders", () => {
  const broken = { ...BUILT_IN.en, footer: "Джерела без плейсхолдерів" } as Record<string, string>;
  delete broken.findings;
  const v = validateLabels(broken);
  assert.equal(v.labels, undefined);
  assert.ok(v.problems.some((p) => p.includes('"findings"')));
  assert.ok(v.problems.some((p) => p.includes('"footer" must keep the placeholders {date},{sources}')));
});

test("detectLang: Ukrainian letters → uk, plain ASCII → en, anything else → ask for --lang", () => {
  assert.equal(detectLang("Інтерес до астрономії спадає"), "uk");
  assert.equal(detectLang("Interest in astronomy is declining"), "en");
  assert.equal(detectLang("Zainteresowanie astronomią spada"), null);
  assert.equal(detectLang("Интерес к астрономии падает"), null);
});

function sampleAnalysis(): AnalysisForReport {
  const user = Array.from({ length: 24 }, (_, i) => ({ month: new Date(Date.UTC(2024, 8 + i, 1)).toISOString().slice(0, 7), views: i < 12 ? 1182 : 437 }));
  const edition = user.map((p, i) => ({ month: p.month, views: i < 12 ? 7e7 : 5e7 }));
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "Астрономія", user, projectTotal: edition });
  return {
    topics: ["Astronomy"], langs: ["uk", "pl"], period: { start: "20240901", end: "20260831" }, normalized: true,
    series: [{ ...m, name: "uk", topic: "Astronomy", spikes: [], resolution: { method: "langlink", confidence: "high" } }],
    ranking: [{ name: "uk", score: 30, why: "" }],
    excluded: [{ topic: "Astronomy", lang: "pl", reason: "no article found" }],
  };
}

test("a Ukrainian report contains no English UI text and passes the Ukrainian language check", () => {
  const c = buildReportContent(sampleAnalysis(), { title: "Астрономія: інтерес", verdict: "Інтерес спадає.", findings: ["uk: спадає"], caveats: [], chart: "indexed" }, BUILT_IN.uk!, "uk", "2026-09-27");
  const svgText = [...c.chartSvg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join("\n");
  const all = [c.title, c.subtitle, c.verdict, ...c.table.header, ...c.table.rows.flat(), ...c.findings, ...c.caveats, c.sectionFindings, c.sectionCaveats, c.footer, svgText].join("\n");
  for (const en of ["Findings", "Assumptions", "Views/mo", "Verdict", "Trust", "monthly", "human", "growing", "declining", "flat", "Sources", "Generated", "Interest over time", "spike month", "median month", "Per 1M", "No article"]) {
    assert.ok(!all.includes(en), `English UI text "${en}" leaked into the Ukrainian report`);
  }
  assert.ok(c.caveats.some((x) => x.startsWith("Немає статті на цю тему в розділах: pl")));
  assert.ok(c.table.rows[0]!.includes("спадає"), "verdict label is translated");
  assert.match(c.table.rows[0]![1]!, /^437$/);
  assert.deepEqual(checkLanguage(all, "uk", ["Астрономія", "Astronomy"]), []);
});

test("report.ts refuses a language without built-in labels and explains the labels template (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-i18n-"));
  const analysis = join(dir, "analysis.json");
  writeFileSync(analysis, JSON.stringify(sampleAnalysis()));
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "report.ts"), "--analysis", analysis, "--lang", "pl", "--title", "Astronomia", "--verdict", "Spada.", "--findings", "a|b|c"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no built-in labels for "pl".*--labels-template/s);
  const t = spawnSync(process.execPath, [join(ROOT, "scripts", "report.ts"), "--labels-template"], { encoding: "utf8" });
  assert.equal(t.status, 0);
  assert.deepEqual(Object.keys(JSON.parse(t.stdout)).sort(), [...LABEL_KEYS].sort());
});
