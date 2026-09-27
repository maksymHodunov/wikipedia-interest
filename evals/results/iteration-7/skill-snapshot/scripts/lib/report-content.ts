/**
 * Build everything that goes into the PDF from analysis.json + the agent's text, in ONE language.
 * Pure (no pdfkit, no font files), so tests can check that a Ukrainian report contains no English UI strings.
 * Which characters the PDF fonts can draw is passed in (fonts.ts fontFor) — see `draw` below.
 */
import { fill, numberFormat, type Labels } from "./i18n.ts";
import { lineChart } from "./svg.ts";
import type { FontChoice } from "./fonts.ts";
import type { Point, SeriesMetrics } from "./metrics.ts";
import type { ReportContent } from "./pdf.ts";

export type ReportSeries = SeriesMetrics & { name: string; topic: string; spikes: string[]; resolution?: { method: string; confidence: string } };
export type AnalysisForReport = {
  topics: string[]; langs: string[]; period: { start: string; end: string }; normalized: boolean;
  series: ReportSeries[];
  ranking: { name: string; score: number; why: string }[];
  excluded?: { topic: string; lang: string; reason: string }[];
};
export type ReportInput = { title?: string; verdict?: string; findings: string[]; caveats: string[]; chart: "indexed" | "absolute" };

const ym = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}`;

export function buildReportContent(
  a: AnalysisForReport, input: ReportInput, L: Labels, lang: string, date: string,
  draw: (text: string) => FontChoice = () => "base",
): ReportContent {
  const nf1 = numberFormat(lang, { maximumFractionDigits: 1 });
  const nf0 = numberFormat(lang, { maximumFractionDigits: 0 });
  const compact = numberFormat(lang, { notation: "compact", maximumFractionDigits: 1 });
  const pct = (x: number | null) => (x === null ? "—" : `${x > 0 ? "+" : ""}${nf1.format(x)}%`);
  const verdict = (s: ReportSeries) => L[s.verdict.label === "insufficient-data" ? "verdict_insufficient" : (`verdict_${s.verdict.label}` as const)];
  const trust = (s: ReportSeries) => `${L[`trust_${s.trust.label}` as const]} ${s.trust.score}`;
  const multiTopic = new Set(a.series.map((s) => s.topic)).size > 1;
  // names are language codes and article titles — proper names in their own edition, never English UI text.
  // A title the PDF fonts cannot draw (CJK without a fallback font; Arabic, Hebrew, Indic… which need shaping) is
  // replaced by the topic it was resolved from, so the reader never sees empty boxes. The chart has one font (DejaVu),
  // so its legend only uses names that font can draw.
  const title = (s: ReportSeries) => [s.article, s.topic].find((t) => draw(t) !== "none");
  const series = (s: ReportSeries) => { const t = title(s); return t ? `${s.lang} · ${t}` : s.lang; };
  const display = (s: ReportSeries) => {
    const t = [s.article, s.topic].find((x) => draw(x) === "base");
    return multiTopic && t ? `${s.lang}: ${t}` : s.lang;
  };
  const period = `${ym(a.period.start)} – ${ym(a.period.end)}`;

  const table = a.normalized
    ? {
        header: [L.colSeries, L.colViews, L.colPer1M, L.colRel, L.colRaw, L.colEdition, L.colVerdict, L.colTrust],
        rows: a.series.map((s) => [series(s), nf0.format(s.avgMonthlyLast12), s.perMillionLast12 === null ? "—" : nf1.format(s.perMillionLast12),
          pct(s.relativeGrowth), pct(s.robustGrowth), pct(s.editionGrowth), verdict(s), trust(s)]),
      }
    : {
        header: [L.colSeries, L.colViews, L.colTotal12, L.colMedYoY, L.colNaiveYoY, L.colTrend, L.colVerdict, L.colTrust],
        rows: a.series.map((s) => [series(s), nf0.format(s.avgMonthlyLast12), nf0.format(s.totalLast12),
          pct(s.robustGrowth), pct(s.yoy), pct(s.trendAnnual), verdict(s), trust(s)]),
      };

  const absolute = input.chart === "absolute";
  const chartSvg = lineChart(
    a.series.map((s) => ({ name: display(s), points: (absolute && a.normalized && s.perMillionSeries ? s.perMillionSeries : s.points) as Point[] })),
    {
      title: absolute ? L.chartTitleAbsolute : L.chartTitle,
      subtitle: fill(absolute ? L.chartSubtitleAbsolute : L.chartSubtitle, { period }),
      yLabel: absolute ? (a.normalized ? L.chartYAbsolute : L.colViews) : undefined,
      indexed: !absolute,
      markers: Object.fromEntries(a.series.map((s) => [display(s), s.spikes])),
      fmt: (v) => compact.format(v),
    },
  );

  const best = a.ranking[0];
  const draftVerdict = best && a.series.some((s) => s.verdict.label === "growing") ? fill(L.draft_verdict_growing, { name: best.name }) : L.draft_verdict_none;
  const draftFindings = a.series.slice(0, 5).map((s) => fill(L.draft_finding, {
    name: series(s), verdict: verdict(s), rel: pct(s.relativeGrowth ?? s.robustGrowth), views: nf0.format(s.avgMonthlyLast12), trust: trust(s),
  }));

  const excludedLangs = [...new Set((a.excluded ?? []).map((x) => x.lang))];
  const searchMatched = a.series.filter((s) => s.resolution && s.resolution.confidence !== "high").map((s) => series(s));
  const caveats = [
    ...input.caveats,
    ...(excludedLangs.length ? [fill(L.cav_excluded, { list: excludedLangs.join(", ") })] : []),
    ...(searchMatched.length ? [fill(L.cav_search, { list: searchMatched.join(", ") })] : []),
    L.cav_curiosity, L.cav_human,
    ...(a.normalized ? [L.cav_relative, L.cav_perMillion] : []),
    L.cav_basket,
  ].slice(0, 6);

  const sources = ["wikimedia.org/api/rest_v1/metrics/pageviews", ...a.series.map((s) => (draw(s.article) === "none" ? s.project : `${s.project}/wiki/${s.article}`))];
  return {
    title: input.title ?? fill(L.title, { topics: a.topics.join(", "), langs: a.langs.join(", ") }),
    subtitle: fill(L.subtitle, { period }),
    verdict: input.verdict ?? draftVerdict,
    table, chartSvg,
    findings: input.findings.length ? input.findings : draftFindings,
    caveats,
    sectionFindings: L.findings,
    sectionCaveats: L.caveats,
    footer: fill(L.footer, { sources: sources.join("; "), date }),
    sources,
  };
}
