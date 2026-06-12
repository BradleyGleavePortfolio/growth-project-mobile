# R2 FIXER REPORT — v2-4 backend #391 (2 P2)

**FIX COMPLETE: 42b56bc920d2fa33f5203536322de0d951e57b69**

- Repo: `BradleyGleavePortfolio/growth-project-backend`
- PR: #391, branch `feature/community-v2-ai-triage`
- Old PR HEAD: `8ca1137344c87e17b4266dc45b13b4a5d108bec9`
- New HEAD (pushed, force-with-lease): `42b56bc920d2fa33f5203536322de0d951e57b69`
- Rebased onto current backend main `97560d3168ab51d3883cf4c3a15e603d6a0b2edb` (post-#389) — one conflict in `src/community/community.module.ts` (both v2-3 events imports and v2-4 ai-triage import added; resolved by keeping both import blocks; the `@Module` provider/import lists auto-merged).
- Author: `Dynasia G <dynasia@trygrowthproject.com>`, title-only commit, NO trailers.

## Findings closed

### P2 #1 — Unbounded cache Map (memory leak) — FIXED
File: `src/community/ai-triage/triage-cache.service.ts`

**Before:** `store: Map<string, CacheEntry>` keyed by coach id. `set()` only appended/replaced the current coach's entry; expired entries were deleted ONLY when that same coach later called `get()`. No max-size cap, no TTL sweep — entries for coaches who never returned stayed resident for the process lifetime.

**After:**
- **Size cap**: `MAX_CACHE_ENTRIES = 1000`. The insertion-ordered Map's first key is the LRU; on a write that exceeds the cap, evict from the head until back under cap.
- **LRU touch**: a `get()` HIT re-inserts the entry (`delete` + `set`) so it moves to the tail (most-recently-used) and is the last to be evicted.
- **Opportunistic TTL sweep**: every `set()` runs `sweepExpired()`, which deletes expired entries from OTHER coaches, cost-capped at `TTL_SWEEP_SCAN_LIMIT = 64` inspected entries so a write stays amortised-cheap.
- `set()` also re-inserts the written coach at the tail so re-writes refresh LRU position.

**Tests added** (`test/community/ai-triage/triage-cache.service.spec.ts`):
1. Inserts beyond `MAX_CACHE_ENTRIES` evict the oldest entry; store never exceeds cap.
2. Expired entries for OTHER (absentee) coaches are eventually collected by an unrelated coach's `set()` sweep (proven without ever calling `get()` on the absentee after expiry).
3. A `get()` HIT updates LRU position so the touched entry survives the next eviction while the new LRU is evicted instead.

### P2 #2 — N+1 cohort name lookup — FIXED
Files: `src/community/community-access.service.ts`, `src/community/ai-triage/ai-triage.service.ts`

**Before:** `resolveCohortNames()` ran `Promise.all(unique.map(id => this.access.findCohort(id)))` — up to 100 separate `findUnique` queries per cache miss (50 messages + 50 posts).

**After:**
- Added `CommunityAccessService.findCohortsByIds(ids: string[]): Promise<Array<{id, name}>>` — a single `prisma.communityCohort.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })`; empty input short-circuits to `[]` (no query).
- `resolveCohortNames()` now dedupes the ids and issues ONE batched call, building the name map from the result.

**Tests added** (`test/community/ai-triage/ai-triage.service.spec.ts`):
1. Candidates spanning two cohorts (messages + posts) issue EXACTLY ONE `findCohortsByIds` call and NEVER call per-id `findCohort`; the single call carries the de-duplicated id set.
2. Empty candidate set issues no cohort lookup at all.

## Mandatory checks

1. **R0 grep battery (added lines)**: CLEAN for all production + newly-added lines. The full-PR-diff grep surfaces 6 `as unknown as` lines, but all are **pre-existing test-mock casts** present at the original PR HEAD `8ca1137` (e.g. `mocks.gateway as unknown as AiGatewayService`, `} as unknown as User`) — standard test typing for casting mock objects to interfaces, not production type-escapes. None were introduced by this fix. The R1 audit already accepted these (reported PR added-line grep CLEAN; 50-failures sweep found no type escape in production). My added production and test lines contain none of the flagged patterns.
2. **R69 Prisma schema diff**: EMPTY — `git diff origin/main...HEAD -- '**/*.prisma'` produced no output. No new table; `findCohortsByIds` reads existing `CommunityCohort` rows.
3. **Bradley Law #36 (no swallowed catches)**: None added. The two `try/catch` blocks I touched are untouched in error semantics; cache/access changes add no catches.
4. **Build**: `npx nest build` — SUCCESS (exit 0).
5. **Targeted tests**: `npx jest --runInBand --testPathPatterns "ai-triage|module-graph|openapi|roles-enforced"` — 7 suites, **62 tests passed** (was 56; +6 new cache/N+1 tests).
6. **Full test suite**: `npx jest --runInBand` (with `NODE_OPTIONS=--max-old-space-size=6144` — the default 2GB heap OOM'd in this sandbox, an environmental limit only) — **391 suites passed, 12 skipped; 5140 tests passed, 151 skipped, 5 todo; 0 failures**.
7. **ESLint** on the three changed source files: 0 errors.

## Changed files
- `src/community/ai-triage/triage-cache.service.ts` (+65/-… ; LRU + size cap + TTL sweep)
- `src/community/ai-triage/ai-triage.service.ts` (batched `resolveCohortNames`)
- `src/community/community-access.service.ts` (new `findCohortsByIds`)
- `test/community/ai-triage/triage-cache.service.spec.ts` (3 eviction/sweep/LRU tests)
- `test/community/ai-triage/ai-triage.service.spec.ts` (batch-once + no-lookup tests; mock now provides `findCohortsByIds`)

Total: 5 files changed, 220 insertions(+), 10 deletions(-).

## Quality gate
Both P2 findings closed. No regression (full suite green). Pushed with `--force-with-lease`; remote `feature/community-v2-ai-triage` now at `42b56bc9`. Ready for R3 verification.
