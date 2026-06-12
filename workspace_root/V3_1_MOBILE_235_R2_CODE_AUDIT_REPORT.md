# AUDIT — community: v3-1 challenges mobile (PR #235)

VERDICT: NOT CLEAN

- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #235 (`feature/community-v3-challenges-mobile`)
- Audited HEAD: `7a4b7aeddecee8f48887ddd92bb3c6262404b114`
- Worktree: `/home/user/workspace/tgp/audit-v3-1-mobile-r2-code`

## Gates run

- Typecheck: PASS — `npx tsc --noEmit` exited 0 (`/home/user/workspace/v3_1_mobile_235_r2_tsc.log`, empty stdout).
- Lint: PASS — `npm run lint` exited 0 with 82 warnings / 0 errors (`/home/user/workspace/v3_1_mobile_235_r2_lint.log`).
- Tests: PASS — `npx jest --runInBand` exited 0; 214 suites / 2366 tests passed, 5 snapshots passed (`/home/user/workspace/v3_1_mobile_235_r2_jest.log`). Jest emitted existing act/open-handle warnings; no failing suites.
- R0 grep battery: RAN (`/home/user/workspace/v3_1_mobile_235_r2_r0_grep.log`). Matches were comments / token documentation only; no added `as any`, `as unknown as`, `@ts-ignore`, TODO/FIXME, placeholder copy, or code raw hex blockers found.
- Bradley Law #36 scan: RAN (`/home/user/workspace/v3_1_mobile_235_r2_silent_catches.log`, plus manual catch sweep). Found one blocker below.
- R69 Prisma/schema diff: PASS — no Prisma/schema/migration files changed (`/home/user/workspace/v3_1_mobile_235_r2_prisma_schema_diff.log`).
- D-009 checks: PASS for Path B allowlist and font-weight downgrade. `ALLOWLIST_LEADERBOARD_REFERENCE` includes the v3-1 challenge detail files (`src/__tests__/quietLuxuryDoctrine.test.ts:35-40`), and no added `fontWeight: '700'/'800'` remains (`/home/user/workspace/v3_1_mobile_235_r2_fontweight_700_800.log`).
- FACE+VOICE: PASS for the changed challenge comments empty state. Added Roman references are explanatory/test-only; the UI uses neutral non-Roman copy and does not emit local `romanVoice.ts` copy (`src/components/community/ChallengeCommentsEmptyState.tsx:11-19`, `src/screens/community/CommunityChallengeDetailScreen.tsx:353-356`).

## P0 findings

- None found in the mobile diff.

## P1 findings

1. **Challenge discovery route is registered without the only value required to load challenges, so the list route is functionally empty/unusable.**
   - Evidence: `CommunityChallengesScreen` only fetches when `workspaceId` is truthy (`src/screens/community/CommunityChallengesScreen.tsx:52-55`) and falls through to `const data = challenges.data ?? []` / empty state when there is no data (`src/screens/community/CommunityChallengesScreen.tsx:131-140`).
   - Evidence: the navigator registers `CommunityChallengesScreen` directly with no props or route params (`src/navigation/CommunityNavigator.tsx:42-46`), and the route type is `CommunityChallenges: undefined`, so a caller cannot pass `workspaceId` via navigation (`src/screens/community/communityNavTypes.ts:31-34`).
   - Evidence: the embedded Community tab never renders a Challenges tab/screen; it only switches among Today, Hall, Cohorts, and DMs (`src/screens/community/CommunityTabScreen.tsx:79-90`).
   - Why P1: the PR claims a challenge list/discovery surface, but the registered route cannot call `listChallenges`; users who reach the route see “No challenges yet” even when the backend has challenges. This breaks a primary feature surface.
   - Concrete fix: either make `CommunityChallengesScreen` resolve `workspaceId` internally from the same `useCommunityMe` source used by `CommunityTabScreen`, or change `CommunityChallenges` route params to include `workspaceId` and ensure every navigation path passes it; add a real tab/card entry and an integration test that the route calls `communityChallengesApi.listChallenges('ws-id')`.

