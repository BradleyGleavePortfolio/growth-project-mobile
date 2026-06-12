# FIX + REBASE REPORT — v2-3 mobile #236 P2 cache-key + rebase onto main

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR: #236 (`feature/community-v2-events-mobile`)
Worktree: `/home/user/workspace/tgp/fixer-v2-3-mobile-236-p2-rebase`
Pre-fix HEAD: `e668a8e079710f78e47499a2463f9fe128e12f01` (verified equal before any change)
Post-fix/rebase HEAD: `dd4b72c363a2d71f2717b24cc0ab22770af347f0`
Author: Dynasia G <dynasia@trygrowthproject.com>

## Setup — PASS

- Cloned repo into the worktree, fetched `pull/236/head:pr-236`, checked out `pr-236`.
- HEAD verification: PASS — checked-out HEAD equaled the required `e668a8e079710f78e47499a2463f9fe128e12f01`.
- `git config user.email/name` set to Dynasia G <dynasia@trygrowthproject.com>.
- `npm ci` (pre-fix): exit 0. Log: `/home/user/workspace/v2_3_mobile_236_p2_npm_ci.log`.

## Step 1 — Close P2 (cache-key omission on `before`) — DONE (Option A)

P2-1 from the R2 code audit: `communityEventsKeys.list` omits the `before` cursor, but the public single-query `useCommunityEventsList()` accepted the full `ListEventsOptions` (including `before`) and forwarded `opts.before` to the API. Two different cursor requests (`{ before: 'cursor-a' }`, `{ before: 'cursor-b' }`) could therefore collide under one cache key.

Fix applied (preferred Option A — narrow the type):

- `src/hooks/useCommunityEvents.ts`: changed `useCommunityEventsList(workspaceId, opts: ListEventsOptions = {})` to `opts: Omit<ListEventsOptions, 'before'> = {}`. The single-query hook can no longer pass `before`, so its cursorless cache key is now type-safe by construction. Added a docstring explaining the rationale.
- `useCommunityEventsInfiniteList()` was left accepting `Omit<ListEventsOptions, 'before'>` (already the case by design — it threads the cursor through `pageParam` under a single key).
- Callers: `useCommunityEventsList` has no callers or tests anywhere in `src/` (only the infinite-list hook is consumed by screens), so no caller updates were needed. The change is surgical: 1 file, +7 / -1.

Step 1 verification (pre-rebase):
- `npm run typecheck` (`tsc --noEmit`): exit 0. Log: `/home/user/workspace/v2_3_mobile_236_p2_tsc_step1.log`.
- `npm run lint`: exit 0, 82 warnings / 0 errors (matches baseline). Log: `/home/user/workspace/v2_3_mobile_236_p2_lint_step1.log`.
- Targeted Jest (`useCommunityEvents` / `CoachCommunityEventsScreen`): exit 0, `useCommunityEvents.test.tsx` 9/9 passed (no dedicated `CoachCommunityEventsScreen` test file exists). Log: `/home/user/workspace/v2_3_mobile_236_p2_jest_step1.log`.

The P2 fix was committed as the title-only commit (no trailers): `fix(community): #236 v2-3 events cache-key + rebase onto main`.

## Step 2 — Rebase onto `origin/main` — DONE (UNION only)

- `git fetch origin main`, then `git rebase origin/main`.
- Exactly ONE conflict appeared, as expected: `src/config/featureFlags.ts` (UU). No other file conflicted (`git diff --name-only --diff-filter=U` listed only `featureFlags.ts`).
- Resolved via UNION ONLY: kept BOTH the v2-4 `communityAiTriage` flag row (from origin/main HEAD) AND the v2-3 `communityEvents` flag row (from the PR commit), in that order, with their full docblocks. No conflict markers remained; both flag rows present (`communityAiTriage` and `communityEvents:`).
- `git add src/config/featureFlags.ts` + `git rebase --continue`. Remaining 10 commits replayed with no further conflicts. `git status` clean afterward. `origin/main` confirmed an ancestor of the new HEAD.

## Step 3 — Full verification on rebased branch — PASS

- `npm ci` (post-rebase, lockfile unchanged in diff): exit 0. Log: `/home/user/workspace/v2_3_mobile_236_p2_npm_ci_rebased.log`.
- `npm run typecheck` (`tsc --noEmit`): exit 0. Log: `/home/user/workspace/v2_3_mobile_236_p2_tsc.log`.
- `npm run lint`: exit 0, 82 problems (0 errors, 82 warnings) — matches the audit baseline. Log: `/home/user/workspace/v2_3_mobile_236_p2_lint.log`.
- `npx jest --runInBand`: exit 0 — 219 suites passed, 2432 tests passed, 5 snapshots passed. Log: `/home/user/workspace/v2_3_mobile_236_p2_jest.log`.
- R0 grep battery on added lines (`git diff origin/main...HEAD`, +lines, 4348 lines): CLEAN for all actionable categories — no TODO/FIXME/XXX/HACK, no console.*, no debugger, no empty/swallowed catch, no `as any`, no placeholder copy. The single `as unknown as` hit is the already-classified P3 non-blocking test mock at `src/hooks/__tests__/useReducedMotion.test.tsx:49` (`as unknown as typeof AccessibilityInfo.addEventListener`), identical to the R2 audit baseline and outside the event-fixer code path. Artifact: `/home/user/workspace/v2_3_mobile_236_p2_grep_checks.txt`.

## Step 4 — Push + CI dispatch — DONE

- `git push --force-with-lease=feature/community-v2-events-mobile:e668a8e079710f78e47499a2463f9fe128e12f01 origin pr-236:feature/community-v2-events-mobile`: exit 0. Remote moved `e668a8e...dd4b72c` (forced update), guarded by the lease against the pre-fix SHA.
- CI dispatch: `gh api -X POST /repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches -f ref=feature/community-v2-events-mobile`: exit 0.

## Step 5 — Verify MERGEABLE/CLEAN — PASS

- CI runs completed `success`: workflow_dispatch run `27413067174` and pull_request run `27413065103`. The "Typecheck, lint, test" check shows `pass`.
- `gh pr view 236 --json headRefOid,mergeable,mergeStateStatus`:
  - `headRefOid`: `dd4b72c363a2d71f2717b24cc0ab22770af347f0`
  - `mergeable`: `MERGEABLE`
  - `mergeStateStatus`: `CLEAN`

## Commit

- Title-only commit (no trailers): `fix(community): #236 v2-3 events cache-key + rebase onto main`
- Author: Dynasia G <dynasia@trygrowthproject.com>
- SHA: `dd4b72c363a2d71f2717b24cc0ab22770af347f0`

## Artifacts

- `/home/user/workspace/v2_3_mobile_236_p2_npm_ci.log`
- `/home/user/workspace/v2_3_mobile_236_p2_tsc_step1.log`
- `/home/user/workspace/v2_3_mobile_236_p2_lint_step1.log`
- `/home/user/workspace/v2_3_mobile_236_p2_jest_step1.log`
- `/home/user/workspace/v2_3_mobile_236_p2_npm_ci_rebased.log`
- `/home/user/workspace/v2_3_mobile_236_p2_tsc.log`
- `/home/user/workspace/v2_3_mobile_236_p2_lint.log`
- `/home/user/workspace/v2_3_mobile_236_p2_jest.log`
- `/home/user/workspace/v2_3_mobile_236_p2_grep_checks.txt`

FIX COMPLETE: dd4b72c363a2d71f2717b24cc0ab22770af347f0
