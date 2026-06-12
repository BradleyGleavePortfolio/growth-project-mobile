VERDICT: NOT CLEAN

# MWB-4 PR #237 R5 Code Audit

Repo: `/home/user/workspace/tgp/audit-mwb-4-237-r5-code`  
Branch: `feature/mwb-4-mobile-autosave`  
HEAD verified: `21ce3e01f753b9d48089f25df2b07f54c032262b`

## Finding

### P1 — Delete-before-adoption can still be lost/resurrected because the D-042 dirty signal is op-diff based, and deleting a just-inserted id-less row produces no op

- `src/hooks/useAutosave.ts:749-769` marks the working copy dirty only when `diffRef.current(lastSavedValueRef.current, value)` returns at least one op. If the diff returns `[]`, `dirtyStateRef` is not flipped true.
- `src/screens/coach/workoutBuilderAutosaveDiff.ts:170-176` intentionally emits `remove_exercise` only for rows that already have a `rowId`; the comment at `src/screens/coach/workoutBuilderAutosaveDiff.ts:171-172` states that an id-less row removed before it has an id produces no op.
- Race trace that remains open:
  1. Coach adds row A; autosave insert succeeds while row A is still id-less locally.
  2. `sendBatch` advances `lastSavedValueRef.current` to the id-less insert snapshot at `src/hooks/useAutosave.ts:472-484`.
  3. `onAutosaveSaved` dispatches the post-insert refetch at `src/screens/coach/CoachWorkoutBuilderScreen.tsx:269-275`, but the screen has not adopted server id X yet.
  4. Coach deletes row A before that refetch resolves.
  5. The value-change effect at `src/hooks/useAutosave.ts:749-769` computes diff from “id-less row A exists” to “row A missing”; `diffWorkingCopy` emits `[]` because the deleted row has no `rowId` (`src/screens/coach/workoutBuilderAutosaveDiff.ts:170-176`).
  6. Because `ops.length === 0`, `hasPending` can remain false for this local deletion.
  7. When the refetch resolves, the adoption effect takes the non-pending full-replace path at `src/screens/coach/CoachWorkoutBuilderScreen.tsx:374-395`, replacing local rows with server truth and resurrecting row A with id X instead of preserving the delete and emitting `remove_exercise`.

Impact: user intent to delete a just-inserted exercise in the adoption window can be lost, and the row can reappear from the post-insert refetch. This is data-integrity severity for the same row-ID adoption window as R4.

Why existing tests did not close it: the added race tests exist for edit/delete/reorder in `src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx:417-574`, but the delete case does not prove the stable post-200/hasPending-false window. The static diff path above shows the delete is not representable once the inserted row is still id-less locally but already saved on the server.

## Checklist results

1. R0 grep battery on added lines: completed; evidence saved to `/home/user/workspace/pr237_grep_sweep.txt` and `/home/user/workspace/pr237_added_lines.tsv`.
2. Bradley Law #36 swallowed catches: no newly added swallowed catch found; added catches rethrow, log, or deliberately return after visible logging.
3. R69 schema diff: no migration/schema file changes found; mobile N/A.
4. R31 distinct builder/fixer/auditor: auditor is distinct for this R5 pass; commits are by the fixer branch author.
5. R4 race trace: edit/reorder path improved by D-042 (`useAutosave.ts:749-769`) and merge adoption (`CoachWorkoutBuilderScreen.tsx:397-444`), but delete-before-adoption remains open as the P1 above.
6. Regression tests: add/edit/delete/reorder tests exist (`coachWorkoutBuilderRowIdAdoption.test.tsx:321-574`), but delete coverage misses the op-empty delete window.
7. R66 Jest: focused changed autosave suites passed (`/home/user/workspace/pr237_r5_jest_autosave_suites.log`, 54/54) and focused row-ID adoption suite passed; full `npx jest --runInBand` did not complete cleanly in this shared workspace (first attempt hit the 600s tool limit without a summary; second quiet attempt exited 228 with an empty log while the filesystem was 98% full). Treating the code finding above as decisive.
8. R65 50-failures sweep on added lines: completed via grep battery; no additional P0/P1/P2 found beyond this delete-adoption P1.
9. New P0/P1/P2: one P1 found.
10. R3 UX P2 stale-lock syncing status: intact. Bootstrap stale-lock maps to `syncing`/silent recovery in `src/hooks/useAutosave.ts:526-537`, and the pill renders neutral “Syncing latest version…” at `src/components/workout/AutosaveStatusPill.tsx:155-168`.

VERDICT: NOT CLEAN
