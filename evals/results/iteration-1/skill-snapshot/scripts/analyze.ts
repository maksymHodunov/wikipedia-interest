#!/usr/bin/env node
/**
 * Full pipeline in one command: resolve → fetch → metrics → charts → analysis.json. See HELP below.
 */
import { resolve as resolvePath, join } from "node:path";
import { ApiError, pageviews, projectTotal } from "./lib/api.ts";
import { resolveTopic, type Resolved } from "./lib/resolve.ts";
import { computeMetrics, rankSeries, spikeMonths, type Point, type SeriesMetrics } from "./lib/metrics.ts";
import { lineChart } from "./lib/svg.ts";
import { EXIT, LANG_RE, dateRange, fail, fmtMonth, handleCli, list, parseArgs, printJson, str, writeOut } from "./lib/util.ts";

const HELP = `
Usage: node scripts/analyze.ts --topic "<English topic>" --langs <codes> [options]

Resolve a topic to one Wikipedia article per language, fetch monthly human pageviews, compute growth/trust
metrics and write charts. Prints a compact JSON summary; full detail goes to <out>/analysis.json.

Required:
  --topic "Astronomy"            one topic (English title works best; the script follows interlanguage links)
  --topics "A,B,C"               or several topics (comma-separated) — compare topics, or build a basket
  --langs uk,pl,cs               Wikipedia language codes (subdomains)

Options:
  --months 24                    period ending at the last complete month (default 24, max 135)
  --start YYYY-MM-DD --end YYYY-MM-DD   explicit period instead of --months (data starts 2015-07-01)
  --articles "pl=Głodówka lecznicza,cs=Půst"   pin article titles per language (single --topic only)
  --source en                    language used to anchor the topic search (default: en for Latin script)
  --out DIR                      output directory (default: out/<topic-slug> under the current directory)
  --no-normalize                 skip per-1M normalisation (saves 1 API call per language)
  --no-bots                      skip automated-traffic fetch (saves 1 API call per series)
  --include-low-confidence       keep articles found only by text search (default: excluded, listed in "excluded")

Examples:
  node scripts/analyze.ts --topic "Intermittent fasting" --langs pl,cs --months 24
  node scripts/analyze.ts --topics "Astronomy,Solar System,Black hole" --langs uk --months 36
  node scripts/analyze.ts --topic "English as a second or foreign language" --langs de,fr,es,pl,tr
`;

const args = parseArgs(process.argv.slice(2));
handleCli(args, HELP, ["topic", "topics", "langs", "months", "start", "end", "articles", "source", "out", "no-normalize", "no-bots", "include-low-confidence", "help"]);

const topics = args.topics !== undefined ? list(str(args.topics, "topics")) : args.topic !== undefined ? [str(args.topic, "topic")!] : [];
if (!topics.length) fail(`--topic or --topics is required. Example: --topic "Astronomy" --langs uk,pl`);
const langs = [...new Set(list(str(args.langs, "langs")))];
if (!langs.length) fail("--langs is required, e.g. --langs uk,pl (Wikipedia subdomains)");
const badLangs = langs.filter((l) => !LANG_RE.test(l));
if (badLangs.length) fail(`invalid language code(s): ${badLangs.join(", ")}. Use Wikipedia subdomains like uk, pl, cs, de, zh-yue.`);
if (langs.length > 8) fail(`at most 8 languages per run (chart readability, API budget); got ${langs.length}. Split into several runs.`);
const source = str(args.source, "source");
if (source !== undefined && !LANG_RE.test(source)) fail(`--source must be a language code, got "${source}"`);

const months = args.months !== undefined ? Number(str(args.months, "months")) : undefined;
const { start, end } = dateRange({ start: str(args.start, "start"), end: str(args.end, "end"), months });
const windowMonths = { start: fmtMonth(start), end: fmtMonth(end) };
const normalize = !args["no-normalize"];
const withBots = !args["no-bots"];
const includeLow = Boolean(args["include-low-confidence"]);
const slug = topics.join("_").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "analysis";
const outDir = resolvePath(str(args.out, "out") ?? join("out", slug));

const explicit: Record<string, string> = {};
for (const kv of list(str(args.articles, "articles"))) {
  const [k, ...v] = kv.split("=");
  if (!k || !v.length || !LANG_RE.test(k.trim())) fail(`--articles entries must look like lang=Title, got "${kv}"`);
  explicit[k.trim()] = v.join("=").trim();
}
if (Object.keys(explicit).length && topics.length > 1) fail("--articles works with a single --topic only; run each topic separately to pin its titles.");
const unknownPins = Object.keys(explicit).filter((l) => !langs.includes(l));
if (unknownPins.length) fail(`--articles names language(s) not in --langs: ${unknownPins.join(", ")}`);

const toPoints = (items: { timestamp: string; views: number }[]): Point[] => items.map((i) => ({ month: fmtMonth(i.timestamp), views: i.views }));
type Series = SeriesMetrics & { name: string; topic: string; resolution: Resolved; spikes: string[] };

