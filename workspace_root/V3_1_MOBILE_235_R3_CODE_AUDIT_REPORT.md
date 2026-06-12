# AUDIT — community: v3-1 challenges mobile (PR #235 R3 final)

VERDICT: NOT CLEAN

- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #235 (`feature/community-v3-challenges-mobile`)
- Audited HEAD: `6d4bed83ce712789b25242e8e4997269b26bc33f`
- Base: `origin/main` at merge-base `e2d2e99ef2dfe4e03da22224fab9ff529fd49a44`
- Worktree: `/home/user/workspace/tgp/audit-v3-1-mobile-235-r3-code`
- PR URL: https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/235

## CI / merge gate

- **NOT GREEN at audit time.** `gh pr view 235 --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup,url` returned `headRefOid=6d4bed83ce712789b25242e8e4997269b26bc33f`, `mergeable=MERGEABLE`, `mergeStateStatus=UNSTABLE`, and one CI check run (`Typecheck, lint, test`) with `status=IN_PROGRESS`, empty conclusion, job URL https://github.com/BradleyGleavePortfolio/growth-project-mobile/actions/runs/27415132070/job/81025912408.
- The brief requires CI green for a CLEAN verdict, so this gate alone prevents CLEAN.

## P0 findings

None found.

## P1 findings

### P1-1 — R2 pagination finding is not actually closed against the binding backend contract

The R2 P1 was “unpaginated challenge/comment/leaderboard data path.” The mobile PR now sends `{ limit: 20 }` in request params, but the merged/backend binding contract does not accept or enforce those params for the relevant endpoints, so the server-side payloads remain unbounded.

**Mobile-side evidence:**
- `src/api/communityChallengesApi.ts:215-217` defines page-limit constants of 20.
- `src/api/communityChallengesApi.ts:248-257` sends `params` for `listChallenges`.
- `src/api/communityChallengesApi.ts:307-317` sends `params` for `getLeaderboard`.
- `src/api/communityChallengesApi.ts:320-330` sends `params` for `listComments`.
- `src/screens/community/CommunityChallengeDetailScreen.tsx:109-124` and `:133-150` include page-limit values in React Query keys and calls.

