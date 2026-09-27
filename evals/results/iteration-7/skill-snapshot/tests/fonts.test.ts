/** PDF fonts: which text each font can draw, and that the report never shows empty boxes for titles it cannot draw. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK_FONT, fontFor, type FontChoice } from "../scripts/lib/fonts.ts";
import { buildReportContent, type AnalysisForReport } from "../scripts/lib/report-content.ts";
import { computeMetrics } from "../scripts/lib/metrics.ts";
import { BUILT_IN } from "../scripts/lib/i18n.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("fontFor: DejaVu draws Latin, Cyrillic (incl. Kazakh), Greek, Vietnamese; shaping scripts and emoji never reach pdfkit", () => {
  for (const t of ["Meditation", "Медитація −12,5% р/р «зростає»", "Қаржылық сауаттылық", "Ελληνικά", "Thiền định", "Almanca kursu"]) assert.equal(fontFor(t), "base", t);
  for (const t of ["تأمل", "מדיטציה", "ध्यान", "สมาธิ", "Медитація 🚀"]) assert.equal(fontFor(t), "none", t);
  for (const t of ["瞑想", "명상", "ja · 瞑想", "深度求索"]) assert.equal(fontFor(t), FALLBACK_FONT ? "fallback" : "none", t);
});

function analysis(): AnalysisForReport {
  const user = Array.from({ length: 24 }, (_, i) => ({ month: new Date(Date.UTC(2024, 8 + i, 1)).toISOString().slice(0, 7), views: 1000 + 10 * i }));
  const edition = user.map((p) => ({ month: p.month, views: 5e7 }));
  const one = (lang: string, article: string, topic: string) => ({
    ...computeMetrics({ lang, project: `${lang}.wikipedia`, article, user, projectTotal: edition }),
    name: `${lang}:${topic}`, topic, spikes: [], resolution: { method: "langlink", confidence: "high" },
  });
  return {
    topics: ["Meditation", "Yoga"], langs: ["ja", "en"], period: { start: "20240901", end: "20260831" }, normalized: true,
    series: [one("ja", "瞑想", "Meditation"), one("en", "Yoga", "Yoga")],
    ranking: [{ name: "ja:Meditation", score: 10, why: "" }],
  };
}
const input = { title: "Meditation vs yoga", verdict: "Meditation leads.", findings: ["ja leads", "en follows"], caveats: [], chart: "indexed" as const };
const legend = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
const cjk = (t: string) => /[぀-鿿가-힯]/u.test(t);

test("a CJK title is kept where a fallback font can draw it, but never goes into the one-font chart", () => {
  const draw = (t: string): FontChoice => (cjk(t) ? "fallback" : "base");
  const c = buildReportContent(analysis(), input, BUILT_IN.en!, "en", "2026-09-27", draw);
  assert.equal(c.table.rows[0]![0], "ja · 瞑想");
  assert.ok(c.footer.includes("ja.wikipedia/wiki/瞑想"));
  assert.ok(!legend(c.chartSvg).some(cjk), "chart legend must not contain CJK");
  assert.ok(legend(c.chartSvg).some((t) => t.startsWith("ja: Meditation")));
});

test("with no font for a title, the topic name replaces it everywhere", () => {
  const draw = (t: string): FontChoice => (cjk(t) ? "none" : "base");
  const c = buildReportContent(analysis(), input, BUILT_IN.en!, "en", "2026-09-27", draw);
  const all = [...c.table.rows.flat(), c.footer, ...c.caveats, ...legend(c.chartSvg)].join("\n");
  assert.ok(!cjk(all), all);
  assert.equal(c.table.rows[0]![0], "ja · Meditation");
});

test("report.ts flags agent text the PDF fonts cannot draw (exit 6) and renders CJK titles without complaint", () => {
  const dir = mkdtempSync(join(tmpdir(), "wi-fonts-"));
  const file = join(dir, "analysis.json");
  writeFileSync(file, JSON.stringify(analysis()));
  const run = (findings: string) => spawnSync(process.execPath, [join(ROOT, "scripts", "report.ts"), "--analysis", file, "--lang", "en",
    "--title", "Meditation vs yoga", "--verdict", "Meditation leads in ja.", "--findings", findings, "--out", join(dir, "r.pdf")], { encoding: "utf8" });
  const bad = run("ar: تأمل|ja leads|en follows");
  assert.equal(bad.status, 6, bad.stderr);
  assert.ok(JSON.parse(bad.stdout).problems.some((p: string) => p.includes("cannot draw") && p.includes("تأمل")));
  const good = run("ja leads|en follows|both are close");
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(JSON.parse(good.stdout).pages, 1);
});
