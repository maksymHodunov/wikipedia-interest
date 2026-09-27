# Eval results — Claude Haiku 4.5

Method (agentskills.io → "Evaluating skill output quality"): every eval runs in a clean Claude Code subagent on
`claude-haiku-4-5-20251001`, with the skill (skill path given) and without it (baseline, no skill). Outputs, answer,
`grading.json` (assertions from `evals/evals.json`, PASS only with quoted evidence) and `timing.json` are stored per
run. Grading used the execution traces (`evals/trace_summary.ts`), not the agent's own account, and every answer's
numbers were checked with `scripts/check_claims.ts`. Cache was cleared before each iteration; the 4 evals of an
iteration ran in parallel (so HTTP 429 throttling is part of the timings). Eval 5 is a follow-up turn sent to the
eval-1 agent. `benchmark.json` in each iteration aggregates the runs.

Iterations 6–8 changed the setup: new scenarios with a follow-up turn each (`follow_up` in `evals/evals.json`),
two in English and two in Ukrainian per iteration, with the skill only (the baselines of iterations 1–4 already showed
the gap). The skill is installed in a separate project folder (`pm-sandbox/.claude/skills`, a symlink), as a PM would
use it. The cache was not cleared. `analysis.json`/`report.pdf` are copied right after each turn
(`outputs/turn<N>__…`), because later runs overwrite `out/`; `evals/auto_checks.ts` checks each turn's answer for
numbers, ratios, verdict labels and language against those copies; `answer-turn<N>.md` are the answers as sent.
`timing.json` per turn: wall time from the transcript timestamps, tool calls from the trace, `total_tokens` = the
subagent's context size. `skill-snapshot/` is the skill exactly as the agents saw it.

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
- **Not fixed yet at the time** (fixed after iteration 6): "Claude Code" resolved to the Claude chatbot article and
  "Claude" to a given-name page; a newly created/renamed article inflated growth (+399 %) while trust stayed high and
  its line dominated the chart; "integrate it right now" despite the validate-first rule.

### Iteration 6 — 4 new two-turn scenarios, 2 in English and 2 in Ukrainian (evals 6–9)
Built from the author's PM test (Copilot/Claude Code, electric cars) plus two added cases (Japanese/Korean scripts, an
ambiguous name). Every scenario has a follow-up turn; `evals/auto_checks.ts` checks each turn's answer for numbers,
verdict labels and language against a copy of the data taken right after that turn. With skill only (no baseline).

| eval | lang | editions | passed | what went wrong |
|---|---|---|---|---|
| copilot-es-pt-report | en | es, pt | 6/9 | no PDF although the user asked for "a short report for the team"; "~131 / ~27 human views after bot filtering" — bots subtracted a second time from numbers that already exclude them; follow-up "Claude Code" measured the Claude chatbot / "Claude" name pages and called it "+399 %, trust high (100), the better bet" |
| meditation-ja-ko-onepager | en | ja, ko | 8/8 | Japanese and Korean titles rendered as empty boxes in the PDF (found by looking at the PDF, not by an assertion); the follow-up blamed the decline on the platform although relative growth already removes it |
| ev-uk-report | uk | uk, pl, cs | 8/8 | "Electric vehicle" → uk «Електротранспорт» (60 views/month) while "Electric car" → «Електромобіль» (490): one English title decides the answer |
| python-course-pl-ro | uk | pl, ro | 8/8 | clean |

**30/33 assertions** (27/33 after re-grading with the iteration-7 checks, see below); 0 language problems in all 8
answers (the iteration-5 fix held); mean 158 s and 9 tool calls
per two-turn run. Fixes before iteration 7, each with a regression test:
- **Wrong article is worse than no article.** Disambiguation pages ("Python", "Claude", "Mercury") are detected and
  nothing is analysed; if a topic word is missing from the anchor title ("Claude Code" → "Claude (AI)"), all its
  matches become low confidence (excluded by default) and a warning names the closest article.