try {
  // 1. resolve titles
  const resolved: { topic: string; items: Resolved[] }[] = [];
  for (const t of topics) resolved.push({ topic: t, items: (await resolveTopic(t, langs, { source, explicit })).items });

  // 2. project totals (one call per language)
  const totals: Record<string, Point[]> = {};
  if (normalize) for (const l of langs) totals[l] = toPoints(await projectTotal(`${l}.wikipedia`, start, end));

  // 3. fetch + metrics
  const nameOf = (topic: string, lang: string) => (topics.length > 1 ? (langs.length > 1 ? `${topic} (${lang})` : topic) : lang);
  const series: Series[] = [];
  const warnings: string[] = [];
  const excluded: { topic: string; lang: string; reason: string; searchHits: string[] }[] = [];
  for (const r of resolved) {
    for (const it of r.items) {
      if (!it.article) {
        excluded.push({ topic: r.topic, lang: it.lang, reason: "no article found", searchHits: [] });
        continue;
      }
      if (it.confidence === "low" && !includeLow) {
        // Safe default: a text-search hit with no interlanguage link is usually a different subject.
        excluded.push({ topic: r.topic, lang: it.lang, reason: "no article linked to the topic (text search only)", searchHits: [it.article, ...(it.candidates ?? [])].slice(0, 4) });
        continue;
      }
      const user = toPoints(await pageviews(it.project, it.article, start, end));
      if (!user.length) { warnings.push(`${r.topic}@${it.lang}: "${it.article}" has no pageview data in this period`); continue; }
      const automated = withBots ? toPoints(await pageviews(it.project, it.article, start, end, { agent: "automated" })) : undefined;
      const m = computeMetrics({ lang: it.lang, project: it.project, article: it.article, user, automated, projectTotal: totals[it.lang], window: windowMonths, match: it.confidence });
      if (it.confidence !== "high") warnings.push(`${r.topic}@${it.lang}: "${it.article}" was matched by text search (${it.confidence} confidence) — verify it is the topic, or pin a title with --articles ${it.lang}="<Title>"`);
      series.push({ ...m, name: nameOf(r.topic, it.lang), topic: r.topic, resolution: it, spikes: spikeMonths(m.points).map((p) => p.month) });
    }
  }
  if (excluded.length) {
    warnings.push(`excluded ${excluded.map((x) => `${x.topic}@${x.lang}`).join(", ")}: no article on this topic in those editions (a finding in itself — small or young audience). To use a proxy article, pick one from "excluded[].searchHits" or scripts/resolve.ts --search and pass --articles <lang>="<Title>".`);
  }
  if (!series.length) fail("no usable article for any topic/language: " + warnings.join("; "), EXIT.NO_DATA);

  // 4. charts
  const label = topics.length === 1 ? topics[0]! : `${topics.length} topics`;
  const period = `${windowMonths.start} → ${windowMonths.end}`;
  const markers = Object.fromEntries(series.map((s) => [s.name, s.spikes]));
  const files = { chart: join(outDir, "chart.svg"), chartIndexed: join(outDir, "chart_indexed.svg"), csv: join(outDir, "data.csv"), analysis: join(outDir, "analysis.json") };
  writeOut(files.chart, lineChart(series.map((s) => ({ name: s.name, points: normalize && s.perMillionSeries ? s.perMillionSeries : s.points })), {
    title: `${label}: monthly Wikipedia pageviews`,
    subtitle: `${period} · human (non-bot) views${normalize ? " per 1M views of each language edition" : ""} · ○ = spike month`,
    yLabel: normalize ? "views / 1M edition views" : "views / month", markers,
  }));
  writeOut(files.chartIndexed, lineChart(series.map((s) => ({ name: s.name, points: s.points })), {
    title: `${label}: indexed growth (median of first 6 months = 100)`,
    subtitle: `${period} · human views, each series rebased to its own start · ○ = spike month`, indexed: true, markers,
  }));

  // 5. csv + json
  const csv = ["series,lang,article,month,views_user,views_per_million"].concat(series.flatMap((s) => {
    const pm = new Map((s.perMillionSeries ?? []).map((p) => [p.month, p.views]));
    return s.points.map((p) => `${JSON.stringify(s.name)},${s.lang},${JSON.stringify(s.article)},${p.month},${p.views},${pm.get(p.month)?.toFixed(2) ?? ""}`);
  })).join("\n");
  writeOut(files.csv, csv);
  const ranking = rankSeries(series);
  writeOut(files.analysis, JSON.stringify({ topics, langs, period: { start, end }, normalized: normalize, outDir, files, series, ranking, excluded, warnings }, null, 2));

  // 6. compact summary for the agent (everything needed to answer; detail stays on disk)
  printJson({
    period, normalized: normalize,
    series: series.map((s) => ({
      name: s.name, article: s.article, match: `${s.resolution.method}/${s.resolution.confidence}`,
      verdict: `${s.verdict.label} — ${s.verdict.basis}`,
      relativeGrowth: s.relativeGrowth, robustGrowth: s.robustGrowth, editionGrowth: s.editionGrowth, yoy: s.yoy, trendAnnual: s.trendAnnual, r2: s.r2,
      avgMonthly: s.avgMonthlyLast12, perMillion: s.perMillionLast12, botShare: s.botShare,
      spikeMonths: s.spikes.join(", ") || "none", peak: s.peakMonth ? `${s.peakMonth.month}: ${s.peakMonth.views}` : null,
      trust: `${s.trust.label} (${s.trust.score})`, trustReasons: s.trust.reasons,
    })),
    ranking: ranking.map((r) => `${r.name} (score ${r.score}): ${r.why}`),
    excluded,
    warnings,
    files,
    next: `PDF: node scripts/report.ts --analysis "${files.analysis}" --title "…" --verdict "…" --findings "…|…|…"`,
  });
} catch (e) {
  if (e instanceof ApiError) fail(`${e.message}`, EXIT.API);
  throw e;
}
