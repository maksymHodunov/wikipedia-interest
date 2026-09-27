/**
 * Map a free-text topic to concrete article titles in each requested language edition.
 *
 * Strategy (cheap → reliable):
 *  1. Search the topic in the `source` language (default: the first requested lang,
 *     or `en` when the topic looks Latin-script) and take the top hit.
 *  2. Follow interlanguage links from that article to every requested language.
 *  3. For languages without a link, fall back to a direct search in that language.
 *  Every resolution records *how* it was found so the agent can flag low-confidence matches.
 */
import { langlinks, search } from "./api.ts";

export interface Resolved {
  lang: string;
  project: string; // e.g. "uk.wikipedia"
  article: string | null;
  method: "explicit" | "langlink" | "search" | "none";
  confidence: "high" | "medium" | "low";
  candidates?: string[]; // other search hits, for the agent to double-check
}

export interface ResolveResult {
  topic: string;
  source: { lang: string; article: string | null };
  items: Resolved[];
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

  // 2. interlanguage links
  let links: Record<string, string> = {};
  if (anchor) links = await langlinks(source, anchor);

  const items: Resolved[] = [];
  for (const lang of langs) {
    const project = `${lang}.wikipedia`;
    if (explicit[lang]) {
      items.push({ lang, project, article: explicit[lang]!, method: "explicit", confidence: "high" });
      continue;
    }
    if (links[lang]) {
      items.push({ lang, project, article: links[lang]!, method: "langlink", confidence: "high" });
      continue;
    }
    // 3. fallback: search directly in the target language, then check whether the hit links back to the anchor
    const local = await search(lang, topic, 5);
    if (local[0]) {
      let confidence: Resolved["confidence"] = lang === source ? "medium" : "low";
      if (anchor && lang !== source) {
        const back = await langlinks(lang, local[0].title);
        if (back[source] === anchor) confidence = "high";
      }
      items.push({ lang, project, article: local[0].title, method: "search", confidence, candidates: local.slice(1).map((h) => h.title) });
    } else items.push({ lang, project, article: null, method: "none", confidence: "low" });
  }
  return { topic, source: { lang: source, article: anchor }, items };
}
