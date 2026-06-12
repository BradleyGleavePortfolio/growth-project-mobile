# AUDIT — v2-3 mobile events slice (PR #236, R2)

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: #236 (`feature/community-v2-events-mobile`)  
Audited HEAD: `e668a8e079710f78e47499a2463f9fe128e12f01`  
Worktree: `/home/user/workspace/tgp/audit-v2-3-mobile-r2-code`  
Base: `origin/main` / merge-base `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`

## Gate results

- HEAD verification: PASS — worktree HEAD equals the required `e668a8e079710f78e47499a2463f9fe128e12f01`.
- Dependency install: PASS — `npm ci --cache /home/user/workspace/.npm-cache-v2-3-mobile-236-r2 --prefer-offline` exited 0. Log: `/home/user/workspace/v2_3_mobile_236_r2_npm_ci.log`.
- Typecheck: PASS — `npm run typecheck` exited 0. Log: `/home/user/workspace/v2_3_mobile_236_r2_tsc.log`.
- Lint: PASS — `npm run lint` exited 0 with 82 warnings / 0 errors, matching the existing warning posture. Log: `/home/user/workspace/v2_3_mobile_236_r2_lint.log`.
- Tests: PASS — `npx jest --runInBand` exited 0; 216 suites passed, 2406 tests passed, 5 snapshots passed. Jest still prints the known post-run open-handle warning. Log: `/home/user/workspace/v2_3_mobile_236_r2_jest.log`.
- CI status: NOT VERIFIED GREEN — `gh pr checks 236` returned `no checks reported on the 'feature/community-v2-events-mobile' branch`; `gh pr view` reported an empty `statusCheckRollup` and `mergeStateStatus: DIRTY`.
- R69 Prisma/schema diff: PASS — no Prisma/schema/SQL/migration files are changed.
- Diff whitespace: PASS — `git diff --check origin/main...HEAD` exited 0.
- R0 grep battery on added lines: PASS with one prior P3/non-blocking hit only: `src/hooks/__tests__/useReducedMotion.test.tsx:49` retains `as unknown as typeof AccessibilityInfo.addEventListener` in a Jest mock. No added-line TODO/FIXME/console.log/swallowed catch/banned placeholder copy actionable hits.

## R1 finding re-verification

- R1 P1 swallowed catch in async tests: CLOSED. The previous no-op rejection handling is now explicit `await expect(...).rejects.toThrow(...)` in `src/hooks/__tests__/useCommunityEvents.test.tsx:231-233` and `:296-303`; the added-line swallowed-catch sweep found no no-op catch.
- R1 P2 TS2352 cast safety: CLOSED for build impact. `npm run typecheck` exits 0. The remaining `as unknown as` hit is the already-classified P3 test mock in `src/hooks/__tests__/useReducedMotion.test.tsx:49`, not the R1 event-state cast issue.
- R1 P2 pagination contract drift: PARTIALLY CLOSED. The API accepts `before` and forwards it as a request param in `src/api/communityEventsApi.ts:273-306`; `useCommunityEventsInfiniteList` reads `next_before` via `getNextPageParam` in `src/hooks/useCommunityEvents.ts:104-119`; the coach `FlatList` wires `onEndReached` / `fetchNextPage` and a load-more footer in `src/screens/community/CoachCommunityEventsScreen.tsx:210-214` and `:292-319`.
- R1 P2 `useCommunityEvents` cache-key narrowness: NOT FULLY CLOSED. `limit` is now keyed, but the public single-query list path can still issue different cursor requests under one cache key; see P2-1.
- R1 tap-target issue from code/UX reports: CLOSED for added event controls. Event-surface controls inspected in `CoachCommunityEventsScreen.tsx`, `CommunityEventDetailScreen.tsx`, `EventCard.tsx`, `CoachCommunityHomeScreen.tsx`, and `CommunityTodayScreen.tsx` have no added interactive `minHeight`/`height` below 48.

## R0 / 50-Failures sweep notes

- Security: no hardcoded secrets, raw SQL construction, `dangerouslySetInnerHTML`, client-side authority claims, or new auth/CORS/JWT logic were introduced in the PR-scoped added lines.
- API boundary / contract: event responses are strict Zod parsed in `src/api/communityEventsApi.ts:84-117`; mutation and list routes route through the shared authenticated axios client with a timeout in `src/services/api.ts:93-97`.
- Performance: event list pagination is now wired through `next_before`, `useInfiniteQuery`, and `FlatList.onEndReached`; no unbounded render loop or polling was found in added event code.
- Concurrency / state: mutation hooks use React Query mutation lifecycle and rollback for RSVP/create; mutation calls surface errors through callbacks and inline/live-region UI instead of silently failing.
- Error handling / observability: actionable errors render loading/error/empty branches and mutation failure messages; no no-op catch blocks were found on added lines.
- Code quality / maintainability: no dead event modules were found in the new surface; feature flag defaults OFF and route registration is gated for both member and coach stacks.
- Data / infrastructure: no schema/migration/data-layer files changed; required CI green could not be confirmed because GitHub reports no checks for the PR branch.

## Findings

### P0

None.

### P1

None.

### P2

1. `src/hooks/useCommunityEvents.ts:51-59`, `src/hooks/useCommunityEvents.ts:81-90`, and `src/api/communityEventsApi.ts:273-306` — `communityEventsKeys.list` still omits the `before` cursor even though the public `useCommunityEventsList()` hook accepts the full `ListEventsOptions` object and passes `opts.before` to the API. The fixer rationale is correct for `useCommunityEventsInfiniteList()` because `pageParam` should not fragment an infinite-query cache, but the legacy single-query hook can still make two different request-shaped calls such as `{ before: 'cursor-a' }` and `{ before: 'cursor-b' }` under the same query key. That leaves the R1 cache-key finding incompletely closed. Concrete fix: either narrow `useCommunityEventsList` to `Omit<ListEventsOptions, 'before'>` or add a separate single-page key that includes `before` while keeping the infinite-query key cursorless.

### P3 / non-blocking observations

- `src/hooks/__tests__/useReducedMotion.test.tsx:49` still uses `as unknown as typeof AccessibilityInfo.addEventListener` in a test mock. This was present in the prior PR audit as non-blocking and remains outside the event-fixer code path.
- GitHub reported no PR checks for this branch, so CI green cannot be independently confirmed even though local install/typecheck/lint/tests pass.

## Artifacts saved

- `/home/user/workspace/v2_3_mobile_236_r2_npm_ci.log`
- `/home/user/workspace/v2_3_mobile_236_r2_tsc.log`
- `/home/user/workspace/v2_3_mobile_236_r2_lint.log`
- `/home/user/workspace/v2_3_mobile_236_r2_jest.log`
- `/home/user/workspace/v2_3_mobile_236_r2_grep_checks.txt`

VERDICT: NOT CLEAN — findings: P2-1 `communityEventsKeys.list` still omits `before` for the public single-query list path; CI green also cannot be confirmed because GitHub reports no checks.
