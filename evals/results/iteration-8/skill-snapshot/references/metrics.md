# Metric definitions

All metrics are computed in `scripts/lib/metrics.ts` from **monthly** series of `agent=user` pageviews
(`all-access` = desktop + mobile web + mobile app). Months the API omits (zero views) are filled with 0 from the first
observed month to the end of the requested period, so "last 12" always means 12 calendar months. Tests: `npm test`.

## Growth

| Metric | Formula | Notes |
|---|---|---|
| `relativeGrowth` | `(median(share, last 12) − median(share, prev 12)) / median(share, prev 12) × 100`, where `share = views / edition views × 1e6` | **headline**; removes the edition-wide trend. Assumes the platform-wide change hits all topics equally |
| `robustGrowth` | same on raw monthly views | absolute change of the audience on Wikipedia |
| `editionGrowth` | same on the whole edition's human views | context: how much is the platform, not the topic |
| `yoy` | `(sum(last 12) − sum(prev 12)) / sum(prev 12) × 100` | naive; one viral month inflates it |
| `trendAnnual`, `r2` | OLS on `ln(views) ~ a + b·t` (t in months); `annual = (e^{12b} − 1) × 100`; r² = share of variance explained | needs ≥ 6 months; direction over the whole window |

The growth metrics need 24 months (12 vs 12); with less, they are `null` and the verdict falls back to `trendAnnual`.

**Verdict:** `g = relativeGrowth ?? robustGrowth ?? trendAnnual`; `g > 10` growing, `g < −10` declining, otherwise flat;
`null` → insufficient-data. The ±10 % dead band avoids calling noise a trend. A **level shift** (below) also gives
insufficient-data, with the basis "not comparable: the article changed around <month>".

**Level shift** (`levelShift`): with ≥ 8 months, compare `m1` = median of the first half with `m3` = median of the last
3 months. If `m3 ≥ 100` and `m3 > 20 × m1` (or `m1 = 0`), the article was created, renamed or merged inside the period
— its growth describes the article's history, not interest. The month reported is the first one above `5 × m1` after
which the median stays above it. Calibrated on testing data: pt "Claude (AI)" ×894 and en ×2 070 were renames;
es "Claude (chatbot)" ×5.1 was real growth and stays measured.

## Size and quality

| Metric | Formula | Notes |
|---|---|---|
| `avgMonthlyLast12`, `totalLast12` | mean / sum of the last 12 months of human views | absolute audience size; the stdout summary calls it `humanViewsPerMonth` |
| `perMillionLast12` | mean over the last 12 months of `views / edition views × 1e6` | compare languages: removes edition size |
| `botShare` | `automated / (user + automated)` over the last 12 months | `automated` = Wikimedia's heuristic for undeclared bots; declared crawlers (`spider`) are not counted at all. Every other number already excludes both — never subtract `botShare` again |
| `spikeMonths`, `spikeShare` | month > 2.5 × median of the 6 months on each side | marked ○ on charts |
| `completeness` | months with a record / calendar months from first record to period end | < 0.95 = gaps |
| `peakMonth` | month with the most views | |

## Trust score

Starts at 100; penalties below; ≥ 70 high, ≥ 40 medium, otherwise low. Every penalty adds a human-readable reason.
Trust answers "how far can we believe this verdict?", not "is it good news?".

| Condition | Penalty |
|---|---|
| level shift: the article jumped > 20× (created, renamed or merged inside the period) | −40 |
| low-confidence match (`search/low`, or a `title-mismatch` langlink; only kept with `--include-low-confidence`) | −50 |
| article matched by text search in the anchor language (`search/medium`) | −20 |
| data starts ≥ 3 months after the requested start (new or renamed article) | −10 |
| < 6 / < 12 / < 24 months of data | −60 / −40 / −15 |
| completeness < 95 % | −15 |
| spikeShare > 15 % / > 5 % | −25 / −10 |
| spike-driven: `yoy` > 10 % but `robustGrowth` < 0 | −20 |
| botShare > 40 % / > 30 % / > 15 % | −35 / −25 / −10 |
| r² < 0.2 | −15 |
| `avgMonthlyLast12` (`humanViewsPerMonth`) < 300 | −20 |
| raw and relative growth both beyond ±10 % in opposite directions | −10 |

