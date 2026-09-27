/**
 * Which font can draw a piece of text in the PDF.
 *
 * DejaVu Sans (bundled) covers Latin, Cyrillic and Greek, but not CJK — Japanese and Korean article titles came out as
 * empty boxes in testing. Text DejaVu cannot draw uses a fallback font when one exists (Arial Unicode on macOS and
 * Windows, or a TTF/OTF path in WI_FALLBACK_FONT). Scripts that need shaping (Arabic, Hebrew, Indic, Thai, …) are never
 * given to pdfkit, which cannot shape them: callers substitute a readable label instead.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

const require = createRequire(import.meta.url);
type Face = { hasGlyphForCodePoint(cp: number): boolean };
const fontkit = require("fontkit") as { openSync(path: string): Face };

const FONT_DIR = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
export const FONT_REGULAR = join(FONT_DIR, "DejaVuSans.ttf");
export const FONT_BOLD = join(FONT_DIR, "DejaVuSans-Bold.ttf");

const CANDIDATES = [
  process.env.WI_FALLBACK_FONT,
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "C:\\Windows\\Fonts\\ARIALUNI.TTF",
].filter((p): p is string => !!p);
export const FALLBACK_FONT: string | null = CANDIDATES.find((p) => /\.(ttf|otf)$/i.test(p) && existsSync(p)) ?? null;

const base = fontkit.openSync(FONT_REGULAR);
let fallback: Face | null | undefined; // opened on first need: Arial Unicode is ~23 MB
const fallbackFace = () => (fallback === undefined ? (fallback = FALLBACK_FONT ? fontkit.openSync(FALLBACK_FONT) : null) : fallback);
// Hebrew, Arabic, Syriac, Thaana, N'Ko, Indic scripts, Thai, Lao, Tibetan, Myanmar, Khmer, Arabic/Hebrew presentation forms
const NEEDS_SHAPING = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0FFF\u1000-\u109F\u1780-\u17FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

const covers = (face: Face, text: string) =>
  [...text].every((ch) => /\s/u.test(ch) || face.hasGlyphForCodePoint(ch.codePointAt(0)!));

export type FontChoice = "base" | "fallback" | "none";

export function fontFor(text: string): FontChoice {
  if (NEEDS_SHAPING.test(text)) return "none";
  if (covers(base, text)) return "base";
  const f = fallbackFace();
  if (f && covers(f, text)) return "fallback";
  return "none";
}
