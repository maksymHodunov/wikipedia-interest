# Eval results — Claude Haiku 4.5

Method (agentskills.io → "Evaluating skill output quality"): every eval runs in a clean Claude Code subagent on
`claude-haiku-4-5-20251001`, with the skill (skill path given) and without it (baseline, no skill). Outputs, answer,
`grading.json` (assertions from `evals/evals.json`, PASS only with quoted evidence) and `timing.json` are stored per
run. Grading used the execution traces (`evals/trace_summary.ts`), not the agent's own account, and every answer's
numbers were checked with `scripts/check_claims.ts`. Cache was cleared before each iteration; the 4 evals of an
iteration ran in parallel (so HTTP 429 throttling is part of the timings). Eval 5 is a follow-up turn sent to the
eval-1 agent. `benchmark.json` in each iteration aggregates the runs.

## Iteration log

### Iteration 1 → what the traces showed
- **Silent long command → 33 tool calls, 347 s (eval 2).** A 5-article basket on a cold, throttled API ran for
  minutes without output; Claude Code moved it to the background and the agent polled `ps`/`ls`/`sleep` ~20 times,
  then ran it again. → progress lines + retry messages on stderr; SKILL.md states expected duration and "wait, never
  start a second copy".
- **Claim checker false positive.** "in 2025–26" was read as −26. → year ranges ignored (regression test).
- **Claim checker false negative.** "у 2.4x більше" matched the spike factor 2.5. → tight tolerance for small numbers.
- **Over-claiming.** "НІ, не варто додавати курс" and "можна повністю довіряти" from Wikipedia data alone;
  "no article = insignificant demand". → rules: "validate X first, not launch/drop"; "no article ≠ low demand".
- **Quick question, long answer** (225 words for "quick answer pls"). → length matched to the request.
- **Outside facts and misread numbers** in the report ("500+ M speakers", "≥ 2 % CTR", trust 90 written as "90 %",
  +7 % called growth although the verdict is flat). → explicit rules in SKILL.md.
- **Follow-up did not compare with the previous answer.** → rule "say what changed and what held".
- **Baseline contamination.** The first eval-2 baseline read SKILL.md and ran the scripts despite being told not to
  (its working directory was the skill folder). Discarded (`without_skill_INVALID_used-skill/`) and re-run with a
  forced `cd` to a scratch directory; the valid baseline never fetched any pageviews.

### Iteration 2 → what improved, what did not
- eval 2: 33 → 11 tool calls, 347 → 218 s; eval 4: 225 → 85 words; follow-up now has a "2 years vs 5 years" section.
- Haiku used a wrong flag (`--lang`), got "unknown option… Valid: --langs" and fixed it on the next call.
- **Still failing:** "short report" produced a long chat message instead of the PDF — the first move was
  `Write report.md`, which the subagent harness blocks ("Subagents should return findings as text"); `report.ts` was
  never tried. "+7 %" still called growth. → iteration 3: checklist says "report / звіт → scripts/report.ts, never a
  Markdown report"; the `flat` verdict text now starts with "no clear change — +7 % is inside the ±10 % noise band";
  the PDF table and answer template get a Verdict column.

### Iteration 3 → the PDF appears; a new failure class becomes visible
- eval 3 finally ran `report.ts`: a one-page Ukrainian PDF, `"ok": true`. All 6 original assertions passed.
- **But the assertions were too easy** (the guide warns about this): the PDF verdict said "Турецька хвиля: єдиний
  растущий ринок" while its own table said `tr: flat`, and a finding mentioned a non-existent "Бельгійська" series.
  Numbers were right; labels were not. → added a 7th assertion to eval 3 ("verdict labels match the data") and
  re-graded iterations 1–3 with it (all fail), and added an automatic **label check** to `report.ts` and
  `check_claims.ts`. Retro-checked on all 15 saved answers: 7 true contradictions found (all eval 3), 1 false
  positive ("…despite the platform-wide traffic decline") fixed with a platform-context rule, then 0.
- Follow-up regressed on "compare with the previous answer" and said the cs decline was "the platform, not the
  topic" although relative growth is −50.5 % vs the edition's −16 %. Human-review note; not yet fixed.
- eval 4 said "clear choice for localization" (iteration 2 said "validate Turkish first") — same instructions.

### Iteration 4 (eval 3 only, with the label check)
- Table labels now match the data (tr/es/de "Плаский", pl/fr "Спадає"); 34 numbers verified, 0 label problems.
- The validation loop worked end to end: `report.ts` rejected a 104-character title (exit 6), the agent shortened it
  and re-ran to `"ok": true`.
- New miss: the answer no longer explains that "English language" is only a proxy for "learning English" (6/7).
- The claim checker met one more real-world format: "2025−26" written with U+2212 MINUS SIGN → fixed + test.

| eval 3 across iterations | 1 | 2 | 3 | 4 | baseline |
|---|---|---|---|---|---|
| assertions passed | 2/7 | 3/7 | 6/7 | 6/7 | 1/7 |

### Iteration 5 — a hands-on PM test (by the author, Haiku 4.5 in the Claude desktop app)
Prompts about electric cars (uk), Copilot for a Spanish app, and Claude Code. Findings:
- **Mixed languages in the PDF:** every UI string (table headers, section titles, caveats, chart, footer) was
  hard-coded English, while the agent wrote Ukrainian → localised through `scripts/lib/i18n.ts` and `--lang`.
- **Russian words in Ukrainian text** ("растет", "что", "как") and English labels ("FLAT", "GROWING") — written by the
  model, not the code (no Russian string exists in the skill). A retro-check found such issues in 23 of 27 saved
  Ukrainian answers → language check in `report.ts`/`check_claims.ts`, plus `analyze.ts --lang` returning ready-made
  `verdictLabel`/`trustLabel`. Two Haiku re-runs: the PDF passed on the first try; the chat answer passed after the
  labels were provided (17 numbers verified, 0 language problems). One of the two runs skipped the PDF.
- **Not fixed yet:** "Claude Code" resolved to the Claude chatbot article and "Claude" to a given-name page; a newly
  created/renamed article inflated growth (+399 %) while trust stayed high and its line dominated the chart;
  "integrate it right now" despite the validate-first rule.

## Trigger smoke test (`triggers-iteration-1.json`)
One run per query, clean subagent, `<available_skills>` with this skill plus 3 distractors (pdf, web-research,
i18n-translation). Should-not-trigger near-misses and should-trigger queries from `evals/trigger_queries.json`.
Result: **9/10 correct.** All 5 should-trigger queries read SKILL.md as their first action (4 of them never say
"Wikipedia"). Near-misses (write a Wikipedia article, own Google Analytics, translate UI strings, a fact question about
fasting, a PDF of a meeting transcript) went to other skills or were answered directly; the translation query read
our SKILL.md only while searching its working directory — the skill folder — for `en.json`.

## Known limits of this evaluation
- One run per eval per iteration: no variance estimate; the eval-4 wording changed between iterations 2 and 3
  ("validate Turkish first" vs "clear choice") with the same skill instructions — model nondeterminism.
- Claude Code subagents are told to return text rather than write report files, which biases the "report" eval
  against creating files; a real top-level session does not have that restriction.
- `evals/run_agent.ts` (OpenRouter) was verified against a local mock API only; no real OpenRouter run yet.
