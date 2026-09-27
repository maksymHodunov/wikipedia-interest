#!/usr/bin/env bash
# Independent cross-check of analyze.ts: recompute the headline metrics straight from the raw Wikimedia API with
# curl + jq (no project code) and print them next to the values in analysis.json.
#
#   bash evals/crosscheck.sh out/astronomy/analysis.json
#
# Checks months, yoy, robustGrowth, relativeGrowth, editionGrowth, avgMonthly and perMillion for every series.
set -euo pipefail
A="${1:?usage: bash evals/crosscheck.sh <analysis.json>}"
UA="wikipedia-interest-crosscheck/0.2 (independent verification)"
B="https://wikimedia.org/api/rest_v1/metrics/pageviews"
start=$(jq -r .period.start "$A"); end=$(jq -r .period.end "$A")

get() { # GET JSON with retries on throttling (429 returns text, not JSON)
  for i in 1 2 3 4 5; do
    out=$(curl -s -A "$UA" "$1") && echo "$out" | jq -e .items >/dev/null 2>&1 && { echo "$out"; return; }
    sleep $((i * 5))
  done
  echo "failed: $1" >&2; exit 4
}

printf "%-6s %-8s %8s %8s %8s %8s %8s %8s %8s\n" series source months yoy robust relative edition avg/mo per1M
jq -c '.series[] | {name, lang, article}' "$A" | while read -r s; do
  name=$(jq -r .name <<<"$s"); lang=$(jq -r .lang <<<"$s"); art=$(jq -r .article <<<"$s")
  enc=$(jq -rn --arg t "${art// /_}" '$t|@uri')
  a=$(get "$B/per-article/$lang.wikipedia/all-access/user/$enc/monthly/$start/$end"); sleep 1
  e=$(get "$B/aggregate/$lang.wikipedia/all-access/user/monthly/$start/$end"); sleep 1
  jq -rn --argjson a "$a" --argjson e "$e" --arg n "$name" '
    def med: sort | if length % 2 == 1 then .[length/2|floor] else (.[length/2-1] + .[length/2]) / 2 end;
    def pct(x; y): ((x - y) / y * 1000 | round) / 10;
    ($e.items | map({key: .timestamp[0:6], value: .views}) | from_entries) as $tot
    | ($e.items | map(.timestamp[0:6])) as $months
    | ($a.items | map({key: .timestamp[0:6], value: .views}) | from_entries) as $byM
    | ($months | map($byM[.] // 0)) as $v            # fill months the API omits with 0
    | ($months | map($tot[.])) as $t
    | ([range(0; $v|length)] | map($v[.] / $t[.] * 1e6)) as $s
    | ($v|length) as $n
    | [$n, pct($v[$n-12:]|add; $v[$n-24:$n-12]|add), pct($v[$n-12:]|med; $v[$n-24:$n-12]|med),
       pct($s[$n-12:]|med; $s[$n-24:$n-12]|med), pct($t[$n-12:]|med; $t[$n-24:$n-12]|med),
       (($v[$n-12:]|add) / 12 | round), ((($s[$n-12:]|add) / 12 * 10 | round) / 10)]
    | "\($n)|curl+jq|" + (map(tostring) | join("|"))' | {
      IFS='|' read -r _ src months yoy robust rel ed avg pm
      printf "%-6s %-8s %8s %8s %8s %8s %8s %8s %8s\n" "$name" "$src" "$months" "$yoy" "$robust" "$rel" "$ed" "$avg" "$pm"
    }
  jq -r --arg n "$name" '.series[] | select(.name == $n) | [.months, .yoy, .robustGrowth, .relativeGrowth, .editionGrowth, .avgMonthlyLast12, .perMillionLast12] | map(tostring) | join("|")' "$A" | {
    IFS='|' read -r months yoy robust rel ed avg pm
    printf "%-6s %-8s %8s %8s %8s %8s %8s %8s %8s\n" "" "skill" "$months" "$yoy" "$robust" "$rel" "$ed" "$avg" "$pm"
  }
done
