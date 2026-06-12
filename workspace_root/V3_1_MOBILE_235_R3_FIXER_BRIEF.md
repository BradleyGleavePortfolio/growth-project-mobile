# FIXER BRIEF — v3-1 mobile #235 R3 combined fix (UX P1 listitem + P2 node_modules)

## Authority
- D-041: Use W3C `role="listitem"` (lowercase prop) on row wrappers, matching EventCard precedent (`src/components/community/EventCard.tsx:115-119`). This REVERSES D-032 narrowly.
- D-040: Backend pagination enforcement is deferred to follow-up backend PR B-PAG-1. NOT in scope here.

## Worktree (isolated)
- Path: `/home/user/workspace/tgp/fixer-v3-1-mobile-235-r3`
- Branch: `feature/community-v3-challenges-mobile` at HEAD `6d4bed83ce712789b25242e8e4997269b26bc33f`
- Setup: `git worktree add` from `/tmp/tgp-agent-context-mobile` if available, else `git clone`. Run `npm ci`.

## Repo
- `BradleyGleavePortfolio/growth-project-mobile`
- Use `gh` + `git` with `api_credentials=["github"]`. NO browser_task. NO github_mcp_direct.

## Required fixes

### FIX 1 — UX P1: row-level `role="listitem"` semantics
Add `role="listitem"` (lowercase W3C prop, the new RN >= 0.83 union) to row wrappers:
1. `src/screens/community/CommunityChallengesScreen.tsx:187-200` — challenge discovery row wrapper
2. `src/screens/community/CommunityChallengeDetailScreen.tsx:467-475` — comment row wrapper
3. `src/screens/community/CommunityChallengeDetailScreen.tsx:499-510` — leaderboard row wrapper

DO NOT change inner button roles. Keep parent container's `accessibilityRole="list"` (or you may also add `role="list"` — but listitem on rows is the critical missing piece).

Regression test: add jest snapshot or role-query assertion to existing test files that the row wrapper has `role="listitem"`. E.g. `src/screens/community/__tests__/CommunityChallengeDetailScreen.test.tsx` and `src/screens/community/__tests__/CommunityChallengesScreen.test.tsx`.

### FIX 2 — P2: tracked `node_modules` symlink
Remove the tracked symlink:
```
git rm node_modules
```
The PR commit `07054ef6` added it. Make sure `.gitignore` includes `/node_modules` (it should already; verify).

## Constraints
- Author: `Dynasia G <dynasia@trygrowthproject.com>`
- Title-only commits, no trailers, no co-author lines.
- Model: Opus 4.8. Sonnet 4.6 FORBIDDEN.
- R0 grep battery clean on added lines (incl. comments).
- Bradley Law #36: no swallowed catches.
- R66: full `npx jest --runInBand` exit 0 (D-011 "Jest did not exit" message OK).
- R70: fail-fast lane <30s (typecheck + changed-file lint + targeted tests) before R66.

## Verification gates (all must pass before push)
1. `npm ci` exit 0
2. `npx tsc --noEmit` exit 0
3. `npm run lint` exit 0
4. Targeted: `npx jest --runInBand src/screens/community/__tests__/CommunityChallengeDetailScreen.test.tsx src/screens/community/__tests__/CommunityChallengesScreen.test.tsx`
5. Full: `npx jest --runInBand` exit 0
6. R0 grep on added lines clean
7. `git diff --check origin/main...HEAD` clean

## Push + CI
- Force-push with lease: `git push --force-with-lease origin feature/community-v3-challenges-mobile`
- Dispatch CI: `gh api -X POST repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches -f ref=feature/community-v3-challenges-mobile` (only if not auto-dispatched on push)

## Report
Write `/home/user/workspace/V3_1_MOBILE_235_R3_FIXER_REPORT.md`:
- New HEAD SHA
- Diff summary
- All verification gates pass evidence
- `FIX COMPLETE: <sha>` on its own line at end
