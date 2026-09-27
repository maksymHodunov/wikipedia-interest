/**
 * Dependency-free SVG line chart for monthly series.
 * Design rules: one y-axis, ≤ 8 fixed-order categorical hues (colorblind-validated),
 * thin 2px lines, recessive grid, legend + direct end labels, text in ink colours (never series colour).
 */
import { median, type Point } from "./metrics.ts";

export const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const INK = "#1f2933", INK2 = "#52606d", GRID = "#e4e7eb", SURFACE = "#ffffff";
const FONT = "DejaVu Sans, Helvetica, Arial, sans-serif";

export interface ChartSeries { name: string; points: Point[] }
export interface ChartOpts {
  title: string;
  subtitle?: string;
  yLabel?: string;
  width?: number;
  height?: number;
  /** Rebase every series to 100 = its median month (or the median of its first `indexBase` months). */
  indexed?: boolean;
  indexBase?: number;
  /** Number formatter for axis ticks and end labels (locale-aware in reports). */
  fmt?: (v: number) => string;
  /** Highlight months (e.g. spikes) with a small marker. */
  markers?: Record<string, string[]>; // seriesName -> months
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function niceTicks(max: number, n = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(v);
  return out;
}
const fmtNum = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v * 10) / 10}`);

/**
 * Rebase to 100 = the series' median month (default) or the median of its first `base` months.
 * A median keeps one spike from distorting the base. The whole-period default also survives new articles: with a
 * first-months base, an article created mid-period had a base near 0 and its line shot to millions (seen in testing).
 */
export function indexSeries(points: Point[], base?: number): Point[] {
  const vals = (base === undefined ? points : points.slice(0, base)).map((p) => p.views);
  const b = median(vals) || median(vals.filter((v) => v > 0));
  return b > 0 ? points.map((p) => ({ month: p.month, views: (p.views / b) * 100 })) : points;
}

export function lineChart(series: ChartSeries[], o: ChartOpts): string {
  const W = o.width ?? 760, H = o.height ?? 350;
  const m = { top: 66, right: 132, bottom: 44, left: 56 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const data = series.slice(0, PALETTE.length).map((s) => ({ ...s, points: o.indexed ? indexSeries(s.points, o.indexBase) : s.points }));
  const f = o.fmt ?? fmtNum;

  const months = [...new Set(data.flatMap((s) => s.points.map((p) => p.month)))].sort();
  const xi = new Map(months.map((mo, i) => [mo, i]));
  const yMax = Math.max(1, ...data.flatMap((s) => s.points.map((p) => p.views)));
  const ticks = niceTicks(yMax);
  const yTop = ticks[ticks.length - 1]!;
  const x = (mo: string) => m.left + (months.length > 1 ? (xi.get(mo)! / (months.length - 1)) * pw : pw / 2);
  const y = (v: number) => m.top + ph - (v / yTop) * ph;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  parts.push(`<text x="${m.left}" y="22" font-size="15" font-weight="bold" fill="${INK}">${esc(o.title)}</text>`);
  if (o.subtitle) parts.push(`<text x="${m.left}" y="40" font-size="11" fill="${INK2}">${esc(o.subtitle)}</text>`);

  // grid + y axis
  for (const t of ticks) {
    parts.push(`<line x1="${m.left}" x2="${m.left + pw}" y1="${y(t)}" y2="${y(t)}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${m.left - 6}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="${INK2}">${esc(f(t))}</text>`);
  }
  if (o.yLabel) parts.push(`<text x="${m.left}" y="${m.top - 8}" font-size="10" fill="${INK2}">${esc(o.yLabel)}</text>`);

  // x axis labels: every k-th month
  const k = months.length > 30 ? 6 : months.length > 14 ? 3 : 1;
  months.forEach((mo, i) => {
    if (i % k === 0 || i === months.length - 1) {
      parts.push(`<text x="${x(mo)}" y="${m.top + ph + 16}" font-size="10" text-anchor="middle" fill="${INK2}">${mo}</text>`);
    }
  });

  // lines
  const endLabels: { y: number; text: string; color: string }[] = [];
  data.forEach((s, i) => {
    const color = PALETTE[i]!;
    const pts = s.points.filter((p) => xi.has(p.month));
    if (!pts.length) return;
    const d = pts.map((p, j) => `${j ? "L" : "M"}${x(p.month).toFixed(1)},${y(p.views).toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const mo of o.markers?.[s.name] ?? []) {
      const p = pts.find((q) => q.month === mo);
      if (p) parts.push(`<circle cx="${x(p.month)}" cy="${y(p.views)}" r="4" fill="${SURFACE}" stroke="${color}" stroke-width="2"/>`);
    }
    const last = pts[pts.length - 1]!;
    const label = Array.from(s.name).length > 14 ? Array.from(s.name).slice(0, 13).join("") + "…" : s.name;
    endLabels.push({ y: y(last.views), text: `${label} ${f(last.views)}`, color });
  });
  // de-overlap direct labels (min 13px apart)
  endLabels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) if (endLabels[i]!.y - endLabels[i - 1]!.y < 13) endLabels[i]!.y = endLabels[i - 1]!.y + 13;
  // then push back up from the bottom edge so the lowest labels stay inside the chart
  for (let i = endLabels.length - 1; i >= 0; i--) {
    const limit = i === endLabels.length - 1 ? H - 6 : endLabels[i + 1]!.y - 13;
    if (endLabels[i]!.y > limit) endLabels[i]!.y = limit;
  }
  for (const l of endLabels) {
    parts.push(`<circle cx="${m.left + pw + 8}" cy="${l.y}" r="3" fill="${l.color}"/>`);
    parts.push(`<text x="${m.left + pw + 14}" y="${l.y + 4}" font-size="10" fill="${INK}">${esc(l.text)}</text>`);
  }
  parts.push(`<line x1="${m.left}" x2="${m.left + pw}" y1="${m.top + ph}" y2="${m.top + ph}" stroke="#9aa5b1" stroke-width="1"/>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}
