# AUDIT — MWB-4 mobile autosave (PR #237 R3)

VERDICT: NOT CLEAN

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR HEAD audited: `1c63aa2735e687cc9673ca2093081e59f463f02b`  
Worktree: `/home/user/workspace/tgp/audit-mwb-4-237-r3-code`  
Base used: `origin/main` merge-base = `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`

Constraints followed: no browser_task, no github_mcp_direct. GitHub access used via `bash` with `api_credentials=["github"]` where applicable.

## Verification run

- HEAD check: PASS — `git log -1 --format=%H` returned `1c63aa2735e687cc9673ca2093081e59f463f02b`.
- CI: PASS — GitHub Actions run `27409069542` for head `1c63aa2735e687cc9673ca2093081e59f463f02b` is `completed/success`: https://github.com/BradleyGleavePortfolio/growth-project-mobile/actions/runs/27409069542
- Dependency install: PASS — `npm ci` completed. It reported existing dependency advisories/deprecation warnings; not treated as PR-blocking for this audit.
- Typecheck: PASS — `npm run typecheck` / `tsc --noEmit` exited 0.
- Changed-file lint: PASS WITH EXISTING WARNING — `npx eslint <12 changed files> --max-warnings=99999` exited 0 with one warning at `src/screens/coach/CoachWorkoutBuilderScreen.tsx:301` for the existing complex dependency-array expression.
- Targeted autosave tests: PASS — `npx jest --runInBand src/hooks/__tests__/useAutosave.test.tsx src/__tests__/coachWorkoutBuilderAutosave.test.tsx src/api/__tests__/workoutAutosaveApi.test.ts src/screens/coach/__tests__/workoutBuilderAutosaveDiff.test.ts` passed 4/4 suites, 52/52 tests.
- Full suite: PASS — `npx jest --ci --passWithNoTests --runInBand --silent` passed 213/213 suites, 2381/2381 tests, 5/5 snapshots. The pre-existing `Jest did not exit one second after the test run has completed` message still prints but exit code was 0, matching the D-011 carve-out.

## Prior R1/R2 finding closure

- R1 P0#1 (in-flight coalescing drops latest edit): CLOSED. The hook now separates `currentInFlightRef` from `pendingNextRef`, assigns distinct keys to new edits produced during an in-flight save, clears the mirror with `clearAutosaveMirrorIfKey`, and has a regression test for the second edit while in flight. Relevant code: `src/hooks/useAutosave.ts:243-248`, `src/hooks/useAutosave.ts:376-429`, `src/storage/autosaveMirror.ts:154-181`, `src/hooks/__tests__/useAutosave.test.tsx:541-615`.
- R1 P0#2 (first 409 drops unsaved edits): CLOSED for the bootstrap path. On conflict the hook adopts the conflict token/index, does not advance `lastSavedValueRef`, re-diffs the local working copy, re-mirrors, and re-sends. Relevant code/tests: `src/hooks/useAutosave.ts:442-476`, `src/hooks/__tests__/useAutosave.test.tsx:302-419`.
- R1 P1#3 (stale teardown flush): CLOSED. `flush` reads from `latestValueRef`, and unmount/background/beforeRemove call the stable flush. Relevant code/tests: `src/hooks/useAutosave.ts:237-241`, `src/hooks/useAutosave.ts:588-632`, `src/hooks/useAutosave.ts:720-744`, `src/hooks/__tests__/useAutosave.test.tsx:619-651`.
- R1 P1#4 (missing abort signals): CLOSED for already in-flight requests. The API accepts an AbortSignal, passes it to Axios, classifies cancellation as `aborted`, and the hook aborts an in-flight request on unmount while retaining the mirror. Relevant code/tests: `src/api/workoutAutosaveApi.ts:297-319`, `src/api/workoutAutosaveApi.ts:413-455`, `src/hooks/useAutosave.ts:388-402`, `src/hooks/useAutosave.ts:430-440`, `src/hooks/useAutosave.ts:736-740`, `src/hooks/__tests__/useAutosave.test.tsx:655-697`.
- R1 P1#5 (missing retry/backoff/reconnect): CLOSED. Bounded jittered backoff and NetInfo reconnect replay are implemented and tested. Relevant code/tests: `src/hooks/useAutosave.ts:103-118`, `src/hooks/useAutosave.ts:557-579`, `src/hooks/useAutosave.ts:663-680`, `src/hooks/__tests__/useAutosave.test.tsx:701-790`.
- R1 P2#6 (missing race/rollback tests): CLOSED. Targeted suites now cover the R1 race/409/unmount/abort/backoff/reconnect cases.
- R1 P2#7 (`as unknown as` in API test): CLOSED. The old double-cast is gone; current matches are comment-only false positives.
- CI handle cleanup: CLOSED. The final commit is test-only cleanup after R2 and CI is green at the required head.

