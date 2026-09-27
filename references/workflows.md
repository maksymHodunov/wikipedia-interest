# Worked examples, refinements, and the roadmap

## 1. "Compare growth of interest in intermittent fasting in Polish vs Czech Wikipedia over two years"

```bash
node scripts/analyze.ts --topic "Intermittent fasting" --langs pl,cs --months 24
```
Polish Wikipedia has no article on the topic, so `pl` appears in `excluded` with its closest search hits. Report that
as the first finding (interest cannot be measured there — it is not evidence of low demand), then give the Czech
numbers. Only if the user asks for a Polish number, re-run with a clearly labelled proxy:
`--articles pl="Głodówka lecznicza"`.

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

## 4. "Is interest in DeepSeek growing in Chinese and Vietnamese Wikipedia? How far can we trust it?"

```bash
node scripts/analyze.ts --topics "DeepSeek,ChatGPT" --langs zh,vi --months 24 --lang en
```
The DeepSeek articles start in January 2025: 20 months of data, no year-over-year number, trust lowered, and the
verdict falls back to the 20-month trend, which starts at the launch spike. Say that, quote the trust reasons
(vi: 70 % bots), and compare with an established product in the same run so the checks and the PDF see both.

## Choosing languages for a market
A market is not a language edition: Brazil and Portugal share `pt`; Spanish covers Spain and Latin America; many
Indians read `en`; Switzerland's de/fr/it editions are read mostly in Germany, France and Italy, and rm is tiny;
Kazakhstan reads kk and ru; Wikipedia is blocked in mainland China, so zh readers are mostly in Taiwan, Hong Kong and
the diaspora. `analyze.ts` prints these in `next`. Say which population an edition mixes, and that one country's
readers usually cannot be separated. Up to 8 languages per run; split larger sets.

## Refining after the first answer
- Different criterion ("we care about absolute size, not growth") → re-sort by `humanViewsPerMonth` or `perMillion`
  from the summary (`avgMonthlyLast12` / `perMillionLast12` in analysis.json); no re-fetch needed. Rank the smallest
  lower — do not rule it out on Wikipedia data alone.
- Another topic to compare → one run with `--topics "A,B"`; to check an answer that cites two runs,
  `check_claims.ts --analysis a.json,b.json`.
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
7. **More built-in languages** for the PDF labels and the `analyze.ts` notes (pl, de, es…; uk and en exist), and a
   Ukrainian spell check (a hunspell dictionary from npm) for the typos the language check cannot see.
8. **A run budget** — `--max-seconds` that returns partial results with a note, so a shell timeout never interrupts a
   long basket (iteration 7: runs moved to the background, and one agent killed them).
9. **Automated evals in CI** — `evals/evals.json` + `evals/run_agent.ts` on a cheap model, graded by script where
   possible (`evals/auto_checks.ts` already grades numbers, labels and language per turn).
10. **Scripts that need shaping** (Arabic, Hebrew, Indic, Thai) in the PDF — pdfkit cannot shape them; titles fall
   back to the topic name today.
