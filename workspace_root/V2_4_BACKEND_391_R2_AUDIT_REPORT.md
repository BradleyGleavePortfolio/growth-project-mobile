# AUDIT — v2-4 backend AI inbox triage PR #391 R2

VERDICT: CLEAN

Repo: `BradleyGleavePortfolio/growth-project-backend`  
PR: `#391`  
Audited HEAD: `5863782b923dc25b2982e0557b66b498cd62b63d`  
Worktree: `/home/user/workspace/tgp/audit-v2-4-backend-391-r2`

## Prior R1 P2 findings re-verified

### 1. P2 cache bounded eviction — CLOSED

Verified `src/community/ai-triage/triage-cache.service.ts` now has both a hard size cap and opportunistic TTL cleanup:

- `MAX_CACHE_ENTRIES = 1000` is defined and enforced after every `set()` via oldest-entry eviction from the insertion-ordered `Map` (`while (this.store.size > MAX_CACHE_ENTRIES) ... delete(oldest)`) at lines 39 and 109-115.
- Cache hits perform an LRU touch by deleting and re-inserting the coach entry at lines 87-90.
- Every `set()` calls `sweepExpired()` before insertion at lines 95-99.
- `sweepExpired()` scans the oldest entries up to `TTL_SWEEP_SCAN_LIMIT = 64` and deletes expired entries at lines 124-134.
- Tests cover over-cap eviction, cap retention, LRU touch survival, and expired absentee-coach cleanup in `test/community/ai-triage/triage-cache.service.spec.ts` lines 95-160.

No residual unbounded-Map finding remains.

### 2. P2 N+1 cohort lookups — CLOSED

Verified `resolveCohortNames()` no longer performs `Promise.all(unique.map(...findCohort...))`:

- `src/community/ai-triage/ai-triage.service.ts` deduplicates cohort ids and performs one `this.access.findCohortsByIds(unique)` call at lines 320-330.
- `src/community/community-access.service.ts` implements `findCohortsByIds(ids)` with a single Prisma `findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })` at lines 35-42, with empty-input short-circuit at line 38.
- Tests assert exactly one batched lookup, no per-id `findCohort()` call, deduplicated ids, and no lookup for empty candidate sets in `test/community/ai-triage/ai-triage.service.spec.ts` lines 545-590.

No residual N+1 finding remains.

## CI workflow heap fix

Verified `.github/workflows/ci.yml` adds `NODE_OPTIONS: --max-old-space-size=4096` only to the Type-check step at lines 47-51. The diff is limited to the Type-check env block, and no other workflow step/job was removed or weakened. Existing Test, rls-floor-guard, rls-live-tests, and mwb-3-live-tests jobs remain present.

## R0 / 50-Failures / doctrine re-sweep

- R69 Prisma schema diff: clean. `git diff --name-only origin/main...HEAD -- '**/*.prisma'` returned no files.
- Bradley Law #36: no added `.catch(() => undefined)`, `.catch(() => null)`, `.catch(() => {})`, or empty operational swallow was found. The added catch sites either log and return typed degraded triage, parse invalid JSON into `null`, or capture an expected exception in a guard unit test.
- No `forceExit` or `--detectOpenHandles` masks were found.
- No added focused tests (`describe.only`, `it.only`, `test.only`, `fit`, `fdescribe`) were found.
- Added-line grep did surface `as unknown as` casts in tests only; these are test-mock casts in the new ai-triage specs, not production type escapes.
- Package manifests and lockfile are unchanged; no dependency/supply-chain delta.
- `git diff --check origin/main...HEAD` passed with no whitespace errors.

### 50-Failures category sweep

1. Security: no new secrets, no user-supplied coach id, no raw SQL/unsafe Prisma, no unvalidated request payload, no send/write path, route is behind JWT, roles, feature guards, and throttling.
2. Architecture: self-contained `AiTriageModule`; module import into `CommunityModule` is localized; no circular dependency signal from diff.
3. Performance: R1 N+1 fixed by batched cohort lookup; candidate windows remain bounded at 50 messages + 50 posts; cache is now bounded.
4. Concurrency/state: endpoint remains read-only; cache has TTL, LRU touch, max-size cap, and explicit invalidation.
5. Error handling/observability: LLM failures log warnings and degrade to typed empty triage; no hidden promise catch masks.
6. Code quality: no production `any`, no `@ts-ignore`, no TODO/FIXME, no dead new dependency observed.
7. Data integrity: no writes/deletes/migrations/schema changes; triage remains derived-on-read.
8. Infrastructure/deployment: CI heap fix matches existing test heap approach and does not weaken required jobs.

## CI verification

GitHub PR checks for current HEAD `5863782b923dc25b2982e0557b66b498cd62b63d` are green:

- `build-and-test`: SUCCESS — https://github.com/BradleyGleavePortfolio/growth-project-backend/actions/runs/27407228220/job/80999276426
- `rls-floor-guard`: SUCCESS — https://github.com/BradleyGleavePortfolio/growth-project-backend/actions/runs/27407228220/job/80999276463
- `rls-live-tests`: SUCCESS — https://github.com/BradleyGleavePortfolio/growth-project-backend/actions/runs/27407228220/job/80999276355
- `mwb-3-live-tests`: SUCCESS — https://github.com/BradleyGleavePortfolio/growth-project-backend/actions/runs/27407228220/job/80999276428

## Ordered findings

None.

VERDICT: CLEAN
