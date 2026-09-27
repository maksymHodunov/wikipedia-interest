---
name: wikipedia-interest
description: Measure how interest in a topic changes across Wikipedia language editions and turn it into a data-backed recommendation or a one-page PDF report. Use this skill when a product team asks which topic, course or content area to build next, which language or market to localize into or launch next, or whether interest in a subject is growing (and how far to trust that) in some language, even if they do not mention Wikipedia. Not for editing Wikipedia, analysing the user's own website/app analytics, or plain fact lookup.
compatibility: Requires Node.js 22.18+ (runs TypeScript directly), npm, and internet access to wikimedia.org and *.wikipedia.org.
metadata:
  version: "0.2.0"
---

# Wikipedia interest analysis

Turns "is interest in X growing in language Y?" / "which language or topic next?" into numbers from the Wikimedia
pageviews API, charts, and optionally a one-page PDF. **The scripts compute every number. You choose the inputs,
check what was matched, and explain.** Run commands from this skill's directory (`cd` there first — the session
may start in another folder).

## Setup

Only if `node_modules/` is missing in the skill directory (a fresh copy), run once:
```bash
npm ci
```
Otherwise skip it — reinstalling costs time on every session. `analyze.ts` works without it; `report.ts` needs it
(exit code 5 means: run `npm ci`).

## Workflow

Copy this checklist and tick it off:
- [ ] 1. Plan inputs: English topic title(s), language codes, period
- [ ] 2. Run `scripts/analyze.ts`
- [ ] 3. Check `excluded`, `warnings`, `match`, `trustReasons`
- [ ] 4. Answer with the template below, entirely in the user's language; not English → check it (see Language)
- [ ] 5. The user said report / звіт / one-pager / something to share? → run `scripts/report.ts --lang <code>`
      (it makes the PDF) until `"ok": true`. Never write a Markdown or text report instead.

### 1. Plan inputs
- **Topic → English Wikipedia title.** Translate the user's words ("інтервальне голодування" → "Intermittent fasting").
  The script follows interlanguage links from the English article — the reliable way to get *the same* article in every language.
- **Languages → Wikipedia codes**: uk, pl, cs, sk, de, fr, es, pt, it, tr, ro, … (max 8 per run). A country is not a
  language: Brazil → pt (shared with Portugal — say so).
- **Period**: default `--months 24` (needed for year-over-year numbers). "last 5 years" → `--months 60`.
- **One article or a basket?** A course or broad area is several articles. Use 3–5 related titles:
  `--topics "Astronomy,Solar System,Black hole,Galaxy,Telescope"` and judge the basket, not one article.

### 2. Run
```bash
node scripts/analyze.ts --topic "Intermittent fasting" --langs pl,cs --months 24 --lang uk
node scripts/analyze.ts --topics "Astronomy,Solar System,Black hole" --langs uk --months 36 --lang uk
```
`--lang` = the language of the user's message (not the editions analysed): the summary then carries `verdictLabel`
and `trustLabel` in that language — copy them instead of translating. Prints a JSON summary on stdout (`files.analysis` is the full result for `report.ts`) and progress lines on stderr.
**Timing:** ~5 s per series on a cold cache — a 5-article basket or 8 languages can take 1–3 min, longer if Wikimedia
throttles (the script prints `retry … in N s` and continues). Wait for the command to finish; if your tool moved it to
the background, wait for that job — never start a second copy. Cached re-runs are instant. `--help` lists every option.

### 3. Check what was measured
- `excluded` = editions with **no article on the topic**. Say so plainly: Wikipedia cannot measure interest in that
  edition. It does **not** prove low demand — readers may use another language edition or other sources. Never
  quietly substitute another article. If the user wants a proxy, choose one from `searchHits`, re-run with
  `--articles pl="Głodówka lecznicza"` (single `--topic` only) and call it a proxy.
- `match`: `langlink/high` is safe; `search/*` → confirm the article really is the topic.
- `trustReasons`: quote at least the first one in your answer.

### Language — one language, the user's, everywhere
The answer, the PDF title/verdict/findings and every label are in the language of the user's message. Small models
drift into Russian or leave tool terms in English; in testing 23 of 27 Ukrainian answers did. So:
- Copy `verdictLabel` / `trustLabel` from the summary (run analyze.ts with `--lang`). Otherwise translate: growing /
  flat / declining → зростає / без змін / спадає; trust → довіра висока / середня / низька; YoY → р/р; share → частка;
  views → переглядів; Wikipedia → Вікіпедія.
- Ukrainian is not Russian: «Вікіпедія», «зростає», «що», «як» — never «Википедия», «растет», «что», «как».
- Before sending a non-English answer, save it to a file and run
  `node scripts/check_claims.ts --analysis "<files.analysis>" --file draft.md --lang <code>`; fix everything it lists.

### 4. Answer (in the user's language)
Match the length to the request: a quick question gets 3–5 sentences with the key numbers; a comparison or decision
gets the template below; a report gets a PDF (step 5) plus a chat summary of at most ~150 words.
```
**Answer:** <verdict label + key number, e.g. "declining: share of views −47% YoY">
| Language | Article | Verdict | Relative YoY | Raw YoY | Views/month | Trust |
<one row per series, values and verdict labels copied from the summary>
**How far to trust it:** <trust label + 1–2 trustReasons; spikes; bot share; excluded editions>
**Recommendation:** <which option to validate next, and how: landing page, ads test, search-keyword volumes>
**Limits:** Wikipedia views measure curiosity, not willingness to pay; <proxies / exclusions used>
```
Rules that keep the answer honest — each one fixes a mistake seen in testing:
- Copy numbers exactly as printed. For a difference or ratio between two series, state both numbers instead.
- Use the verdict label as printed: `flat` stays flat even when the number is positive (+7 % is inside the ±10 % band).
- `relativeGrowth` has the platform decline already removed: a negative relative number means the topic lost share
  *within* Wikipedia — do not explain it away as "the platform's problem". Only the raw number includes the platform.