2. **Bradley Law #36 violation: haptic completion failure is silently swallowed.**
   - Evidence: `Haptics.notificationAsync(...).catch(() => { /* Web / unsupported hardware — the visual closure still stands. */ });` catches and ignores all failures without structured context or a surfaced/retry path (`src/components/community/ChallengeProgressSheet.tsx:161-165`).
   - Why P1: R65 / Bradley Law #36 says `.catch(() => undefined|null|{})` / silent catches are P1 regardless of “best effort” status. This catch hides real native-module/runtime failures and leaves no diagnostic trail.
   - Concrete fix: handle the expected unsupported-platform case explicitly if possible, and log unexpected failures with structured non-PII context via the project logging/telemetry path (or otherwise surface a controlled fallback) rather than an empty catch.

3. **Unpaginated challenge/comment/leaderboard data path violates the required Category 3 performance gate.**
   - Evidence: the mobile client has no limit/cursor/page parameters for `listChallenges`, `getLeaderboard`, or `listComments` (`src/api/communityChallengesApi.ts:208-219`, `src/api/communityChallengesApi.ts:268-279`).
   - Evidence: the detail screen requests all comments as one query (`src/screens/community/CommunityChallengeDetailScreen.tsx:104-108`) and renders the leaderboard rows with an in-memory `.map` rather than a virtualized/paged list (`src/screens/community/CommunityChallengeDetailScreen.tsx:527-533`).
   - Paired backend contract evidence: PR #390 repository methods also return unbounded arrays for challenges, leaderboard participations, opt-in ids, and comments (`/home/user/workspace/backend_pr390_community_challenges_repository.ts:82-95`, `/home/user/workspace/backend_pr390_community_challenges_repository.ts:262-269`, `/home/user/workspace/backend_pr390_community_challenges_repository.ts:328-338`, `/home/user/workspace/backend_pr390_community_challenges_repository.ts:365-373`).
   - Why P1: the audit brief explicitly calls out “no unpaginated lists” and “no N+1 on leaderboard rendering.” This path scales linearly with total challenge/comment/participant rows and can make the mobile screen slow or memory-heavy as cohorts grow.
   - Concrete fix: add cursor/limit params to the backend DTO and mobile API client, include pagination variables in React Query keys, render leaderboard/comments through virtualized paged lists, and cap server page size.

## P2 findings

1. **No leave/withdraw path is implemented despite the audited surface including join/leave.**
   - Evidence: `communityChallengesApi` exposes `join`, `updateProgress`, `setLeaderboardOptIn`, `getLeaderboard`, comments, and report methods, but no `leave`/`withdraw` mutation (`src/api/communityChallengesApi.ts:229-310`).
   - Evidence: the detail primary action only transitions from `Join this challenge` to `Log progress` / `Log more progress`; there is no leave action once joined (`src/screens/community/CommunityChallengeDetailScreen.tsx:249-253`, `src/screens/community/CommunityChallengeDetailScreen.tsx:449-461`).
   - Why P2: users can join a challenge but cannot undo that membership from the mobile surface. If “leave” is intentionally out of scope because backend PR #390 has no leave route, the PR/spec should explicitly remove join/leave from scope; otherwise this is an incomplete core flow.
   - Concrete fix: add a backend-supported leave/withdraw endpoint and a mobile mutation/UI path, or document and test that v3-1 intentionally does not support leaving.

## P3 / informational

- `npm ci` removed the tracked `node_modules` symlink in the audit worktree (`git status --short` shows `D node_modules`). This matches the brief’s author-pollution note and is not a P0/P1/P2 blocker.
- Jest passed, but full-suite logs include React `act(...)` warnings and “Jest did not exit one second after the test run has completed.” I did not classify this as a blocker because the requested full Jest gate passed and the warnings appear outside the challenge slice.

## Verification of PR claims / required sweeps

