# Worked examples, refinements, and the roadmap

## 1. "Compare growth of interest in intermittent fasting in Polish vs Czech Wikipedia over two years"

```bash
node scripts/analyze.ts --topic "Intermittent fasting" --langs pl,cs --months 24
```
Polish Wikipedia has no article on the topic, so `pl` appears in `excluded` with its closest search hits. Report that
as the first finding (no article = small or young audience), then give the Czech numbers. Only if the user asks for a
Polish number, re-run with a clearly labelled proxy: `--articles pl="Głodówka lecznicza"`.

## 2. "We plan an astronomy course. Is interest growing in Ukrainian Wikipedia, and how far can we trust it?"

```bash
node scripts/analyze.ts --topics "Astronomy,Solar System,Black hole,Telescope,Galaxy" --langs uk --months 36
```
A course is broader than one article, so use a basket and check whether the articles agree. For trust, read
`trustReasons` (September school-year spikes, bot share), compare `relativeGrowth` with `robustGrowth`, and mention
`editionGrowth` (the whole uk edition lost ~28 % of human views in a year).

## 3. "Language-learning app: compare interest in learning English across editions; which audiences next and why?"

```bash
node scripts/analyze.ts --topic "English language" --langs de,fr,es,pl,tr --months 24
```
"English as a second or foreign language" exists only in a few editions (the rest are excluded), so "English language"
is the usable proxy — say that it measures interest in the language, not in learning it. Rank with `ranking`, but
recommend the top 2–3 for *validation* (landing page per language, ads test), not for launch. A low-trust series with
high growth is a "check it" candidate, not a "launch" one.

## Choosing languages for a market
A market is not a language edition: Brazil and Portugal share `pt`; Spanish covers Spain and Latin America; many
Indians read `en`. Say which population an edition mixes. Up to 8 languages per run; split larger sets.

## Refining after the first answer
- Different criterion ("we care about absolute size, not growth") → re-sort the existing `analysis.json` by
  `avgMonthlyLast12` or `perMillionLast12`; no re-fetch needed.
- Doubt about a spike → `data.csv` has every month; name the month and its value.
- Different period → re-run with `--months` or `--start/--end`; overlapping requests are cached.
- Different article → `--articles <lang>="<Title>"` (single topic per run).

## Roadmap: iterating towards bigger research
Ordered by value ÷ effort. Each step keeps the `analysis.json` contract, so `SKILL.md` barely changes.

1. **Topic baskets from Wikidata** — take the anchor article's Wikidata item and pull related items ("part of",
   "subclass of", "main subject"), so the agent picks a basket instead of guessing titles.
2. **Daily granularity + event annotation** — `--granularity daily` for the last 90 days, weekly aggregation, and
   automatic annotation of spike days using the top-articles endpoint (did the whole edition spike?).
3. **Seasonality** — with ≥ 36 months, estimate month-of-year effects so "growing" excludes the September school effect.
4. **Redirect and rename merging** — sum views of redirects to the target (Action API `prop=redirects`).
5. **Batch mode and a SQLite cache** — `--topics-file` with hundreds of rows; store fetched series in one SQLite table
   so cross-run questions are cheap. For thousands of articles, switch from the API to the monthly pageview dumps
   (`dumps.wikimedia.org/other/pageview_complete/`) processed offline.
6. **Cross-source validation** — adapters for search-keyword volumes or app-store data with the same `Point[]` shape,
   so a report can put Wikipedia next to search demand.
7. **Report templates and localisation** of the report's fixed strings (uk/pl/…).
8. **Automated evals in CI** — `evals/evals.json` + `evals/run_agent.ts` on a cheap model, graded by script where possible.
