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
npm run check       # typecheck + 34 tests
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
| Spec compliance | official validator `agentskills validate` (PyPI `skills-ref` 0.1.1) + the spec's size/reference rules + the agentskills.io guides (scripts, best practices, evals, descriptions) | valid; SKILL.md 140 lines ≈ 2.6 K tokens; every referenced file exists |
| Metric logic | unit tests on synthetic series with known answers (e.g. +5 %/month must give +79.6 %/yr; one viral month must inflate `yoy` but not `robustGrowth`; topic −20 % inside an edition −20 % must be `flat`) | 34 tests pass |
| Script contract | subprocess tests: `--help`, unknown flags, invalid values, exit codes — no network | pass |
| Real data | `evals/crosscheck.sh`: raw API via curl, metrics recomputed in jq (no project code), compared with `analysis.json` | 10 series × 7 metrics in 8 editions: **70/70 identical** (`evals/results/iteration-1/crosscheck.md`) |
| Claim and label checker | fed deliberately wrong text, then retro-checked on all 15 saved Haiku answers | caught invented numbers and 7 label contradictions; 3 checker bugs found and fixed (fake "12 %" missed; "2025–26" and "2025−26" read as −26) |
| Layout | rendered PDFs inspected; stress test with 8 languages and 5 long findings | one page (earlier versions overflowed / mis-scaled the chart) |
| Reproducibility | clean copy without `node_modules`/cache → `npm ci` → tests → real run with an empty cache | pass |
| Agent use on a cheap model | Claude Haiku 4.5 subagents in Claude Code, clean context per run, with vs without the skill, 4 iterations, graded from execution traces | assertions: without skill **5/24**; with skill 18/24 → 20/24 → **23/24**; mean time 217 → 83 s (baseline 176 s); tool calls 14 → 7.5 (baseline 14). Details: `evals/results/README.md` |
| Triggering | 10 queries from `evals/trigger_queries.json`, clean subagent each, `<available_skills>` with 3 distractor skills (pdf, web-research, i18n) | should-trigger 5/5 (4 of them never mention Wikipedia); near-misses 4/5 — the one false trigger came from the test's working directory, not the description |
| Eval harness | `evals/run_agent.ts` (OpenRouter) end-to-end against a local mock API; command sandbox against injection | pass; not yet run against the real OpenRouter API (needs a key) |

Bugs found by these checks and fixed: unscaled chart and 2-page "one-pager"; cache write errors masked as network
errors; index chart base distorted by a first-month spike; `--articles` silently ignored with several topics;
zero-view months dropped by the API shifting the "last 12 months"; garbage search matches ranked as real articles;
claim checker too permissive / misreading year ranges; shell injection in the first harness; a silent long-running
command that made the agent poll and re-run it (found in eval traces); verdict labels contradicting the data.

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
