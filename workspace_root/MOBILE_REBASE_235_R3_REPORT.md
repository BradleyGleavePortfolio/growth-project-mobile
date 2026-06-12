# MOBILE REBASE REPORT — PR #235 (R3 / re-rebase, broader auth)

**Status:** COMPLETE
**Repo:** BradleyGleavePortfolio/growth-project-mobile
**PR:** #235
**Branch:** feature/community-v3-challenges-mobile
**Worktree:** /home/user/workspace/tgp/rebase-235-r3 (fresh clone)
**Rebaser:** Opus 4.8
**Authorization:** Operator decision D-037 (broadened UNION scope)
**Date:** 2026 R3

---

## Summary

The re-rebase of PR #235 onto `origin/main` (post-#236) **completed successfully**.
All 9 PR commits replayed onto the new main; conflicts in authorized zones were
resolved by UNION (keep both sides) per D-037. One additional TypeScript-blocking
merge artifact (a duplicate `featureFlags` import in `CommunityNavigator.tsx`,
authorized zone #5) was de-duplicated and folded into a single dedicated commit.

All verification gates passed. The branch was force-pushed with `--force-with-lease`,
CI workflow 265423898 was dispatched, and the PR now reports MERGEABLE / UNSTABLE
(UNSTABLE = pending CI from the dispatched run, as expected).

## SHAs

| Item | SHA |
|------|-----|
| PR #235 HEAD before (verified == brief) | `c0236b80b0fa223ce102206f1c6bd819f5d0ec32` |
| origin/main rebase target (verified == brief) | `e2d2e99ef2dfe4e03da22224fab9ff529fd49a44` |
| main tip commit | `e2d2e99 community: v2-3 event objects mobile (#236)` |
| **New rebased HEAD (pushed)** | **`6d4bed83ce712789b25242e8e4997269b26bc33f`** |

PR-235 replayed as **9 commits** + **1** conflict-resolution commit on top of main.

## Rebase progression

`git rebase origin/main` produced conflicts at two commits, both within
authorized zones; a post-rebase tsc error surfaced a third (also authorized).

### Commit 1/9 (`64d9a9e` → `21f50cf`) — featureFlags + .env.example UNION (authorized zones #1, #2)
- **`src/config/featureFlags.ts`** — UNION. Kept main's `communityEvents` (#236)
  flag row **and** PR-235's `communityChallenges` row, each with its own
  section-comment header. Conflict-marker scan after resolve: CLEAN.
- **`.env.example`** — UNION (env-var mirror). Kept both
  `EXPO_PUBLIC_FF_COMMUNITY_EVENTS=false` (#236) and
  `EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES=false` (PR-235).

### Commits 2/9 – 5/9 — applied cleanly (no conflicts).

### Commit 6/9 (`cad4058` → `bb0a7d0`) — CommunityTodayScreen handler UNION (authorized zone #3)
Single conflict in **`src/screens/community/CommunityTodayScreen.tsx`** (lines ~55–70),
exactly as predicted by the R2 blocked report:
- **main (#236) side** — `goToEvent(eventId)` handler gated on
  `featureFlags.communityEvents`, navigating to `CommunityEventDetail`.
- **PR-235 side** — `goToChallenge(challengeId)` handler gated on
  `featureFlags.communityChallenges`, navigating to `CommunityChallengeDetail`.

Both were inserted immediately after `goToHall` and shared a trailing
`} else { goToHall(); } };` block, causing the overlap. **Resolution (UNION per
the R2 recipe):** both functions now coexist adjacently, each with its own
comment block, flag guard, and its own complete `else { goToHall(); }` fallback.
Verified downstream JSX wiring: `goToEvent(data.event!.id)` (line 154) and
`goToChallenge(data.challenge!.id)` (line 168) are both rendered against their
own Today cards. Conflict-marker scan: CLEAN.

### Commits 7/9 – 9/9 — applied cleanly (no conflicts).

### Post-rebase: CommunityNavigator duplicate import (authorized zone #5)
`npx tsc --noEmit` reported `TS2300: Duplicate identifier 'featureFlags'` in
`src/navigation/CommunityNavigator.tsx`. Root cause: #236 and PR-235 each added an
`import { featureFlags } from '../config/featureFlags'` line at the same import
block; the auto-merge kept both. This is a mechanical merge artifact in an
authorized navigator zone. **Resolution:** removed the redundant second import;
both the flag-gated `CommunityEventDetail` (events) and
`CommunityChallenges`/`CommunityChallengeDetail` (challenges) route registrations
are retained (UNION). Folded into a single dedicated commit
(`6d4bed8 community(v3-1): de-duplicate featureFlags import …`).

No conflicts appeared outside the authorized zones. No business logic, API
clients, repository methods, state machines, or schema files were touched by any
resolution.

## Verification (all on new HEAD `6d4bed8`)

| Gate | Result |
|------|--------|
| `npm ci` | **exit 0** — 1101 packages, clean install |
| `npx tsc --noEmit` | **exit 0** — parallel-handler UNION + de-dup compile clean |
| `npm run lint` | **exit 0** — 82 warnings, **0 errors** (pre-existing baseline warnings across many files; the two `CommunityTodayScreen` warnings — unused `View` import L11, unused `embedded` arg L28 — are baseline, outside the resolved handler region) |
| `npx jest --runInBand` | **exit 0** — 225 suites / 2477 tests / 5 snapshots all pass. "Jest did not exit" message is the known baseline D-011 |
| R0 grep (added lines vs origin/main) | **CLEAN** — no swallowed catches, no TODO/FIXME, no console.* , no `any`-casts, no banned copy, no leftover conflict markers. The only `→`/`⇒` hits are typographic arrows inside code comments (documentation prose authored by PR-235), not emoji/pictographs or UI copy |

## Push / dispatch / PR state

- `git push --force-with-lease origin pr-235:feature/community-v3-challenges-mobile`
  → **success**: `c0236b8...6d4bed8 (forced update)`.
- `gh api -X POST .../actions/workflows/265423898/dispatches -f ref=feature/community-v3-challenges-mobile`
  → **exit 0** (workflow dispatched).
- `gh pr view 235 --json headRefOid,mergeable,mergeStateStatus`
  → `{"headRefOid":"6d4bed83ce712789b25242e8e4997269b26bc33f","mergeable":"MERGEABLE","mergeStateStatus":"UNSTABLE"}`
  — headRefOid matches the pushed HEAD; MERGEABLE with UNSTABLE (CI pending from
  the dispatched run), exactly as expected.

## Notes

- `node_modules` is tracked in this repo as a **symlink** (git mode 120000). `npm ci`
  replaces it with a real directory, which git reports as a deletion of the symlink
  blob. This is a pre-existing repo quirk, unrelated to PR-235; it was NOT staged or
  committed, and the pushed tree preserves the original tracked symlink.

---

REBASE COMPLETE: 6d4bed83ce712789b25242e8e4997269b26bc33f
