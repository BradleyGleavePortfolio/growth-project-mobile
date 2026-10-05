/**
 * H8 (C-360-1) — how far behind its saved progress an on-device read starts.
 *
 * Progress is an EVENT-time instant, but phone health stores receive data
 * late: a watch that was out of range syncs hours later, a partner app
 * writes on its own schedule, and a night's sleep is written after waking
 * (a session that began 10 hours before it was written). HealthKit selects a
 * sample by its start (`HKQueryOptionStrictStartDate`); a Health Connect
 * `between` filter selects a record inside the range at the strictest. Either
 * way, a read that starts this far behind the saved progress and ends now
 * picks up every finished sample written within this long of its START.
 * Anything written later than that is not read.
 *
 * Re-reading is safe: the backend keys every sample on
 * sha256(user | provider | metric | start | end) with a UNIQUE index and
 * inserts with `createMany({ skipDuplicates: true })`, so a sample read again
 * is skipped, never counted twice (growth-project-backend
 * `src/wearables/ingestion/dedup.util.ts`, `ingestion.service.ts`). The same
 * rule means a posted value is never replaced, which is why HealthKit's
 * hourly sums wait to settle before they are posted
 * (`healthkit/healthKitSyncService.ts` CUMULATIVE_SETTLE_MINUTES).
 *
 * Cost: one extra day of each type per refresh (refresh runs when Health
 * opens), at most a few dozen ingest requests for a watch wearer.
 */
export const LATE_DATA_LOOKBACK_MINUTES = 24 * 60;
