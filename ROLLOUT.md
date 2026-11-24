# Dongbiz D1 read budget candidate

Pinned app baseline: joseungil-kr/dongbiz d5b05df6616aeab918d7a437bf5e19742c22fbcf.
Live version known before change: 33e533a7-f291-4fb5-b2bf-ad0df7850b2c. Its creation
time matches release timing; there is no commit tag on the deployed version. Verify
lineage and capture current rollback version before any promotion. No production
action is part of this local candidate.

## What changes
- Public reader requests no longer aggregate rank_snapshots. They read the small
  derived summary, then apply the unchanged alias selection and HTML/XML logic.
  Rank detail retains its existing indexed one-key history read. No change to
  capture, public eligibility, sitemap inventory, source facts, or IndexNow call.
- Dirty triggers record inserts/deletes/updates only where old/new data meets the
  public eligibility predicate; the same transaction owns the dirty marker.
- Successful writes trigger keyword-scoped refresh. A committed rank-list batch
  is processed before the later analytics step may fail. A failed refresh rolls
  back the derived row deletion and leaves the dirty marker. Existing periodic
  slots retry at most ten keys; no new schedules. A same-isolate last successful
  summary read is a best-effort fallback for database read errors. A cold
  isolate with no successful read returns an error rather than a fake empty
  success or an unbounded history scan. Edge cache TTL remains unchanged.
- Migration 0005 is additive; it never deletes source observations.

## Promotion gate and measurement plan
1. Confirm the live database binding and build lineage, current D1 rows read
   against the 5M account/day allowance, exact current history size, compatible
   table columns/indexes, prior migration status, and rollback Worker version.
2. Allow quota headroom for a single bootstrap global scan plus normal operation
   (at least two times current history as headroom, plus expected ordinary use
   before reset); if not, defer until the next 09:00 KST reset. Review execution
   plan before that one-time migration. Do not resubmit after ambiguous errors;
   verify schema and migration ledger first. No runtime bootstrap.
3. Read and compare current and isolated hub, aliases/canonicals and related links,
   sitemap, and mock IndexNow over the same data. Keep the new Worker off production
   until the migration and build are verified. No actual IndexNow ping in testing
   or release. Do not use the existing combined deploy+ping command.
4. Compare equal time windows and traffic shape in D1 Metrics/Query Insights:
   old global fingerprint, read rows by DB, hits to /rank/detail/sitemap, scoped
   write-refresh rows; monitor errors and dirty-queue age. Mark account vs DB metric
   and time zone. Local estimates are SQLite plan-based, not Cloudflare billing.
5. Rollback is the saved previous Worker version; leave the additive derived
   schema and source rows intact. If the old Worker runs after migration, triggers
   still track prospective changes and the rollback reader keeps its old data path.
