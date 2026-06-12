# AUDIT — v2-4 backend AI inbox triage (PR #391)

VERDICT: NOT CLEAN

Typecheck: fail/inconclusive — ran `npx tsc --noEmit` twice; both runs were killed by the sandbox with SIGKILL before TypeScript emitted diagnostics. `npx nest build` did pass.
Lint: pass — `npx eslint src/` completed with 0 errors and 17 pre-existing warnings outside the PR files.
Build: pass — `npx nest build` completed successfully.
Tests: exact requested command failed before running tests because this Jest version replaced `--testPathPattern` with `--testPathPatterns`; equivalent `npx jest --runInBand --testPathPatterns "ai-triage|module-graph|openapi|roles-enforced"` passed 7 suites / 56 tests.
Grep battery: pass — added-line R0 grep returned `GREP CLEAN`; Prisma schema check returned `SCHEMA CLEAN`.

## P0 findings
- None.

## P1 findings
- None.

## P2 findings
- [src/community/ai-triage/triage-cache.service.ts:31,57-74] The in-memory cache is not actually bounded despite the brief's cache-safety requirement. `store` is a plain `Map<string, CacheEntry>` keyed by coach id, `set()` only appends/replaces the current coach entry, and expired entries are deleted only when that same coach later calls `get()`; there is no max-size eviction and no TTL sweep/purge on writes, so entries for coaches who never return remain resident for the process lifetime. This is a P2 memory-leak/operational-quality issue and fails the requested “bounded TTL/size” check. Concrete fix: add an explicit max size with LRU/oldest-entry eviction, and/or purge expired entries on every `set()` plus tests proving expired entries for other coaches are collected.
- [src/community/ai-triage/ai-triage.service.ts:314-325] `resolveCohortNames()` performs one `CommunityAccessService.findCohort()` database query per unique cohort via `Promise.all(unique.map(...))`. The triage fetch can include up to 50 messages and 50 posts, so a cache miss can issue up to 100 cohort-name lookups before invoking the LLM. This is a bounded but avoidable N+1 query pattern on the new endpoint. Concrete fix: batch cohort names with a single `findMany({ where: { id: { in: unique } }, select: { id, name } })` repository method, or include cohort names in the candidate queries.

## P3 (non-blocking)
- None.