## New blocking finding

### P1 — Autosaved inserted exercise rows do not reliably adopt server row IDs, so the next edit can duplicate the row and the next delete can be silently lost

A brand-new exercise row is intentionally created on-device without `row_id`; the screen maps that missing ID into the autosave working copy (`rowId: r.row_id`) and the diff emits `upsert_exercise` without `row_id`, which means “insert a new row” on the backend. See `src/screens/coach/CoachWorkoutBuilderScreen.tsx:153-169`, `src/screens/coach/CoachWorkoutBuilderScreen.tsx:214-228`, and `src/screens/coach/workoutBuilderAutosaveDiff.ts:141-146`.

After that insert autosave succeeds, the autosave response contains only `head_revision_index`, `lock_token`, and `saved_at`; it does not return the server-assigned exercise row IDs, and the screen does not pass `onSaved` to refetch/invalidate the plan after a 200. See `src/api/workoutAutosaveApi.ts:190-198`, `src/screens/coach/CoachWorkoutBuilderScreen.tsx:246-254`, and `src/hooks/useAutosave.ts:409-426`.

The only row-ID adoption path is a best-effort refetch after conflict plus a row re-baseline effect, but that effect is keyed only on `autosaveEnabled` and `existingPlan?.exercises.map((e) => e.id).join(',')`; it checks `autosave.hasPending` but omits it from the dependency array, so data that arrived while pending can be skipped and not applied when pending later clears. See `src/screens/coach/CoachWorkoutBuilderScreen.tsx:241-244` and `src/screens/coach/CoachWorkoutBuilderScreen.tsx:273-302`.

Impact: a normal coach flow can corrupt or drop edits. If the coach adds a new exercise and the autosave insert lands, the hook advances its diff baseline to a snapshot that still has `rowId: undefined` (`src/hooks/useAutosave.ts:411-416`). If the coach then edits that same row, `diffWorkingCopy` still treats it as brand-new and emits another no-`row_id` `upsert_exercise`, creating a duplicate (`src/screens/coach/workoutBuilderAutosaveDiff.ts:141-146`). If the coach deletes that row, the remove pass skips it because `prev.rowId` is falsy, so no `remove_exercise` is sent and the server row remains (`src/screens/coach/workoutBuilderAutosaveDiff.ts:170-176`). Reorder also cannot name the new row because id-less rows are filtered out of `row_ids` (`src/screens/coach/workoutBuilderAutosaveDiff.ts:179-195`).

Fix direction: after any successful autosave that inserted id-less rows, refetch/invalidate the plan and adopt server IDs before allowing subsequent row-level autosaves to diff against an id-less saved baseline. At minimum pass an `onSaved` handler that refetches when pending inserted rows existed, include `autosave.hasPending` (and the relevant refetch result identity) in the re-baseline dependencies, and add regression tests for add→autosave 200→edit/delete/reorder before explicit Save. A stronger contract fix would return created row IDs keyed by a client temp ID, avoiding a racey refetch dependency.

## R0 / 50-Failures / Bradley #36 / R69 sweep

- R0 added-line grep battery: PASS WITH FALSE POSITIVES. Matches were comment-only mentions of “no `as unknown as` / no `as any`”, the documented backend commit `25dbc790`, UTF-8 byte constants (`0x80`, `0x800`, `0xd800`, `0xdbff`), and comment text about the bootstrap placeholder lock token. No added executable unsafe cast, empty catch, `@ts-ignore`, `forceExit`, pictograph, or TODO/FIXME was found.
- Bradley Law #36: PASS. No empty catches found in changed source/tests; storage/API/hook failure paths log and/or surface state while preserving the mirror where required.
- R69 Prisma invariant: PASS. No Prisma/schema/SQL files are touched.
- 50-Failures sweep: NOT CLEAN because of the P1 data-integrity regression above. Other checked dimensions (feature flag dark behavior, schema strictness, idempotency key retention, 409 retry, offline mirror durability, abort threading, bounded retry, accessibility basics on the pill, and CI/test cleanup) did not produce additional P0/P1/P2 findings.

VERDICT: NOT CLEAN