- **Level shift:** an article that jumps > 20× inside the period (created, renamed, merged) gets `insufficient-data`
  and trust −40 instead of "+399 %, trust high". Calibrated on the real series: ×894 and ×2 070 (renames) flagged,
  ×5.1 (real growth) not.
- `avgMonthly` → `humanViewsPerMonth` in the summary, with "bots already removed — never subtract `botShare`".
- The flat/declining basis says "the edition-wide change (…) is already removed".
- Checklist: any report request (report, one-pager, summary for the team, звіт) requires the PDF.
- PDF: a fallback font for CJK; scripts pdfkit cannot shape (Arabic, Hebrew, Indic, Thai) and emoji are flagged.
- Gotchas: new/renamed article, no article or ambiguous title, "one English title can decide the answer".

### Iteration 7 — 4 more two-turn scenarios, 2 in English and 2 in Ukrainian (evals 10–13), on the fixed version
Harder questions on purpose: trust in a new product (DeepSeek, zh/vi), a market ranking (German courses, tr/it/nl),
a country that reads two languages (Kazakhstan, uk/kk) and a multilingual country (Switzerland, de/fr/it + rm).

| eval | lang | editions | passed | what went wrong |
|---|---|---|---|---|
| deepseek-zh-vi-trust | en | zh, vi | 7/8 | "4× the traffic", "18× more traffic" — computed ratios |
| german-course-tr-it-nl-report | en | tr, it, nl | 7/9 | "2.3× the audience"; follow-up "Netherlands … (avoid)" — dropping a market on Wikipedia data alone |
| finlit-uk-kk | uk | uk, kk | 6/8 | «interesse» (a Latin-letter word), «артиклю», «цілеуказку», «vs»; Kazakhstan equated with kk (Russian never mentioned) |
| running-switzerland-report | uk | de, fr, it, rm | 6/9 | «меньших» (Russian spelling), «в 4 рази»; de/fr/it treated as Swiss audiences; heading "German first" over a "French first" conclusion |

**26/34 assertions**; mean 296 s and 12 tool calls per two-turn run. The iteration-6 fixes held: the new DeepSeek
article was recognised ("data starts January 2025… provisional"), Romansh was reported as unmeasurable rather than
"no demand", `humanViewsPerMonth` was never reduced by `botShare`, and both reports produced one-page PDFs.

**The worst failure was operational.** The two Ukrainian runs started 4–5-article baskets while four agents hit the
API at once; Wikimedia answered HTTP 429 with a 59 s Retry-After, the runs passed Claude Code's 120 s shell timeout
and went to the background. One agent then ran `pkill -f "node scripts/analyze.ts"`, which also killed the other
agent's run: both background jobs exited with code 144 in the same second. The other agent had waited 180 s on the
user's terminal panel instead of its own job. Both fell back to one article.

**What the checks missed** (found by reading every answer): ratios (numbers ≤ 12 were ignored, 18 matched an unrelated
value), Latin-letter words, «меньш-», the calque «артикль», and a range "78–82 %" misread as 78 plus a minus sign.

Fixes, each with a regression test (53 tests at that point):
- `check_claims.ts`/`report.ts`: ratios ("4×", "2.3x", "18 times", "в 4 рази") are reported under `ratios`; a range
  "78–82 %" is two percentages; a relative decline blamed on the platform («через загальну втрату трафіку») is a label
  problem; uk: Latin-letter words (except names, codes, paths, quotes), «меньш-/больш-/лучш-», «артикль», «прокси».
  `--analysis a.json,b.json` for a follow-up that compares with an earlier run.
- `analyze.ts --lang uk` returns the verdict and the trust reasons in Ukrainian (`scripts/lib/notes.ts`), so the model
  copies them — «малі числа коливаються дико» came from translating "small numbers swing wildly".
- SKILL.md: check every answer (not only non-English ones) and send exactly the checked text; give long runs the
  longest shell timeout and never kill them; "not launch, drop or avoid"; a country is not a language edition
  (Switzerland → de/fr/it read mostly in Germany, France, Italy; Kazakhstan → kk and ru); compare topics in one run.
