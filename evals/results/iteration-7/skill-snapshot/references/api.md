# Wikimedia API notes

Client: `scripts/lib/api.ts`. Everything is cached on disk under `.cache/` (7 days for pageviews, 30 days for search/langlinks).
Override with `WI_CACHE_DIR`. Set `WI_USER_AGENT="<tool> (<contact email>)"` — Wikimedia asks for an identifying UA.

## Pageviews (REST, no auth)

Base: `https://wikimedia.org/api/rest_v1/metrics/pageviews`

| Purpose | Path |
|---|---|
| per article | `/per-article/{project}/{access}/{agent}/{article}/{granularity}/{start}/{end}` |
| whole project | `/aggregate/{project}/{access}/{agent}/{granularity}/{start}/{end}` |
| top articles | `/top/{project}/{access}/{year}/{month}/{day}` (not used yet — roadmap: topic discovery) |

- `project`: `uk.wikipedia`, `pl.wikipedia`, … ; `access`: `all-access | desktop | mobile-web | mobile-app`;
  `agent`: `user | spider | automated | all-agents`; `granularity`: `daily | monthly`; dates `YYYYMMDD` (monthly: day is ignored, use 01 / last day).
- Article titles: spaces → `_`, then URL-encode. `/` must be encoded. Case matters.
- Data starts 2015-07-01. Monthly points for months with zero views are simply missing.
- 404 = no data for that title/range (we return `[]`); 429 = throttled: **the anonymous REST endpoint throttles bursts hard**.
  The client waits 250 ms between calls and backs off 3 s, 6 s, … honouring `Retry-After`.
- Docs: https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html

## Action API (title resolution)

`https://{lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&…`

- Search: `list=search&srsearch=<topic>&srlimit=5` → top hit is the anchor article.
- Disambiguation check: `prop=pageprops&ppprop=disambiguation&titles=<anchor>&redirects=1`. "Python", "Claude",
  "Mercury" are disambiguation pages in en: nothing is analysed and `excluded[].searchHits` lists specific titles.
- Title check: every word of the topic (minus "the/of/a…", plural -s) must be in the anchor title. "Claude Code" →
  "Claude (AI)" fails it: all its matches become low confidence (excluded by default) and a warning names the
  closest article, so a different subject is never reported under the user's topic.
- Interlanguage links: `prop=langlinks&titles=<anchor>&lllimit=max&redirects=1` → `{lang: title}`.
- Both are cheap and cached for 30 days. When a language has no interlanguage link, a local search runs and its hit
  is accepted only if it links back to the anchor article (`search/high`); otherwise the language is **excluded** and
  the hits are listed in `excluded[].searchHits` — in testing these were often unrelated (a linguist's biography for
  "English as a second language" in uk). Pin a deliberate proxy with `--articles`.

## Call budget per analysis

`per topic: 1 search + 1 pageprops + 1 langlinks (+ 1 search and 1 langlinks per language without a link)` ·
`per language: 1 edition total` · `per kept series: 1 user + 1 automated`. Excluded (search-only) matches cost no
pageview calls. A 3-language, 1-topic run ≈ 12 calls (~4 s cold, instant when cached). `--no-bots` and
`--no-normalize` remove calls if you are rate-limited; `relativeGrowth`/`perMillion` need the edition totals.

## Errors

| Symptom | Meaning | What to do |
|---|---|---|
| exit 4, "HTTP 429" | throttled | wait ~60 s, re-run the same command (finished calls are cached) |
| exit 3, "no usable article" | every language excluded or empty (incl. a disambiguation page or a title mismatch) | read `warnings`, check `excluded[].searchHits`, try the specific English title, or pin with `--articles` |
| exit 2 | bad arguments | the message lists valid options; `--help` has examples |
| `"has no pageview data"` warning | article exists but got no human views in the period | small edition or new article — report it |