- Trust is a 0–100 score, not a percentage: write "trust high (90)", not "90 %".
- Add no outside facts (population, market size, causes, CTR thresholds). If one seems important, list it as a
  question to check, without numbers.
- Wikipedia data supports "validate X first", not "launch X" or "drop X".
- On a follow-up, say what changed versus your previous answer and what held.

### 5. PDF report (only when the user asks for a report, one-pager or something to share)
```bash
node scripts/report.ts --analysis "<files.analysis>" --lang <code> --chart indexed \
  --title "<≤ 90 chars>" --verdict "<one sentence with numbers>" --findings "<bullet>|<bullet>|<bullet>"
```
`--lang` renders every label, heading, caveat and the chart in that language (built-in: uk, en). For another language,
run `node scripts/report.ts --labels-template > labels.<code>.json`, translate the values (keep keys and {placeholders})
and add `--labels labels.<code>.json`. "Short report" means this PDF — not a long chat message.
**Validation loop:** if the output says `"ok": false` (exit code 6), fix every item in `problems` — numbers not found
in the data, a language called growing when its verdict is flat, Russian or English words in the user's language,
text too long, more than one page — and re-run until
`"ok": true`. Then give the user the `pdf` path.
For a long chat answer, check numbers and verdict labels the same way: save the draft to a file and run
`node scripts/check_claims.ts --analysis "<files.analysis>" --file draft.md`.

## How to read the summary

| Field | Meaning | Use it for |
|---|---|---|
| `relativeGrowth` | % change of the topic's **share** of all views in that edition (median month, last 12 vs previous 12) | **headline** "is interest growing" — removes the edition-wide trend |
| `robustGrowth` | % change of the **median** month's raw views | absolute audience change on Wikipedia |
| `editionGrowth` | same for the whole language edition | context: how much of the change is the platform |
| `yoy` | % change of 12-month **totals** | if far from `robustGrowth`, a spike drove it |
| `trendAnnual`, `r2` | log-linear trend in %/year; r² 0–1 = how steady | r² < 0.2 means no consistent direction |
| `avgMonthly` | human views per month (last 12) | size; under ~1 000 a trend is fragile |
| `perMillion` | views per 1M views of the edition | compare **languages** fairly |
| `botShare` | automated share of traffic | > 0.3 → even human counts are suspect |
| `spikeMonths` | months > 2.5× their neighbours | news, viral posts, school-year starts |
| `trust` | 0–100 score + `trustReasons` | how far to believe the verdict (not its direction) |
| `ranking` | growth × trust + relative interest | order for "which next" — explain it with its `why` |

Verdict: growing > +10 %, declining < −10 %, else flat. "Trust high + declining" = "we are confident it is declining".

## Gotchas
- **Every Wikipedia edition lost human traffic in 2025–26** (AI answers in search, stricter bot detection): uk −28 %,
  es −22 %, en −5 % (median month YoY). Raw growth is therefore negative for most topics. Lead with `relativeGrowth`
  and cite `editionGrowth` from your own summary (the numbers here are only examples).
- **Small editions often lack niche articles** (no pl article for intermittent fasting; the article on English as a
  second language exists in only a few editions). Report the gap; do not read it as low demand.
- **"Learning English/Spanish/…" has no universal article.** "English language" exists everywhere and is the usable
  proxy; say that it measures interest in the language, not in learning it.
- **Bots:** popular articles can be 50–75 % automated traffic (de "Englische Sprache" ≈ 73 %). High `botShare` lowers trust.
- **September spikes** on school subjects are the school year, not new demand.
- **HTTP 429 / exit code 4:** Wikimedia throttles bursts. Wait ~60 s and re-run the same command; finished calls are cached.
- **New or renamed article:** `trustReasons` says "data starts …"; its early growth is inflated.

## When to read the references
- `references/metrics.md` — the user asks how a number is computed or challenges a metric; exact trust and claim-check rules.
- `references/workflows.md` — multi-step research (baskets, picking languages for a market, refining after feedback) and the roadmap.
- `references/api.md` — an API call fails unexpectedly, or you need an endpoint the scripts do not cover.

## Scripts
- `scripts/analyze.ts` — resolve → fetch → metrics → charts (main entry point)
- `scripts/report.ts` — one-page PDF from `analysis.json`, with number, verdict-label and layout checks
- `scripts/resolve.ts` — show which article represents a topic per language (`--search` lists candidates)
- `scripts/check_claims.ts` — verify the numbers and verdict labels in a draft answer

All accept `--help`. Exit codes: 0 ok · 2 bad arguments · 3 no data · 4 API failure (wait, re-run) · 5 run `npm ci` · 6 checks failed.

## Follow-up requests
Re-run the previous command with one flag changed — cached calls are free: longer period → `--months 60`; another
language → append it to `--langs`; different article → `--articles`; "we care about size, not growth" → re-sort the
existing summary by `avgMonthly` / `perMillion` (no re-run). Daily data is not supported yet — say so.
