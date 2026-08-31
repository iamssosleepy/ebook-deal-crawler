# Price history and Kobo consolidation

## Product boundary

The product name is **每日四平台電子書特價情報**. The current production view
reports current and original prices, discount, and campaign dates for Readmoo,
Kobo, Books.com.tw, and Pubu. It must grow into a verifiable price-history
tracker; it must not claim an all-time low before enough valid observations
exist.

## Price observation model

Keep the current daily snapshot for Google Sheets and Discord. Add an
append-only observation store with at least:

- `observed_at`, `platform`, `platform_product_id`, and optional `isbn`
- normalized title, author, and publisher
- original price, sale price, campaign start and end
- product URL, official source URL, fetch method, and confidence
- an immutable observation key and the crawler commit/run identifier

Within one platform, use the platform product ID as the primary identity. Only
merge identities across platforms when ISBN or a reviewed mapping proves they
are the same edition. Missing, untraceable, or low-confidence prices cannot
update a historical minimum.

The derived view should expose current price, historical minimum, previous
minimum, difference from minimum, first/last observed dates, and sample count.
When evidence is insufficient, label the row as `history-building`, not
`all-time-low`.

## Kobo hard stop

The live Kobo source is preferred. A local fallback row is valid only when it
matches the target year/week and contains date, title, a product link, and an
official `source_url`. If the live paths and valid fallback both produce no
Kobo rows, `REQUIRE_ALL_SOURCES=1` must stop that production run before Google
Sheets or Discord writes.

## Consolidation milestone

- Cutover: **2026-09-18 10:00 Asia/Taipei**.
- Parallel comparison weeks: 2026-09-03, 2026-09-10, and 2026-09-17.
- Import the 112 verified Kobo rows, source evidence, deduplication keys, and
  weekly backfill behavior from `kobo-weekly-book-list` into this repository's
  history layer.
- Verify that this repository can independently create current-week Kobo
  fallback data and that the three comparison weeks agree before cutover.
- After acceptance, remove the separate 07:00 Kobo writer and stop syncing the
  dedicated `Kobo99` sheet. Preserve its repository, JSONL, and Sheet as
  read-only evidence; do not delete them.
- If acceptance fails, do not force the cutover. Keep the existing fallback and
  record the failed criterion as a blocker.