## Verification of PR claims
- HEAD verified: checked out PR #391 at `8ca1137344c87e17b4266dc45b13b4a5d108bec9`.
- DI fixer claim verified: `AiTriageModule` registers `{ provide: TriageCacheService, useFactory: (): TriageCacheService => new TriageCacheService() }`, which is semantically the requested factory provider and avoids Nest resolving the constructor's `Function`-typed clock parameter [src/community/ai-triage/ai-triage.module.ts:35-47].
- Zero-required-arg constructor verified: `TriageCacheService` still has `constructor(private readonly now: () => number = () => Date.now())` [src/community/ai-triage/triage-cache.service.ts:29-34].
- Class-token injection verified: `AiTriageService` injects `private readonly cache: TriageCacheService`; grep found no `CLOCK_FN` token in `src` or `test` [src/community/ai-triage/ai-triage.service.ts:93-98].
- Deterministic cache-test construction verified: tests directly construct `new TriageCacheService(() => now)` for TTL control [test/community/ai-triage/triage-cache.service.spec.ts:58-78].
- Module graph / OpenAPI / roles-enforced files exist and the targeted run passed under the supported Jest flag. The meta-tests compile `AppModule`, check unexpected module cycles, assert OpenAPI invariants, and ensure every route has `@Roles`/`@Public` or an allowlist reason [test/module-graph.spec.ts:246-335; test/openapi-spec.spec.ts:20-82; test/roles-enforced.spec.ts:179-283].
- Endpoint contract verified: backend exposes `GET /community/ai-triage` with `JwtAuthGuard`, `RolesGuard`, community feature guard, AI-triage feature guard, `@Roles('coach','owner')`, and throttling on the coach AI generation bucket [src/community/ai-triage/ai-triage.controller.ts:43-64].
- Tenant scope / IDOR verified: the controller accepts no path/query/body coach id, passes only `req.user` to the service, and the service derives `cohortIds` from `repo.coachedCohortIds(user.id)` before fetching candidates [src/community/ai-triage/ai-triage.controller.ts:58-64; src/community/ai-triage/ai-triage.service.ts:106-120]. The repository scopes message/post reads to `cohort_id: { in: cohortIds }` [src/community/inbox/community-coach-inbox.repository.ts:64-91,103-145].
- Input-validation boundary verified: the endpoint has no body/query/path params and validates outbound wire payloads with `TriageResponseSchema.parse()` before returning [src/community/ai-triage/ai-triage.controller.ts:58-64].
- Read-only/no autonomous send verified: added service dependencies are gateway, tenant-scoped inbox repository, access service, and cache; no messaging/materialiser/approval dependency is injected [src/community/ai-triage/ai-triage.service.ts:93-98].
- Cache tenant isolation verified: cache access uses `this.cache.get(user.id, freshnessKey)` and `this.cache.set(user.id, freshnessKey, response)`, so one coach cannot hit another coach's cached triage by freshness key alone [src/community/ai-triage/ai-triage.service.ts:112-130,167-177].
- Cache freshness/TTL partially verified: freshness key includes item count and newest candidate timestamp, and TTL is fixed at five minutes (`TRIAGE_CACHE_TTL_MS = 5 * 60 * 1000`) [src/community/ai-triage/triage-cache.service.ts:21,42-74]. Bounded-size/GC is not verified because of the P2 finding above.
- Mobile PR #239 contract comparison verified: mobile mirrors the same five categories, two source kinds, `TriageItemSchema`, `TriageBucketSchema`, `TriageResponseSchema`, and `GET /community/ai-triage` client path [../audit-v2-4-mobile-pr239/src/api/communityAiTriageApi.ts:37-98]. Backend schema matches those fields and constraints [src/community/ai-triage/triage-output.schema.ts:26-92]. No P0 contract drift found.

## 50-Failures sweep across all 8 categories on added lines
- Category 1 Security (#1-#13): no added secrets, raw SQL, path/query coach-id IDOR, or request body validation gap found. Auth/roles/feature guards and per-coach repository scoping are present. Rate limiting is present via `COACH_AI_GENERATION` throttle.
- Category 2 Architecture (#14-#20): module is self-contained and added to `CommunityModule`; module-graph targeted tests passed. No new schema table or circular module edge found.
- Category 3 Performance (#21-#27): P2 N+1 cohort-name lookup found in `resolveCohortNames()`; candidate windows are otherwise bounded at 50 messages + 50 posts and no unpaginated all-history fetch was added.
- Category 4 Concurrency/State (#28-#32): no write race or idempotent mutation issue found; the endpoint is read-only. Cache singleton behavior is correct under Nest factory-provider semantics, but cache size/GC is a P2 state-management issue.
- Category 5 Error handling/Observability (#33-#37): added LLM failure paths log warnings and degrade to typed empty triage; the R0 grep found no empty catches or `.catch(() => undefined/null)` on added lines.
- Category 6 Code quality (#38-#43): no type escape, `@ts-ignore`, TODO/FIXME, or dead added import found by the required grep. The DI factory is explicit and localized.
- Category 7 Data integrity (#44-#47): no new writes, deletes, transactions, or Prisma schema changes were added; `SCHEMA CLEAN` verified.
- Category 8 Infrastructure/Deployment (#48-#50): feature flag defaults off and fails closed; no new deployment/config surface required. Dependency install surfaced one critical npm audit advisory, but PR #391 does not change package manifests or lockfile, so this is not attributed to the added lines.

VERDICT: NOT CLEAN
