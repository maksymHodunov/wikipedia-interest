# Independent cross-check of analyze.ts

Date: 2026-09-27. Method: `bash evals/crosscheck.sh <analysis.json>` re-fetches the raw Wikimedia REST API with curl and recomputes every headline metric with jq (no project code), then prints it next to the value in analysis.json. Period 2024-09 → 2026-08.

Result: **10 series × 7 metrics = 70 values, 70 identical** (8 language editions, 3 topics).

```
### Astronomy — uk,pl,cs
series source     months      yoy   robust relative  edition   avg/mo    per1M
uk     curl+jq        24    -59.6      -63    -47.2    -28.2      559      9.7
       skill          24    -59.6      -63    -47.2    -28.2      559      9.7
pl     curl+jq        24    -16.1    -36.8    -29.6    -11.9     1431      7.4
       skill          24    -16.1    -36.8    -29.6    -11.9     1431      7.4
cs     curl+jq        24    -33.3    -34.6    -23.1    -16.1      516      8.7
       skill          24    -33.3    -34.6    -23.1    -16.1      516      8.7

### Chess — tr,id
series source     months      yoy   robust relative  edition   avg/mo    per1M
tr     curl+jq        24     -9.2     -1.3     21.5    -18.7     4028     36.8
       skill          24     -9.2     -1.3     21.5    -18.7     4028     36.8
id     curl+jq        24    -29.9    -44.2    -14.6    -37.8     1434     20.5
       skill          24    -29.9    -44.2    -14.6    -37.8     1434     20.5

### English language — de,fr,es,pl,tr
series source     months      yoy   robust relative  edition   avg/mo    per1M
de     curl+jq        24       -8     -7.4     -0.7       -8    23477     33.3
       skill          24       -8     -7.4     -0.7       -8    23477     33.3
fr     curl+jq        24    -19.3      -21    -13.1    -10.1    15873     26.7
       skill          24    -19.3      -21    -13.1    -10.1    15873     26.7
es     curl+jq        24    -29.1    -31.8     -8.3    -22.4    25962     47.7
       skill          24    -29.1    -31.8     -8.3    -22.4    25962     47.7
pl     curl+jq        24    -18.3      -19    -10.1    -11.9     8087       43
       skill          24    -18.3      -19    -10.1    -11.9     8087       43
tr     curl+jq        24    -16.5    -14.6      6.7    -18.7     7080     65.3
       skill          24    -16.5    -14.6      6.7    -18.7     7080     65.3

```