## Ranking score

`score = (clamp(g, −50, 200) + 50) × trust/100 + 10 · log10(perMillion + 1)` with `g` as in the verdict.
Growth weighted by trust, plus a small bonus for current relative interest. It orders candidates; it is not a
probability. Always explain it with the `why` string.

## Indexed chart

Each series is divided by the **median of all its months** and × 100 ("median month = 100"); if that median is 0
(a mostly empty series), the median of its non-zero months is used. A median base keeps one spike — a September
school-year peak, a news month — from rescaling the whole line, and lines of very different sizes share one axis.

## Claim check (`scripts/lib/claims.ts`)

`report.ts` and `check_claims.ts` extract every number from the agent's text and look for it in `analysis.json`.
- Ignored: dates and years (2024, 2025-09), bare integers ≤ 12 ("3 languages"), "1M" used as a unit.
- Parsed: `1 431` / `1,431` = 1431; `36,8` / `36.8` = 36.8; k / тис / M / млн multipliers; `−` and `–` as minus.
- Percentages are matched only against percentage metrics (growth, bot share, …), plain numbers only against counts,
  rates and scores — otherwise any "12 %" would match some month with 12 views per 1M.
- Tolerance ±0.55, or ±2.5 % for values ≥ 100 (so "~1 400" matches 1 431). An explicit sign must match
  ("+63 %" fails against −63); unsigned numbers match either sign ("fell 63 %").
- Computed differences ("20 pp more than …") are not in the data and are reported as unverified — state both numbers.

## Language check (`checkLanguage` in `scripts/lib/claims.ts`)

The answer and the PDF must be in one language — the user's. `report.ts` runs this on the agent's text; `check_claims.ts
--lang <code>` runs it on a chat draft. Article titles and topic names are removed first (proper names).
- **uk:** Russian-only letters (ы э ъ ё); Russian-only endings (-ия/-ии/-ию/-ией, -ость, -уется/-ается/-яется, -тся
  without ь, -ськую); frequent Russian words seen in testing (растет, растущий, Википедия, что, как, или, …); calques
  in the phrases where they are wrong («доля переглядів» → частка, «на українській мові» → українською мовою); and
  "Wikipedia" in Latin letters (→ Вікіпедія).
- **every language except en:** tool terms left in English (flat, growing, declining, trust, high/medium/low, YoY, views…).
- Retro-check on 27 saved Ukrainian Haiku answers: 23 had issues (mostly "Wikipedia", "YoY", "растет", English
  labels); 0 false positives on the clean ones and on 44 reference Ukrainian strings.

The report's own UI text comes from `scripts/lib/i18n.ts` (built-in uk, en; any other language through
`--labels-template` → translated JSON → `--labels`, validated for missing keys and placeholders).

## PDF fonts (`scripts/lib/fonts.ts`)

DejaVu Sans (bundled via npm) draws Latin, Cyrillic (incl. Kazakh), Greek and Vietnamese. Text it cannot draw — e.g.
Japanese, Korean or Chinese article titles — uses a system fallback font: `WI_FALLBACK_FONT` (a .ttf/.otf path) or
Arial Unicode (macOS, Windows). The chart has a single font, so its legend shows language codes (or `lang: topic`).
Scripts that need shaping (Arabic, Hebrew, Indic, Thai, …) and emoji are never drawn: article titles fall back to the
topic name, and agent text containing them is a `problems` item in `report.ts`. Found in testing: ja/ko titles
rendered as empty boxes before the fallback existed.

## Known limitations of the source

- Pageviews, not unique readers; one person reading 30 times counts 30 times.
- Views of a redirect are counted on the redirect title, and history under an old title is not merged (roadmap).
- Wikimedia reclassified more traffic as automated in 2025, and human traffic fell in every edition we measured
  (Sep 2025–Aug 2026 vs the year before, median month: uk −28 %, es −22 %, tr −19 %, pl −12 %, de −8 %, en −5 %).
  `relativeGrowth` corrects for this only if the decline is the same for all topics — AI answers probably replace
  quick fact lookups more than deep reading, so treat small relative changes (< ±10 %) as flat.
- Article quality and length drive views: a stub in a small edition attracts fewer readers than the real interest.
