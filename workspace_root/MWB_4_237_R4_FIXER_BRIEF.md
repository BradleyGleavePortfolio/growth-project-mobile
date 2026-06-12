# FIXER BRIEF — MWB-4 #237 R4 fix (autosave row-ID adoption race)

## Authority
- D-042: Set `hasPending=true` immediately on value-change effect in `useAutosave` (debounce armed, not yet flushed). Minimal surgical fix.

## Worktree (isolated)
- Path: `/home/user/workspace/tgp/fixer-mwb-4-237-r4`
- Branch: `feature/mwb-4-mobile-autosave` at HEAD `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f`
- Setup: `git worktree add` or `git clone`. Run `npm ci`.

## Repo
- `BradleyGleavePortfolio/growth-project-mobile`
- Use `gh` + `git` with `api_credentials=["github"]`. NO browser_task. NO github_mcp_direct.

## Required fix

### P1 — Row-ID adoption race (R4 code audit finding)
Reference: `/home/user/workspace/MWB_4_237_R4_CODE_AUDIT_REPORT.md`

**Root cause**: `useAutosave.hasPending` is only set when `flush()` builds a batch. The value-change effect at `src/hooks/useAutosave.ts:705-721` only arms an 800ms debounce — it does NOT set `hasPending=true`. So between value change and debounce flush, the screen's adoption effect sees `hasPending=false` and clobbers local edits with refetched server data.

**Fix direction**: In the value-change effect (`src/hooks/useAutosave.ts:705-721`), when a value diff is detected and the debounce is armed, immediately update the pending-state computation so that `hasPending` reflects "I have a dirty local change that hasn't been flushed yet."

Specific approach:
1. Identify how `hasPending` is computed/derived (likely from `latestValueRef !== lastSavedValueRef` plus in-flight/queued state).
2. Ensure the value-change effect triggers a state update so derived `hasPending` becomes true the moment user types, not only when flush runs.
3. This may mean: (a) adding a "dirty since last save" ref+state that's set on value change effect and cleared when send succeeds, OR (b) computing `hasPending` as `currentInFlightRef !== null || pendingNextRef !== null || latestValueRef.current !== lastSavedValueRef.current` and ensuring a re-render happens on value change. Choose the minimum-invasive path that integrates with existing hook architecture.

**Regression test**: Add to `src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx`:
```
test('add row → autosave 200 triggers refetch → coach edits same row before refetch resolves → edit is preserved after adoption', ...)
```
The test must (1) add row, (2) advance timers to flush autosave + see 200, (3) DO NOT advance refetch settle yet, (4) mutate the row field locally, (5) NOW settle the refetch, (6) assert local edit value is preserved and a subsequent autosave includes that edit with the server-assigned row id.

Add similar tests for `delete` and `reorder` if scope-feasible.

## Out of scope
- R3 UX P2 (stale-lock 'syncing' status) — already CLOSED per R4 audit.

## Constraints
- Author: `Dynasia G <dynasia@trygrowthproject.com>`
- Title-only commits, no trailers, no co-author lines.
- Model: Opus 4.8. Sonnet 4.6 FORBIDDEN.
- R0 grep battery clean on added lines.
- Bradley Law #36: no swallowed catches.
- R66: full `npx jest --runInBand` exit 0.
- R70: fail-fast lane <30s before R66.

## Verification gates (all must pass before push)
1. `npm ci` exit 0
2. `npx tsc --noEmit` exit 0
3. `npm run lint` exit 0
4. Targeted: `npx jest --runInBand src/hooks/__tests__/useAutosave.test.tsx src/__tests__/coachWorkoutBuilderAutosave.test.tsx src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx src/api/__tests__/workoutAutosaveApi.test.ts src/screens/coach/__tests__/workoutBuilderAutosaveDiff.test.ts` all pass
5. Full: `npx jest --runInBand` exit 0
6. R0 grep on added lines clean
7. `git diff --check origin/main...HEAD` clean

## Push + CI
- Force-push with lease.
- CI workflow 265423898 auto-dispatches on push.

## Report
Write `/home/user/workspace/MWB_4_237_R4_FIXER_REPORT.md`:
- New HEAD SHA
- Diff summary (esp. `useAutosave.ts` hasPending change)
- Race-test evidence (added test cases passing)
- All verification gates pass evidence
- `FIX COMPLETE: <sha>` on its own line at end