- The eval-10 assertion "this inflates its growth" was wrong for the data (a launch spike, then decline) and was
  reworded to "how that distorts its growth number" before grading.

**Re-grading iteration 6 with the same checks:** the retro-run found computed ratios in two more answers ("3x higher",
"різниця в 5 разів") and a platform excuse ("appears to be recent platform-wide effect"). Iteration 6 is 27/33 under
the iteration-7 rules (30/33 when first graded); `grading.json` records both. Retro-check of the new language rules on
all 31 saved Ukrainian answers: Latin-letter words or calques in 15 («szeptember», «middle», «output», «pageviews»,
«артиклю»…), no false positives once article titles and search hits are treated as names.

### Iteration 8 — regression run of the two weakest scenarios (evals 11 and 13) on the fixed version
| eval | lang | passed (iteration 7 → 8) | what changed |
|---|---|---|---|
| german-course-tr-it-nl-report | en | 7/9 → 7/9 | turn 1 clean (no ratio, PDF, 46 s); the follow-up again wrote "2.3x larger" and "Netherlands … Not recommended" — it ran no check, reading "check every answer" as "answers built on new data" |
| running-switzerland-report | uk | 6/9 → 5/9 | no background job, no `pkill`, 123 s instead of 396 s; ran `check_claims.ts` in turn 1; trust reasons copied in Ukrainian. New: «на французькому» (calque), a platform excuse with «відбився», "the smallest decline (−16 % vs −10 %)", "Running" silently replaced by "Jogging"; still no "de/fr/it are read mostly outside Switzerland" |

**12/18** (13/18 in iteration 7 on the same scenarios); mean 95 s per two-turn run (299 s). The fixes removed the
mechanisms they targeted (killed runs, "78–82 %" misread, Latin words and «меньших» passing the check, English trust
reasons translated badly), and the checks now flag every language and label issue found by reading iteration 8,
except typos and the wrong comparison. After this run: SKILL.md and `analyze.ts` `next` say "check every answer,
follow-ups too"; "never rule an option out: rank it lower and say what would test it"; "the smallest decline is the
value closest to zero"; `next` lists who reads each shared edition (de, fr, it, zh, kk…); the platform-excuse and
calque rules gained «відбився/вплинув» and «на французькому,»; trust written as a percentage ("100% довіра" in the
turn-1 PDF, which passed because completeness is 100 %) is now a label problem. Not yet verified on Haiku.

## Trigger smoke test (`triggers-iteration-1.json`)
One run per query, clean subagent, `<available_skills>` with this skill plus 3 distractors (pdf, web-research,
i18n-translation). Should-not-trigger near-misses and should-trigger queries from `evals/trigger_queries.json`.
Result: **9/10 correct.** All 5 should-trigger queries read SKILL.md as their first action (4 of them never say
"Wikipedia"). Near-misses (write a Wikipedia article, own Google Analytics, translate UI strings, a fact question about
fasting, a PDF of a meeting transcript) went to other skills or were answered directly; the translation query read
our SKILL.md only while searching its working directory — the skill folder — for `en.json`.

## Known limits of this evaluation
- One run per eval per iteration: no variance estimate; the eval-4 wording changed between iterations 2 and 3
  ("validate Turkish first" vs "clear choice") with the same skill instructions — model nondeterminism. Iteration 8
  scored one assertion lower than iteration 7 on the same two scenarios while fixing what it targeted.
- Grading got stricter over time (ratios and platform excuses count as failures from iteration 7; iteration 6 was
  re-graded, iterations 1–4 were not), so pass rates are comparable within an iteration, not across all of them.
- Parallel runs throttle each other (iteration 7): the timings include Wikimedia's 429 back-off caused by the test.
- Claude Code subagents are told to return text rather than write report files, which biases the "report" eval
  against creating files; a real top-level session does not have that restriction.
- `evals/run_agent.ts` (OpenRouter) was verified against a local mock API only; no real OpenRouter run yet.
