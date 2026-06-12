# FIXER BRIEF — MWB-4 #237 R5 fix (delete-before-adoption resurrection)

## Authority
- D-045: Track locally-deleted-pending-id rows in a Set; adoption effect filters server rows through it so resurrected rows are re-deleted (preserved as user intent).

## Worktree
- Path: `/home/user/workspace/tgp/fixer-mwb-4-237-r5`
- Branch: `feature/mwb-4-mobile-autosave` at HEAD `21ce3e01f753b9d48089f25df2b07f54c032262b`

## P1 — Delete-before-adoption race
Read full audit: `/home/user/workspace/MWB_4_237_R5_CODE_AUDIT_REPORT.md`

Specific scenario:
1. Add row A (no rowId yet).
2. Autosave insert succeeds (server returns id X), but local row A is not yet adopted.
3. Coach deletes row A locally.
4. The autosave diff returns `[]` because remove_exercise only emits for rows with rowId.
5. `hasPending` stays false.
6. Refetch from step 2's onAutosaveSaved resolves → adoption effect takes non-pending full-replace path → row A is RESURRECTED with id X.

## Fix direction (D-045 Option A)

Implement a `deletedKeysRef` Set tracking client-side row identifiers that have been removed but whose rowId may not have existed at delete time. The signature key should be a stable per-row `clientId` (generated when row is added locally; persists with the row).

If rows don't yet have a `clientId`:
- Add a `clientId: string` field to row data structure (uuidv4 on creation).
- This is an additive field — diff/api unaffected as long as it's filtered out of serialization OR clearly excluded from server payload.

Adoption effect changes (`CoachWorkoutBuilderScreen.tsx:374-395` non-pending full-replace path):
- When merging server rows into local state, drop any server row whose clientId is in `deletedKeysRef`.
- Server rows without a matching local clientId (i.e., new ones) are kept.
- After this filtered merge, schedule the new autosave cycle that will emit `remove_exercise` for the now-known rowId of the resurrected-then-re-deleted row.

Delete handler changes:
- On row removal (regardless of rowId presence), insert the row's `clientId` into `deletedKeysRef`.
- Cleanup: when an autosave succeeds and `remove_exercise` was sent for that rowId, remove the corresponding clientId from `deletedKeysRef`.

## Test plan
Add to `src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx`:
```
test('add row → autosave 200 (no adoption yet) → delete row before refetch → refetch resolves → row stays deleted + next autosave emits remove_exercise for server rowId')
```
The test must (1) add row → see autosave insert post 200 with server id X, (2) DO NOT settle refetch yet, (3) delete row locally, (4) settle refetch, (5) assert row is not in local state, (6) advance autosave debounce + flush → assert remove_exercise op was sent with rowId=X.

Add similar tests for double-delete and add-delete-add interleaving.

## Out of scope
- R4 issues (already fixed at this HEAD)
- R3 issues (already fixed)

## Constraints (same as R4 fixer)
- Author: Dynasia G <dynasia@trygrowthproject.com>
- Title-only commits, no trailers
- Model: Opus 4.8. Sonnet 4.6 FORBIDDEN.
- R0 grep clean on added lines
- Bradley Law #36 — no swallowed catches
- R66 full jest exit 0
- R70 fail-fast <30s before R66
- Use bash + gh + git with api_credentials=["github"]
- NO browser_task, NO github_mcp_direct
- R69 — NO schema changes

## Verification gates (all must pass before push)
1. npm ci exit 0
2. npx tsc --noEmit exit 0
3. npm run lint exit 0
4. Targeted: useAutosave.test.tsx + coachWorkoutBuilderAutosave.test.tsx + coachWorkoutBuilderRowIdAdoption.test.tsx + workoutAutosaveApi.test.ts + workoutBuilderAutosaveDiff.test.ts ALL pass
5. Full jest --runInBand exit 0
6. R0 grep clean

## Push
- `git push --force-with-lease origin feature/mwb-4-mobile-autosave`
- CI auto-dispatches on push (runner outage may still be active; local gates are SOURCE OF TRUTH)

## Report
`/home/user/workspace/MWB_4_237_R5_FIXER_REPORT.md`:
- New HEAD SHA
- Diff summary (deletedKeysRef + clientId field + adoption filter)
- Race-test evidence (added test cases passing)
- Gate evidence
- `FIX COMPLETE: <sha>` final line.