**Backend contract evidence (current merged backend PR #390 head `6d97f46a8d717fc80a3e1d5a53ca1aa517904782`, PR URL https://github.com/BradleyGleavePortfolio/growth-project-backend/pull/390):**
- `src/community/challenges/community-challenges.dto.ts:152-160` defines `ListChallengesQueryDto` with only `cohort_id` and `status`; there is no `limit` or `cursor`.
- `src/community/challenges/community-challenges.controller.ts:136-155` defines leaderboard and comments GET handlers with no `@Query()` parameter at all.
- `src/community/challenges/community-challenges.repository.ts:82-95` calls `communityChallenge.findMany(...)` with no `take`/`limit`/`cursor`.
- `src/community/challenges/community-challenges.repository.ts:263-269` calls `communityChallengeParticipation.findMany(...)` for leaderboard with no `take`/`limit`/`cursor`.
- `src/community/challenges/community-challenges.repository.ts:329-338` fetches all opt-in sentinels for the challenge with no `take`/`limit`/`cursor`.
- `src/community/challenges/community-challenges.repository.ts:365-373` calls `communityMessage.findMany(...)` for comments with no `take`/`limit`/`cursor`.

**Impact:** Category 3 remains open: the client may request a limit, but the backend still computes and returns all matching challenges, all leaderboard participations/opt-in rows, and all comments. This preserves the scale failure identified in R2 and is not a cosmetic concern.

**Required fix:** Add backend-enforced `limit`/cursor or offset DTOs and repository `take`/cursor enforcement for list, comments, opt-in lookup, and leaderboard generation, then update the mobile client and tests to match the real response contract.

## P2 findings

### P2-1 — PR commits a local absolute `node_modules` symlink

The diff adds a tracked symlink named `node_modules` pointing to an auditor/builder-local absolute path:

```diff
diff --git a/node_modules b/node_modules
new file mode 120000
--- /dev/null
+++ b/node_modules
@@ -0,0 +1 @@
+/home/user/workspace/tgp/mobile-v3-1-builder/node_modules
```

Evidence:
- `git diff --name-status origin/main...HEAD` shows `A node_modules`.
- `git diff origin/main...HEAD -- node_modules` shows the symlink target `/home/user/workspace/tgp/mobile-v3-1-builder/node_modules`.
- `git log --diff-filter=A --format='%H %s' -- node_modules` shows the symlink was introduced in PR commit `07054ef697714b9b0775f533f3876119e5026cbb`.

**Impact:** This is local-environment pollution in the repository diff. A committed absolute symlink to a workspace-specific dependency directory is non-portable and can break clean clones, tooling assumptions, and dependency hygiene.

**Required fix:** Remove `node_modules` from the PR tree and ensure dependency directories remain ignored/untracked.

## R2 closure matrix

| R2 item | Status | Audit notes |
|---|---:|---|
| P1 unreachable route / missing `workspaceId` | CLOSED | `CommunityTabScreen` adds a flag-gated Challenges tab and passes `workspaceId` (`src/screens/community/CommunityTabScreen.tsx:59-65`, `:98-103`); `CommunityChallengesScreen` resolves `workspaceId` internally from `useCommunityMe` when no prop is supplied (`src/screens/community/CommunityChallengesScreen.tsx:61-85`); regression tests cover no-prop and explicit-prop cases (`src/screens/community/__tests__/CommunityChallengesScreen.test.tsx:90-127`). |
| P1 Bradley #36 haptic catch | CLOSED | `ChallengeProgressSheet` skips web and logs native haptic rejection with structured non-PII context via `logger.warn` (`src/components/community/ChallengeProgressSheet.tsx:163-184`). Submit failures are surfaced inline and keep the user draft (`src/components/community/ChallengeProgressSheet.tsx:187-205`). |
| P1 unpaginated challenges/comments/leaderboard | **NOT CLOSED** | Mobile request params were added, but backend #390 does not accept/enforce them and repository reads remain unbounded; see P1-1. |
| P2 no leave/withdraw path | ACCEPTED / DOCUMENTED | No fabricated leave method was added; the API documents the no-leave decision and keeps reversible leaderboard opt-out only (`src/api/communityChallengesApi.ts:347-367`), matching the backend route set. |

## Rebase quality checks

| Check | Status | Evidence |
|---|---:|---|
| `CommunityTodayScreen.tsx` parallel-handler UNION | PASS | `goToEvent` and `goToChallenge` both coexist with independent feature gates and fallbacks (`src/screens/community/CommunityTodayScreen.tsx:55-75`), and Today cards call their respective handlers (`:150-168`). |
| `.env.example` UNION | PASS | Both `EXPO_PUBLIC_FF_COMMUNITY_EVENTS=false` and `EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES=false` are present (`.env.example:102-106`). |
| `CommunityNavigator.tsx` route UNION + featureFlags de-dupe | PASS | One `featureFlags` import exists (`src/navigation/CommunityNavigator.tsx:18`); event and challenge routes are all retained under their feature gates (`:45-62`). |
| Conflict markers | PASS | Added-line scan found no `<<<<<<<`, `=======`, or `>>>>>>>`. |

## R0 / Bradley #36 / R69 sweep

- R0 grep battery on added lines: no conflict markers, no `console.*`, no `debugger`, no `forceExit`, no `detectOpenHandles`, no `as any`, no `as unknown as`, and no empty/swallowed catches found.
- Bradley #36 catch sweep: production catches either rethrow/wrap (`src/api/communityChallengesApi.ts:168-197`), log structured haptic context (`src/components/community/ChallengeProgressSheet.tsx:176-184`), or surface a user-visible retry/error state (`src/components/community/ChallengeProgressSheet.tsx:187-205`).
- R69/schema sweep: no Prisma/schema/migration/package/native config files changed. The blocker is not schema drift; it is that the paired backend contract still lacks enforced pagination.
- Raw color/font weight scan: no added app-screen raw colors or `700`/`800`/`900` font weights found; raw color/rgba additions are in `src/theme/tokens.ts` token definitions/comments.

## 50-Failures sweep matrix (all 8 categories)

| Category | Status | Notes |
|---|---:|---|
| 1 Security | PASS | Response schemas are strict; API errors are wrapped; no hardcoded secrets found in added challenge source. Backend authorization remains the binding backend’s responsibility. |
| 2 Architecture | PASS | Challenge API, list/detail screens, card, progress sheet, and tests are reasonably separated. Route reachability is now fixed. |
| 3 Performance | **FAIL** | R2 unpaginated data path remains open because backend list/comment/leaderboard queries are still unbounded despite mobile-sent `limit` params. |
| 4 Concurrency/state | PASS | Join and leaderboard opt-in use React Query `onMutate`/`onError`/`onSettled` rollback patterns; progress conflicts trigger refetch. |
| 5 Error handling/observability | PASS | Haptic catch logs; mutation failures surface user-visible messages; API transport wraps errors. |
| 6 Code quality | WARN | No R0 blocker found, but the PR adds a tracked absolute `node_modules` symlink, which is repository hygiene pollution (P2-1). |
| 7 Data integrity | PASS | No schema changes; progress update is routed through the backend monotonic contract; no client-side fabricated leave contract. |
| 8 Infrastructure/deployment | **FAIL** | CI was still in progress/UNSTABLE at audit time, and the PR adds a non-portable local `node_modules` symlink. |

## Required before CLEAN

1. Make pagination real end-to-end: backend DTO/controller/service/repository must accept and enforce bounded list/comment/leaderboard limits, and mobile tests should assert against that real contract.
2. Remove the committed `node_modules` symlink from the PR.
3. Re-run `gh pr view 235` and confirm all required CI checks are completed with success.

VERDICT: NOT CLEAN
