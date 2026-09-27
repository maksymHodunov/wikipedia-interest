# wikipedia-interest — an Agent Skill

An [Agent Skill](https://agentskills.io/specification) that lets an AI agent turn Wikipedia pageview data into
"which topic / which language next?" decisions for B2C products: resolve a topic to the same article in several
language editions, fetch monthly human pageviews, compute spike-resistant and platform-adjusted growth with a trust
score, draw charts, and produce a one-page PDF whose numbers are checked against the data.

```
wikipedia-interest/
├── SKILL.md              # what the agent reads: workflow, answer template, gotchas, how to read the numbers
├── scripts/
│   ├── analyze.ts        # resolve → fetch → metrics → charts → analysis.json   (main entry)
│   ├── report.ts         # analysis.json → one-page PDF, with number and layout checks
│   ├── resolve.ts        # find / verify article titles per language
│   ├── check_claims.ts   # verify the numbers in a draft answer
│   └── lib/              # api (cache, rate limit), resolve, metrics (pure), claims, svg, pdf, util
├── references/           # metrics.md (formulas), api.md (endpoints & limits), workflows.md (examples + roadmap)
├── tests/                # node:test — metrics, claim check, CLI contract, eval harness (no network)
└── evals/                # evals.json, trigger_queries.json, OpenRouter harness, trace grader, results/
```

## Setup

Node.js ≥ 22.18 runs the TypeScript sources directly (type stripping) — no build step, no compiled files, no native
modules. Dependencies are pinned by `package-lock.json`.

```bash
npm ci
npm run check       # typecheck + 32 tests
node scripts/analyze.ts --topic "Astronomy" --langs uk,pl,cs --months 24
node scripts/report.ts --analysis out/astronomy/analysis.json --verdict "…" --findings "…|…"
```
Optional env: `WI_USER_AGENT` (identify yourself to Wikimedia), `WI_CACHE_DIR` (default `.cache/` in the skill).

## Design decisions

- **One command does the pipeline.** Cheap models are unreliable at chaining many tools and passing JSON between
  them; `analyze.ts` returns a compact summary (5–8 KB for 8 languages) and keeps the detail on disk.
- **Numbers come from code, words from the model — and the words are checked.** `report.ts`/`check_claims.ts`
  extract every number from the agent's text and look it up in `analysis.json`; invented or mis-signed numbers fail
  the run (exit code 6) with a list the agent can fix.
- **Three growth numbers on purpose.** Raw median growth (`robustGrowth`), growth of the topic's share of the whole
  edition (`relativeGrowth`, the headline), and the edition's own trend (`editionGrowth`). Every edition measured lost
  human traffic in 2025–26 (uk −28 %, es −22 %, en −5 %), so raw numbers alone would call almost everything "declining".
- **Safe defaults.** Articles found only by text search (no interlanguage link) are excluded and listed, not silently
  analysed — in testing, such hits were a linguist's biography and a language-policy article.
- **Trust is explained, not just scored.** Every penalty (bots, spikes, noise, short history, weak match) adds a reason.
- **Polite, reproducible API use:** disk cache, 250 ms spacing, `Retry-After` backoff, explicit `User-Agent`.

## How the output of AI tools was verified

The skill was built with an AI coding agent (Claude Code). What was checked, and how:

| Check | How | Result |
|---|---|---|
| Spec compliance | official validator `agentskills validate` (PyPI `skills-ref` 0.1.1), plus the spec's size and reference rules | valid; SKILL.md 124 lines ≈ 2.1 K tokens; all referenced files exist |
| Metric logic | unit tests on synthetic series with known answers (e.g. +5 %/month must give +79.6 %/yr; a single viral month must inflate `yoy` but not `robustGrowth`) | 32 tests pass |
| Script contract | subprocess tests: `--help`, unknown flags, invalid values, exit codes — without network | pass |
| Real data | metrics recomputed independently from raw API JSON with `curl` + `jq` (no project code) and compared to `analysis.json` | see `evals/results/iteration-1/crosscheck.md` |
| Claim checker | deliberately inserted a fake "+12 %" into a report → must fail | caught a real bug: the first version matched it against a monthly per-1M value; fixed + regression test |
| Layout | rendered PDFs inspected visually; stress test with 8 languages and 5 long findings | one page; earlier versions overflowed / mis-scaled the chart — fixed |
| Reproducibility | clean copy without `node_modules`/cache → `npm ci` → tests → real run with empty cache | pass |
| Agent use on a cheap model | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) subagents in Claude Code, clean context per eval, with and without the skill; graded from execution traces with `evals/trace_summary.ts` | see `evals/results/iteration-1/benchmark.json` |
| Eval harness | `evals/run_agent.ts` (OpenRouter) tested end-to-end against a local mock API; command sandbox tested against injection | pass; not yet run against the real OpenRouter API (needs a key) |

Bugs found by these checks and fixed: unscaled chart and 2-page "one-pager"; cache write errors masked as network
errors; index chart base distorted by a first-month spike; `--articles` silently ignored with several topics;
zero-view months dropped by the API shifting the "last 12 months"; garbage search matches ranked as real articles;
claim checker too permissive; claim checker misreading year ranges ("2025–26"); shell injection in the first harness.

## Testing on a cheap model yourself

```bash
OPENROUTER_API_KEY=sk-or-… node evals/run_agent.ts --eval 2 --model anthropic/claude-haiku-4.5
```
Writes `transcript.md`, `answer.md` and `timing.json` to `evals/runs/…`. Grade against the assertions in
`evals/evals.json`. Free models change often; pick one with tool calling from openrouter.ai/models.

## Roadmap

See `references/workflows.md` → "Roadmap": Wikidata topic baskets, daily granularity with event annotation,
seasonality, redirect merging, SQLite cache / offline dumps for large sweeps, cross-source validation, report
localisation, evals in CI.
