import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClaims, checkLabels, checkLanguage, extractNumbers } from "../scripts/lib/claims.ts";
import { computeMetrics } from "../scripts/lib/metrics.ts";

// 12 months at 1182 views, then 12 months at 437 — the medians of the real uk/Астрономія series
const user = Array.from({ length: 24 }, (_, i) => ({ month: new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 7), views: i < 12 ? 1182 : 437 }));

test("extractNumbers: percent, signs, thousands, decimals, multipliers; ignores dates, years, small counts, '1M'", () => {
  const got = extractNumbers("У 2025-09 (2025 рік) uk: −63% р/р, 1 431 переглядів, 36,8%, +12.5%, 1,431 views, ~1.4k, 3 мови, per 1M views, 47% ботів").map((c) => c.value);
  assert.deepEqual(got, [-63, 1431, 36.8, 12.5, 1431, 1400, 47]);
});

test("small plain numbers must be nearly exact (regression: '2.4x' matched the spike factor 2.5)", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user });
  assert.deepEqual(checkClaims("у 2.4x більше", { series: [m] }).unverified, ["2.4"]);
  assert.deepEqual(checkClaims("спайк = 2.5× медіани; R² = " + m.r2, { series: [m] }).unverified, []);
  assert.deepEqual(checkClaims("−63% (округлено з −63.0%)", { series: [m] }).unverified, []);
});

test("extractNumbers ignores year ranges (regression: 'in 2025–26' was read as −26)", () => {
  assert.deepEqual(extractNumbers("traffic fell in 2025–26, 2024-2026 and 2024 — 25%").map((c) => c.value), [25]);
  // regression (iteration 4): Haiku wrote the range with U+2212 MINUS SIGN
  assert.deepEqual(extractNumbers("у 2025\u221226 (−22%)").map((c) => c.value), [-22]);
});

test("checkClaims: exact and rounded values pass; invented numbers and wrong signs fail", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user });
  const a = { series: [m] };
  assert.equal(m.robustGrowth, -63);
  assert.deepEqual(checkClaims("Інтерес впав на 63% (−63%), ~440 переглядів на місяць.", a).unverified, []);
  assert.deepEqual(checkClaims("Інтерес зріс на +63% і на 45%.", a).unverified, ["+63%", "45%"]);
});

test("checkClaims: a percentage never matches a monthly count/rate (regression: '12%' matched a month with 12 views per 1M)", () => {
  const m = computeMetrics({ lang: "uk", project: "uk.wikipedia", article: "X", user, projectTotal: user.map((p) => ({ month: p.month, views: 1e8 })) });
  assert.ok(m.perMillionSeries!.some((p) => Math.abs(p.views - 11.82) < 0.01), "fixture has a per-1M value ≈ 11.8");
  assert.deepEqual(checkClaims("Інтерес виріс на 12% у вересні", { series: [m] }).unverified, ["12%"]);
  assert.deepEqual(checkClaims("11.8 переглядів на 1M", { series: [m] }).unverified, []);
});

test("checkLabels flags 'growing' for a flat series and respects negation, two-language sentences and consistent labels", () => {
  const series = [
    { lang: "tr", verdict: { label: "flat" as const, basis: "no clear change — +7% is inside the ±10% noise band" } },
    { lang: "fr", verdict: { label: "declining" as const, basis: "share −13%" } },
    { lang: "id", verdict: { label: "declining" as const, basis: "share −15%" } },
  ];
  // regression: the iteration-3 PDF verdict and finding
  assert.equal(checkLabels("Турецька хвиля: єдиний растущий ринок.", series).length, 1);
  assert.equal(checkLabels("Турецька вікіпедія — єдина країна, де інтерес до англійської ЗРОСТАЄ (на +7% YoY).", series).length, 1);
  assert.equal(checkLabels("tr: interest is growing (+7%)", series).length, 1);
  // not flagged
  assert.deepEqual(checkLabels("Інтерес у турецькій Вікіпедії не зростає: +7% у межах шуму.", series), []);
  assert.deepEqual(checkLabels("Французька показує найсильніше скорочення (−13%).", series), []);
  assert.deepEqual(checkLabels("Chess is growing in Turkish but declining in Indonesian.", series), []);
  assert.deepEqual(checkLabels("Простий висновок: турецька аудиторія стабільна.", series), []);
  // regression (false positive in iteration-1 eval 4): the decline word describes the platform, not the series
  assert.deepEqual(checkLabels("Chess is gaining relative share in Turkish Wikipedia despite the platform-wide traffic decline.",
    [{ lang: "tr", verdict: { label: "growing", basis: "" } }]), []);
  // multi-topic, single-language runs are skipped (sentences name topics, not languages)
  assert.deepEqual(checkLabels("Українська: зростає", [{ lang: "uk", verdict: { label: "flat", basis: "" } }, { lang: "uk", verdict: { label: "flat", basis: "" } }]), []);
});

test("checkLanguage (uk) catches the Russian and English leaks seen in real Haiku answers, and passes clean Ukrainian", () => {
  const leaks = [
    "Claude Code растет 112% англійська, 399% іспанська.",   // user's PM test, report verdict
    "Турецька Wikipedia — ЄДИНА РАСТУЧА МОВА",               // eval 3, iteration 3
    "Турецька хвиля: єдиний растущий ринок.",                // eval 3 PDF verdict
    "Аналіз інтересу до фотографії в Польщі на основі Википедии", // PM sandbox dry run
    "**Исключена**: На словацькій Вікіпедії немає статті",   // eval 5
    "Чому обрати чеськую: більше переглядів",                // trigger test
    "Англійська: Copilot flat -6%, AI growing +12%.",        // user's PM test, report verdict
    "Іспанська має найбільшу аудиторію (26K views/місяць)",  // eval 3
  ];
  for (const s of leaks) assert.notDeepEqual(checkLanguage(s, "uk", ["Claude Code", "Copilot"]), [], s);
  const clean = [
    "Інтерес до астрономії в україномовній Вікіпедії спадає: частка переглядів −47% р/р, довіра висока (80).",
    "Рекомендую спершу перевірити попит лендингом. Інтерес продовжує рости в турецькому розділі, а в польському — ні.",
    "Мости, хвости й пости — звичайні українські слова, як і «знаходиться», «дякую» та «статей».",
    "Стаття en · Integrated development environment: без змін (−6,5%).",
  ];
  for (const s of clean) assert.deepEqual(checkLanguage(s, "uk", ["Integrated development environment"]), [], s);
  // for other languages only untranslated tool terms are flagged; English is never checked
  assert.deepEqual(checkLanguage("Zainteresowanie jest flat", "pl").length, 1);
  assert.deepEqual(checkLanguage("Interest is flat, trust high", "en"), []);
});

test("checkLanguage (uk) flags Russian calques only in the phrases where they are wrong", () => {
  assert.notDeepEqual(checkLanguage("Відносна доля інтересу практично не змінилась", "uk"), []);  // seen in testing
  assert.notDeepEqual(checkLanguage("детальне пояснення на українській мові", "uk"), []);          // seen in testing
  assert.deepEqual(checkLanguage("Така вже доля цього розділу; звіт українською мовою.", "uk"), []);
});
