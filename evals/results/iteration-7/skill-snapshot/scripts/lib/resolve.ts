/**
 * Map a free-text topic to concrete article titles in each requested language edition.
 *
 * Strategy (cheap → reliable):
 *  1. Search the topic in the `source` language (default: the first requested lang,
 *     or `en` when the topic looks Latin-script) and take the top hit.
 *  2. Follow interlanguage links from that article to every requested language.
 *  3. For languages without a link, fall back to a direct search in that language.
 *  Every resolution records *how* it was found so the agent can flag low-confidence matches.
 *
 *  Two anchor checks, both added after real failures in testing:
 *   - disambiguation: "Python" / "Claude" resolve to disambiguation pages → nothing is analysed; the agent gets
 *     the other search hits and re-runs with a specific title ("Python (programming language)").
 *   - title mismatch: "Claude Code" has no article; search returned "Claude (AI)" and every edition's chatbot
 *     article was reported as "Claude Code +399 %". If a topic word is missing from the anchor title, the
 *     matches are marked low confidence (excluded by default) and the closest title is named.
 */
import { isDisambiguation, langlinks, search } from "./api.ts";

export interface Resolved {
  lang: string;
  project: string; // e.g. "uk.wikipedia"
  article: string | null;
  method: "explicit" | "langlink" | "search" | "none";
  confidence: "high" | "medium" | "low";
  candidates?: string[]; // other search hits, for the agent to double-check
  note?: "disambiguation" | "title-mismatch";
}

export interface ResolveResult {
  topic: string;
  source: { lang: string; article: string | null };
  items: Resolved[];
  anchorIssue?: { kind: "disambiguation" | "title-mismatch"; anchor: string; searchHits: string[] };
}

const STOP = new Set(["the", "of", "a", "an", "and", "in", "on", "for", "to", "with", "de", "la", "le", "el"]);
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));
const singular = (w: string) => w.replace(/(es|s)$/, "");

/** Does the article title contain every significant word of the topic? ("Python" ⊂ "Python (programming language)") */
export function titleMatches(topic: string, title: string): boolean {
  const t = new Set(words(title).map(singular));
  return words(topic).every((w) => t.has(singular(w)));
}

const looksLatin = (s: string) => !/[^\u0000-ɏ\s\p{P}]/u.test(s);

export async function resolveTopic(
  topic: string,
  langs: string[],
  opts: { source?: string; explicit?: Record<string, string> } = {},
): Promise<ResolveResult> {
  const explicit = opts.explicit ?? {};
  const source = opts.source ?? (looksLatin(topic) ? "en" : langs[0]!);

  // 1. anchor article in the source language
  const hits = await search(source, topic, 5);
  const anchor = hits[0]?.title ?? null;
  let anchorIssue: ResolveResult["anchorIssue"];
  if (anchor && Object.keys(explicit).length < langs.length) {
    const others = hits.slice(1).map((h) => h.title);
    if (await isDisambiguation(source, anchor)) anchorIssue = { kind: "disambiguation", anchor, searchHits: others };
    else if (!titleMatches(topic, anchor)) anchorIssue = { kind: "title-mismatch", anchor, searchHits: [anchor, ...others].slice(0, 5) };
  }
  if (anchorIssue?.kind === "disambiguation") {
    // an ambiguous title means we do not know the subject: analyse nothing except explicitly pinned titles
    const items: Resolved[] = langs.map((lang) => explicit[lang]
      ? { lang, project: `${lang}.wikipedia`, article: explicit[lang]!, method: "explicit" as const, confidence: "high" as const }
      : { lang, project: `${lang}.wikipedia`, article: null, method: "none" as const, confidence: "low" as const, candidates: anchorIssue!.searchHits, note: "disambiguation" as const });
    return { topic, source: { lang: source, article: anchor }, items, anchorIssue };
  }

  // 2. interlanguage links
  let links: Record<string, string> = {};
  if (anchor) links = await langlinks(source, anchor);
  const linkConfidence: Resolved["confidence"] = anchorIssue?.kind === "title-mismatch" ? "low" : "high";

  const items: Resolved[] = [];
  for (const lang of langs) {
    const project = `${lang}.wikipedia`;
    if (explicit[lang]) {
      items.push({ lang, project, article: explicit[lang]!, method: "explicit", confidence: "high" });
      continue;
    }
    if (links[lang]) {
      items.push({ lang, project, article: links[lang]!, method: "langlink", confidence: linkConfidence,
        ...(linkConfidence === "low" && { note: "title-mismatch" as const, candidates: anchorIssue!.searchHits }) });
      continue;
    }
    // 3. fallback: search directly in the target language, then check whether the hit links back to the anchor
    const local = await search(lang, topic, 5);
    if (local[0]) {
      let confidence: Resolved["confidence"] = lang === source ? "medium" : "low";
      if (anchor && lang !== source) {
        const back = await langlinks(lang, local[0].title);
        if (back[source] === anchor) confidence = anchorIssue ? "low" : "high"; // linking back to a mismatched anchor proves nothing
      }
      items.push({ lang, project, article: local[0].title, method: "search", confidence, candidates: local.slice(1).map((h) => h.title), ...(anchorIssue && { note: anchorIssue.kind }) });
    } else items.push({ lang, project, article: null, method: "none", confidence: "low" });
  }
  return { topic, source: { lang: source, article: anchor }, items, anchorIssue };
}
