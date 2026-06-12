# AUDIT — v2-3 mobile events slice (PR #236, R1)

VERDICT: NOT CLEAN

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: #236 (`feature/community-v2-events-mobile`)  
Audited HEAD: `a79880745e7e2e33d933c4a09701f7b3559488b8`  
Worktree: `/home/user/workspace/tgp/audit-v2-3-mobile-r1-code`

## Gate results

- Dependency install: PASS after rerunning `npm ci` with an isolated npm cache. The first attempt failed on shared npm cache rename/cleanup contention, not repo code.
- Typecheck: PASS — `npx tsc --noEmit` exited 0.
- Lint: PASS — `npm run lint` exited 0 with 82 warnings / 0 errors.
- Tests: PASS — `npx jest --runInBand` exited 0; 216 suites passed, 2395 tests passed, 5 snapshots passed. Jest printed the known post-run open-handle warning; D-011 React-Query leak is carved out by the brief.
- R0 grep battery: NON-BLOCKING hits only: a `#389` comment false-positive and one `as unknown as` cast in a test (`src/hooks/__tests__/useReducedMotion.test.tsx:49`).
- Bradley Law #36 swallowed catches: FAIL — see P1 finding.
- R69 Prisma/schema diff: PASS — no Prisma/schema/SQL/migration files changed.
- FACE+VOICE: PASS — event empty states are neutral; no Roman-voice event copy renders without RomanAvatar.
- Feature flag posture: PASS — `EXPO_PUBLIC_FF_COMMUNITY_EVENTS` defaults OFF in `src/config/featureFlags.ts:159` and `.env.example:103`; event routes are registered only under `featureFlags.communityEvents` in `src/navigation/CommunityNavigator.tsx:43-44` and `src/navigation/CoachCommunityNavigator.tsx:73-78`.

## P0 findings

None.

## P1 findings

- `src/hooks/__tests__/useCommunityEvents.test.tsx:158` and `src/hooks/__tests__/useCommunityEvents.test.tsx:223` — added tests use `.catch(() => undefined)` to suppress rejected `mutateAsync` calls. R65 / Failure #36 explicitly names `.catch(() => undefined)` as a Bradley Law P1 pattern; even in expected-rejection tests this hides the thrown error class/message instead of asserting it. Concrete fix: replace with explicit rejection assertions or a `try/catch` that asserts the expected failure and fails on unexpected success/error shape.

## P2 findings

- `src/hooks/useCommunityEvents.ts:40-47` and `src/api/communityEventsApi.ts:273-293` — the React Query list key omits `opts.limit` even though `limit` is part of the request sent to `/community/workspaces/:workspaceId/events`. Two callers for the same workspace/state/cohort with different limits will share one cache entry and can render the wrong page size. This violates the brief’s React-Query cache-key check. Concrete fix: include every request-shaping option in `communityEventsKeys.list`, including `limit` and any future cursor.

- `src/api/communityEventsApi.ts:112-116`, `src/api/communityEventsApi.ts:273-277`, and `src/screens/community/CoachCommunityEventsScreen.tsx:272-284` — the API schema exposes `next_before`, but the mobile request options do not accept a cursor/before parameter and the coach `FlatList` has no `onEndReached`/load-more path. Once the backend returns a page with `next_before`, older events become inaccessible in the mobile list. Concrete fix: add cursor support to `ListEventsOptions`/API params/query key and wire `FlatList.onEndReached` with a calm loading/footer state.

- `src/screens/community/CoachCommunityEventsScreen.tsx:1026-1044` and `src/screens/community/CommunityEventDetailScreen.tsx:623-630,668-671` — several new interactive controls use `minHeight: 44` (`reflectTrigger`, `modalButton`, quiet RSVP buttons, retry button), below the brief’s 48dp tap-target floor. Concrete fix: raise these interactive styles to `minHeight: 48` (and keep modal action layouts from shrinking below that floor).

## P3 / non-blocking observations

- `src/hooks/__tests__/useReducedMotion.test.tsx:49` uses `as unknown as` in a Jest mock for `AccessibilityInfo.addEventListener`; this is test-only and was the only true R0 grep battery type-cast hit.
- `npm ci` reported existing audit vulnerabilities (18 total, 4 high), but `package.json` / lockfile are not changed by this PR, so I did not treat that as a PR-scoped merge-bar finding.

## Verification of PR claims / required checks

- Backend route contract verified against fetched backend `main` files saved under `/home/user/workspace/v2_3_mobile_236_backend_contract/`: the mobile routes match `POST /community/workspaces/:workspaceId/events`, `GET /community/workspaces/:workspaceId/events`, `GET /community/events/:eventId`, `PATCH /community/events/:eventId`, `POST /community/events/:eventId/rsvp`, `POST /community/events/:eventId/replay`, and `POST /community/events/:eventId/reflect`.
- Tenant scope is enforced server-side in the fetched backend service; mobile uses authenticated API calls and does not attempt client-side scope filtering as the authority.
- Mutations send `Idempotency-Key` headers in `src/api/communityEventsApi.ts:247-249` and use them on create/update/rsvp/replay/reflect calls.
- RSVP/create optimistic updates have rollback paths in `src/hooks/useCommunityEvents.ts:127-149` and `src/hooks/useCommunityEvents.ts:166-211`.
- Error vs empty states are distinct in the new screens: coach list uses loading/error/empty branches; event detail uses loading/error/empty branches.
- No raw Prisma/schema diff for this mobile PR.
- Full 50-Failures sweep notes saved to `/home/user/workspace/V2_3_MOBILE_236_R1_50_FAILURES_SWEEP_NOTES.md`.

## Artifacts saved

- `/home/user/workspace/v2_3_mobile_236_r1_npm_ci.log`
- `/home/user/workspace/v2_3_mobile_236_r1_npm_ci_retry_isolated_cache.log`
- `/home/user/workspace/v2_3_mobile_236_r1_tsc.log`
- `/home/user/workspace/v2_3_mobile_236_r1_lint.log`
- `/home/user/workspace/v2_3_mobile_236_r1_jest.log`
- `/home/user/workspace/v2_3_mobile_236_r1_r0_grep_battery.txt`
- `/home/user/workspace/v2_3_mobile_236_r1_swallowed_catches_added.txt`
- `/home/user/workspace/v2_3_mobile_236_r1_finding_evidence.txt`
- `/home/user/workspace/v2_3_mobile_236_r1_full_diff.patch`
- `/home/user/workspace/V2_3_MOBILE_236_R1_50_FAILURES_SWEEP_NOTES.md`