- Flag default OFF: verified `communityChallenges: readFlag('EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES', false)` (`src/config/featureFlags.ts:142-150`) and `.env.example` sets `EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES=false` (`.env.example:102-103`).
- Navigator flag gate: verified both `CommunityChallenges` and `CommunityChallengeDetail` are only registered inside `featureFlags.communityChallenges` conditionals (`src/navigation/CommunityNavigator.tsx:42-53`).
- Leaderboard opt-in posture: verified the leaderboard query is enabled only when feature flag, coach leaderboard setting, and caller opt-in are all true (`src/screens/community/CommunityChallengeDetailScreen.tsx:115-125`), and the UI offers “Keep private” before “Share progress” (`src/screens/community/CommunityChallengeDetailScreen.tsx:473-516`).
- Optimistic update rollback: no challenge join/progress/leaderboard optimistic writes were found; mutations invalidate/refetch or keep draft/error state instead (`src/screens/community/CommunityChallengeDetailScreen.tsx:151-198`, `src/components/community/ChallengeProgressSheet.tsx:168-186`).
- Response drift validation: strict Zod schemas are in the mobile API client (`src/api/communityChallengesApi.ts:37-132`, `src/api/communityChallengesApi.ts:185-197`).
- Tenant/IDOR context: paired backend uses `readableChallenge` before join/progress/comment/report, so client joins are server-scoped to readable workspace/cohort challenges (`/home/user/workspace/backend_pr390_community_challenges_service.ts:173-190`, `/home/user/workspace/backend_pr390_community_challenges_service.ts:403-414`). However, the paired backend list path treats `isCoach` as able to see the whole workspace (`/home/user/workspace/backend_pr390_community_challenges_service.ts:334-340`, `/home/user/workspace/backend_pr390_community_challenges_service.ts:360-365`); confirm this matches the product tenant model because the audit brief stated coaches should only see their cohorts’ challenges.
- D-011 carve-out: full Jest was still run and passed; no carve-out was needed for a failing suite.

## 50-Failures sweep matrix (all 8 categories)

- Category 1 — Security: response schemas strict; no hardcoded secrets in added challenge code; client join/read relies on paired backend `readableChallenge` scope. Follow-up noted on coach list scope because backend treats workspace coaches as whole-workspace viewers.
- Category 2 — Architecture: challenge API/client/screen separation is generally clean; blocker is discovery route contract mismatch (`workspaceId` is a prop but route params are `undefined`).
- Category 3 — Performance: NOT CLEAN due unpaginated challenge/comment/leaderboard paths and non-virtualized leaderboard `.map`.
- Category 4 — Concurrency/state: no optimistic writes found for join/progress/opt-in; progress sheet keeps draft and surfaces errors.
- Category 5 — Error handling/observability: NOT CLEAN due the silent haptic `.catch(() => {})`; API transport maps and rethrows request/contract errors.
- Category 6 — Code quality: no added `as any`, `as unknown as`, `@ts-ignore`, placeholder copy, 700/800 font weights, or shipped raw-color violations found in the mobile challenge slice.
- Category 7 — Data integrity: no mobile Prisma/schema changes; paired backend uses monotonic progress and server-side participation rows, but leave/withdraw semantics are absent from the mobile slice.
- Category 8 — Infrastructure/deployment: feature flag defaults OFF in both `featureFlags.ts` and `.env.example`; route registration is flag-gated.

## Artifacts saved

- PR metadata: `/home/user/workspace/pr235_view.json`
- Backend PR #390 metadata: `/home/user/workspace/backend_pr390_view.json`
- Validation logs: `/home/user/workspace/v3_1_mobile_235_r2_npm_ci.log`, `/home/user/workspace/v3_1_mobile_235_r2_tsc.log`, `/home/user/workspace/v3_1_mobile_235_r2_lint.log`, `/home/user/workspace/v3_1_mobile_235_r2_jest.log`
- Sweep logs / extracted evidence: `/home/user/workspace/v3_1_mobile_235_r2_r0_grep.log`, `/home/user/workspace/v3_1_mobile_235_r2_silent_catches.log`, `/home/user/workspace/v3_1_mobile_235_r2_prisma_schema_diff.log`, `/home/user/workspace/v3_1_mobile_235_r2_context_refs.log`, `/home/user/workspace/v3_1_mobile_235_r2_50fail_rg.txt`, `/home/user/workspace/v3_1_mobile_235_r2_face_voice_added.log`
