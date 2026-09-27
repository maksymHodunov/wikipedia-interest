/**
 * One-page A4 PDF report: title, verdict, key-numbers table, chart, findings, caveats, sources.
 * Uses pdfkit + svg-to-pdfkit; DejaVu Sans for Latin/Cyrillic/Greek, a system fallback font for CJK (fonts.ts).
 *
 * The chart shrinks to leave room for the text; the real page count is returned so the caller can
 * tell the agent to shorten its text instead of silently shipping a 2-page "one-pager".
 */
import { createRequire } from "node:module";
import { createWriteStream } from "node:fs";
import PDFDocument from "pdfkit";
import { FALLBACK_FONT, FONT_BOLD, FONT_REGULAR, fontFor } from "./fonts.ts";

const require = createRequire(import.meta.url);
const SVGtoPDF = require("svg-to-pdfkit") as (doc: PDFKit.PDFDocument, svg: string, x: number, y: number, o?: Record<string, unknown>) => void;
export { FONT_BOLD, FONT_REGULAR, fontFor };

export interface ReportContent {
  title: string;
  subtitle?: string;
  verdict: string;               // one-sentence headline answer
  table: { header: string[]; rows: string[][] };
  chartSvg: string;              // 760x350 SVG from svg.ts
  findings: string[];            // 3–5 bullets
  caveats: string[];             // assumptions & limits
  sectionFindings: string;       // localized section headings and footer (see i18n.ts) — no UI text is hard-coded here
  sectionCaveats: string;
  footer: string;
  sources: string[];
}

const INK = "#1f2933", INK2 = "#52606d", RULE = "#d9dee3";
const SVG_W = 760, SVG_H = 350, MARGIN = 40, MIN_CHART_H = 150;

export function renderPdf(content: ReportContent, outPath: string): Promise<{ pages: number }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN }, info: { Title: content.title } });
    let pages = 1;
    doc.on("pageAdded", () => pages++);
    const stream = createWriteStream(outPath);
    doc.pipe(stream);
    doc.registerFont("R", FONT_REGULAR).registerFont("B", FONT_BOLD);
    if (FALLBACK_FONT) doc.registerFont("F", FALLBACK_FONT);
    // DejaVu for Latin/Cyrillic/Greek; the fallback font for text it cannot draw (e.g. Japanese titles)
    const face = (text: string, bold: boolean) => (fontFor(text) === "fallback" ? "F" : bold ? "B" : "R");
    const W = doc.page.width - 2 * MARGIN;
    const bottom = doc.page.height - MARGIN - 22; // leave room for the footer line

    // header
    doc.font(face(content.title, true)).fontSize(16).fillColor(INK).text(content.title, { width: W });
    if (content.subtitle) doc.font(face(content.subtitle, false)).fontSize(9.5).fillColor(INK2).text(content.subtitle, { width: W });
    doc.moveDown(0.4);
    doc.font(face(content.verdict, true)).fontSize(11).fillColor(INK).text(content.verdict, { width: W });
    doc.moveDown(0.5);

    // table
    const cols = content.table.header.length;
    const colW = [W * 0.25, ...Array(cols - 1).fill((W * 0.75) / (cols - 1))] as number[];
    let y = doc.y;
    const rowH = 15;
    const drawRow = (cells: string[], bold: boolean) => {
      let x = MARGIN;
      cells.forEach((c, i) => {
        doc.font(face(c, bold)).fontSize(bold ? 7.5 : 8).fillColor(INK).text(c, x + 2, y + 3, { width: colW[i]! - 4, height: rowH, ellipsis: true, lineBreak: false });
        x += colW[i]!;
      });
      y += rowH;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + W, y).strokeColor(RULE).lineWidth(0.5).stroke();
    };
    drawRow(content.table.header, true);
    content.table.rows.forEach((r) => drawRow(r, false));
    y += 8;

    // measure the text sections first, then give the chart whatever height is left
    const sectionHeight = (items: string[], size: number) => {
      let h = doc.font("B").fontSize(10).heightOfString("X", { width: W }) + 2 + 4;
      doc.font("R").fontSize(size);
      for (const it of items) h += doc.heightOfString(`• ${it}`, { width: W - 6 }) + 1;
      return h;
    };
    const textH = sectionHeight(content.findings, 9) + sectionHeight(content.caveats, 8) + 6;
    const fullScale = W / SVG_W;
    const chartH = Math.max(MIN_CHART_H, Math.min(SVG_H * fullScale, bottom - y - textH));
    const scale = chartH / SVG_H;
    const chartX = MARGIN + (W - SVG_W * scale) / 2;
    doc.save().translate(chartX, y).scale(scale);
    SVGtoPDF(doc, content.chartSvg, 0, 0, { assumePt: true, fontCallback: (_family: string, bold: boolean) => (bold ? FONT_BOLD : FONT_REGULAR) });
    doc.restore();
    y += chartH + 6;

    const section = (title: string, items: string[], size: number) => {
      doc.font("B").fontSize(10).fillColor(INK).text(title, MARGIN, y, { width: W });
      y = doc.y + 2;
      for (const it of items) {
        doc.font(face(it, false)).fontSize(size).fillColor(INK).text(`• ${it}`, MARGIN + 6, y, { width: W - 6 });
        y = doc.y + 1;
      }
      y += 4;
    };
    section(content.sectionFindings, content.findings, 9);
    section(content.sectionCaveats, content.caveats, 8);

    // footer on the current (last) page, inside the bottom margin
    doc.page.margins.bottom = 0;
    doc.font(face(content.footer, false)).fontSize(7.5).fillColor(INK2).text(content.footer, MARGIN, doc.page.height - MARGIN - 14, { width: W, height: 20, ellipsis: true });
    doc.end();
    stream.on("finish", () => resolve({ pages }));
    stream.on("error", reject);
  });
}
