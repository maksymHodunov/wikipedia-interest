# wikipedia-interest — an Agent Skill

An [Agent Skill](https://agentskills.io/specification) that lets an AI agent turn Wikipedia pageview data into
"which topic / which language next?" decisions for B2C products: resolve a topic to the same article in several
language editions, fetch monthly human pageviews, compute spike-resistant and platform-adjusted growth with a trust
score, draw charts, and produce a one-page PDF in the user's language whose numbers are checked against the data.

```
wikipedia-interest/
├── SKILL.md              # what the agent reads: workflow, answer template, gotchas, how to read the numbers
├── scripts/
│   ├── analyze.ts        # resolve → fetch → metrics → charts → analysis.json   (main entry)
│   ├── report.ts         # analysis.json → one-page PDF in one language, with number/label/language/layout checks
│   ├── resolve.ts        # find / verify article titles per language
│   ├── check_claims.ts   # check a draft answer: numbers, ratios, verdict labels, language
│   └── lib/              # api (cache, rate limit), resolve, metrics + notes (pure), claims, i18n,
│                         # report-content, svg, pdf, fonts, util
├── references/           # metrics.md (formulas and checks), api.md (endpoints, limits, title rules), workflows.md (examples, roadmap)
├── tests/                # node:test — metrics, claim/label/language checks, i18n, fonts, CLI contract, eval harness (no network)
└── evals/                # evals.json, trigger_queries.json, OpenRouter harness, trace summary, per-turn auto checks, benchmark, results/
```

## Setup

Node.js ≥ 22.18 runs the TypeScript sources directly (type stripping) — no build step, no compiled files, no native
modules. Dependencies are pinned by `package-lock.json`.

```bash
npm ci
npm run check       # typecheck + 54 tests
node scripts/analyze.ts --topic "Astronomy" --langs uk,pl,cs --months 24 --lang en
node scripts/report.ts --analysis out/astronomy/analysis.json --lang en --title "Astronomy in uk, pl, cs" \
  --verdict "<one sentence with numbers from the summary>" --findings "<a>|<b>|<c>"
```
Optional env: `WI_USER_AGENT` (identify yourself to Wikimedia), `WI_CACHE_DIR` (default `.cache/` in the skill),
`WI_FALLBACK_FONT` (a .ttf/.otf for Chinese, Japanese or Korean text in the PDF; Arial Unicode is used on macOS and
Windows when present).

## Design decisions

- **One command does the pipeline.** Cheap models are unreliable at chaining many tools and passing JSON between
  them; `analyze.ts` returns a compact summary (5–8 KB for 8 languages) and keeps the detail on disk.
- **Numbers come from code, words from the model — and the words are checked.** `report.ts`/`check_claims.ts`
  extract every number from the agent's text and look it up in `analysis.json`, reject ratios the model computed
  ("4×"), verdict words that contradict the data, trust written as a percentage, a relative decline blamed on the
  platform, and text in the wrong language. A failed check exits with code 6 and a list the agent can fix.
- **Three growth numbers on purpose.** Raw median growth (`robustGrowth`), growth of the topic's share of the whole
  edition (`relativeGrowth`, the headline), and the edition's own trend (`editionGrowth`). Every edition measured lost
  human traffic in 2025–26 (uk −28 %, es −22 %, en −5 %), so raw numbers alone would call almost everything "declining".
- **A wrong article is worse than no article.** Articles found only by text search are excluded and listed;
  disambiguation pages ("Python", "Claude") and titles missing a word of the topic ("Claude Code" → "Claude (AI)")
  are excluded with a warning naming the closest article; an article that jumps more than 20× inside the period
  (created, renamed, merged) gets "insufficient data" instead of a +399 % headline.
- **One language per answer and report — and the model copies instead of translating.** Every UI string in the PDF
  comes from a dictionary (`--lang uk|en`, or a translated labels file for any other language). `analyze.ts --lang uk`
  returns the verdict, its basis and the trust reasons already in Ukrainian. A language check rejects Russian words,
  calques, Latin-letter words and untranslated tool terms in Ukrainian text.
- **Trust is explained, not just scored.** Every penalty (bots, spikes, noise, short history, weak match, level shift)
  adds a reason.
- **Editions are not countries.** `analyze.ts` says who reads each shared edition (de: Germany, Austria, Switzerland;
  zh: Taiwan, Hong Kong and the diaspora — Wikipedia is blocked in mainland China), so the agent does not present
  de/fr/it views as Swiss demand.
- **Polite, reproducible API use:** disk cache, 250 ms spacing, `Retry-After` backoff, explicit `User-Agent`.

## How the output of AI tools was verified

The skill was built with an AI coding agent (Claude Code). What was checked, and how:

| Check | How | Result |
|---|---|---|
| Spec compliance | official validator `agentskills validate` (PyPI `skills-ref` 0.1.1) + the spec's size/reference rules + the agentskills.io guides (scripts, best practices, evals, descriptions) | valid; SKILL.md 182 lines ≈ 3.8 K tokens (limits 500 lines / 5 K); every referenced file exists |
| Metric logic | unit tests on synthetic series with known answers (e.g. +5 %/month must give +79.6 %/yr; one viral month must inflate `yoy` but not `robustGrowth`; topic −20 % inside an edition −20 % must be `flat`) and on real series from testing (renames ×894 flagged, real growth ×5 not) | 54 tests pass |
| Script contract | subprocess tests: `--help`, unknown flags, invalid values, exit codes — no network | pass |
| Real data | `evals/crosscheck.sh`: raw API via curl, metrics recomputed in jq (no project code), compared with `analysis.json` | 10 series × 7 metrics in 8 editions: **70/70 identical** (`evals/results/iteration-1/crosscheck.md`) |
| Claim and label checker | fed deliberately wrong text, then retro-checked on every saved Haiku answer after each change | caught invented numbers, 7 label contradictions, computed ratios in 7 of 20 answer turns (iterations 6–8), platform excuses in 3 and trust written as a percentage; 6 checker bugs found and fixed (fake "12 %" missed; "2.4x" matched 2.5; "2025–26" and "2025−26" read as −26; "78–82 %" read as a minus; ratios ≤ 12 ignored) |
| Language | retro-checks of all saved Ukrainian Haiku answers after each rule change | iteration 5: 23/27 had Russian words or untranslated terms; iteration 7: Latin-letter words or calques in 15/34 («interesse», «szeptember», «артиклю»); no false positives on clean answers and 44 reference strings. Not caught: typos and wrong comparisons (see below) |
| Layout | rendered PDFs inspected; stress test with 8 languages and 5 long findings; Japanese/Korean titles | one page (earlier versions overflowed / mis-scaled the chart); CJK titles drawn with a fallback font instead of empty boxes |
| Reproducibility | clean copy without `node_modules`/cache → `npm ci` → tests → real run with an empty cache | pass |
| Agent use on a cheap model | Claude Haiku 4.5 subagents in Claude Code, clean context per run, graded from execution traces with `evals/auto_checks.ts` plus reading every answer | iterations 1–4 (with vs without the skill): without **5/24**; with 18/24 → 20/24 → **23/24**; mean time 217 → 83 s (baseline 176 s). Iterations 6–8 (new two-turn scenarios, 2 English + 2 Ukrainian each, stricter checks): 27/33, 26/34, then 12/18 on a re-run of the two weakest. Details: `evals/results/README.md` |
| Triggering | 10 queries from `evals/trigger_queries.json`, clean subagent each, `<available_skills>` with 3 distractor skills (pdf, web-research, i18n) | should-trigger 5/5 (4 of them never mention Wikipedia); near-misses 4/5 — the one false trigger came from the test's working directory, not the description |
| Eval harness | `evals/run_agent.ts` (OpenRouter) end-to-end against a local mock API; command sandbox against injection | pass; not yet run against the real OpenRouter API (needs a key) |

Bugs found by these checks and fixed: unscaled chart and 2-page "one-pager"; cache write errors masked as network
errors; index chart base distorted by a first-month spike; `--articles` silently ignored with several topics;
zero-view months dropped by the API shifting the "last 12 months"; garbage search matches ranked as real articles;
claim checker too permissive / misreading year ranges; shell injection in the first harness; a silent long-running
command that made the agent poll and re-run it; verdict labels contradicting the data; English UI text and Russian
words in Ukrainian reports; "Claude Code" measured on the Claude chatbot article with trust "high"; renamed articles
reported as +399 %; bots subtracted twice ("humanViewsPerMonth" was called "avgMonthly"); Japanese/Korean titles as
empty boxes in the PDF; ratios and Latin-letter words passing the checks; long runs killed by the agent (`pkill`).

**Still weak** (iterations 7–8): Haiku sometimes skips the check on a follow-up that needs no new data, so ratios
come back there; typos and wrong comparisons ("the smallest decline, −16 % vs −10 %") are invisible to the checks; one
run per scenario, so a 1–2-assertion difference between iterations is within model variance.

## Testing on a cheap model yourself

```bash
OPENROUTER_API_KEY=sk-or-… node evals/run_agent.ts --eval 2 --model anthropic/claude-haiku-4.5
```
Writes `transcript.md`, `answer.md` and `timing.json` to `evals/runs/…`. Grade against the assertions in
`evals/evals.json`. Free models change often; pick one with tool calling from openrouter.ai/models. For a Claude Code
subagent transcript, `node evals/auto_checks.ts <transcript.jsonl> --lang uk --data <outputs>` checks every turn's
answer for numbers, labels and language.

## Roadmap

See `references/workflows.md` → "Roadmap": Wikidata topic baskets, daily granularity with event annotation,
seasonality, redirect merging, SQLite cache / offline dumps for large sweeps, cross-source validation, more report
languages and a Ukrainian spell check, a run budget for long baskets, evals in CI.
