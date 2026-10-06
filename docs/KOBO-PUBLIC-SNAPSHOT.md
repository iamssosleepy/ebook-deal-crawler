# Kobo public snapshot — bounded W37 recovery

## 2026-10-06 update (supersedes the W37-only rule)

Secondary public source approved by Eric 2026-10-06:

(A) Same-campaign-week cache of rows read from the official Kobo Blog article, stored in `KOBO_CACHE_DIR` / `DELIVERY_STATE_DIR` on the runner, never reused across weeks. The week is the existing campaign week from `campaignWeek()` / `campaignDates()`.

(B) The public deals API is a secondary fallback only when official reads fail and no valid same-week cache exists. `parseKoboSnapshot` checks the same week via the `source` label, `fetchedAt` freshness of at most 8 days and not in the future, complete week dates, Kobo book URLs, and price 99. Published output and CI logs must not name the secondary source. Rows carry the official article URL as the source page, `fetch_method` `kobo-fallback`, and confidence medium.

Read order: official markdown, validated local JSONL, official HTML, same-week cache, secondary live API, then the checked-in snapshot file. The cache is written only after official markdown or HTML succeeds. Local, cache, and fallback rows are not written back as an official cache.

Config:

- `KOBO_FALLBACK_URL` — the secondary source's API URL, supplied only via the repository secret `KOBO_FALLBACK_URL` wired into the daily workflow; unset/empty/`off` disables the live fallback; never commit the URL.
- `KOBO_CACHE_DIR` — cache directory. When unset, `DELIVERY_STATE_DIR` is used. When both are unset, the cache is off.

The paragraph below that begins "Next week requires a new authorized readable snapshot" and ends "No alternate requests" is superseded by this update. A same-week cache of an official read may be reused. Reuse of a prior week's cache, date relabelling, and naming the secondary source in published output or CI logs remain forbidden.

## Original W37 record

On 2026-09-11 Eric supplied a secondary public source (an aggregator's public deals page/API) and asked for the simple approach. Its normal public GET response contained 8 Kobo books for September 10–16, source label `Kobo Blog weekly-dd99-2026-w37`, native fetchedAt 2026-09-11T04:12:34.402Z. The snapshot is factual title/date/price/product metadata, not ebook contents. It is NOT a direct official Kobo verification.

`data/kobo-snapshot.json` is the single versioned input. No new service, account,
credential or scheduler. The existing company-only daily producer reads it before
its old fallback routes; fresh full current-week validation is mandatory. CSV keeps
the secondary source as source/medium confidence. At Eric's subsequent request, Discord no
longer displays the secondary-source attribution wording; internal provenance and the
existing source link remain intact. OriginalPrice 0 means unknown, not a free original price. Old local Kobo
history is not overwritten. No paid endpoint or refresh-trigger endpoint was used.

This recovers **this week's input**, not verified perpetual API ingestion.

> Superseded on 2026-10-06: "Next week requires a new authorized readable snapshot or a successful original source. No date relabelling, stale-week reuse or second publisher is permitted. Web reader could not open the official page or API; the source bytes used here were already obtained by the authorized public GET before the latter web-reader failure. No alternate requests are made to retry those blocked reads in this repair."

Same-week cache and the secondary fallback in the 2026-10-06 update replace that rule. Date relabelling and stale-week reuse stay forbidden. The checked-in file is no longer tried before the official routes.

Validation: `node --test`; then the existing daily workflow with dry_run=1 and all
four sources. Do not mark published based only on unit tests or a generated CSV.
