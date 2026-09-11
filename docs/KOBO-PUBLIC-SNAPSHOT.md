# Kobo public snapshot — bounded W37 recovery

Eric supplied https://tools.helloruru.com/ebook-deals/ on2026-09-11 and asked for
the simple approach. Its normal public GET response contained8 Kobo books for
September10–16, source label `Kobo Blog weekly-dd99-2026-w37`, native fetchedAt
2026-09-11T04:12:34.402Z. The snapshot is factual title/date/price/product metadata,
not ebook contents. It is NOT a direct official Kobo verification.

`data/kobo-helloruru.json` is the single versioned input. No new service, account,
credential or scheduler. The existing company-only daily producer reads it before
its old fallback routes; fresh full current-week validation is mandatory. CSV keeps
HelloRuru as source/medium confidence and Discord explicitly attributes the third
party. OriginalPrice0 means unknown, not a free original price. Old local Kobo
history is not overwritten. No paid endpoint or refresh-trigger endpoint was used.

This recovers **this week's input**, not verified perpetual API ingestion. Next
week requires a new authorized readable snapshot or a successful original source.
No date relabelling, stale-week reuse or second publisher is permitted. Web reader
could not open the official page or API; the source bytes used here were already
obtained by the authorized public GET before the latter web-reader failure. No
alternate requests are made to retry those blocked reads in this repair.

Validation: `node --test`; then the existing daily workflow with dry_run=1 and all
four sources. Do not mark published based only on unit tests or a generated CSV.
