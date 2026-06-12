# AUDIT — MWB-4 mobile autosave (PR #237 R4)

VERDICT: NOT CLEAN

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR HEAD audited: `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f`  
Worktree: `/home/user/workspace/tgp/audit-mwb-4-237-r4-code`  
Base used: `origin/main` merge-base / diff base as fetched in the worktree.

Constraints followed: no browser_task, no github_mcp_direct. GitHub access used via `bash` with `api_credentials=["github"]` where applicable. No product-code changes were made.

## Verification run

- HEAD check: PASS — `git log -1 --format=%H` returned `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f`.
- CI: PASS — GitHub Actions run `27414459135` for head `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f` is `completed/success`: https://github.com/BradleyGleavePortfolio/growth-project-mobile/actions/runs/27414459135
- Dependency install: PASS — `npm ci` completed. It reported existing dependency advisories/deprecation warnings; not treated as PR-blocking for this audit.
- Typecheck: PASS — `npm run typecheck` / `tsc --noEmit` exited 0.
- Changed-file lint: PASS — `npx eslint <changed ts/tsx files> --max-warnings=99999` exited 0.
- Targeted autosave tests: PASS — `npx jest --runInBand src/hooks/__tests__/useAutosave.test.tsx src/__tests__/coachWorkoutBuilderAutosave.test.tsx src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx src/api/__tests__/workoutAutosaveApi.test.ts src/screens/coach/__tests__/workoutBuilderAutosaveDiff.test.ts` passed 5/5 suites, 58/58 tests.
- Full suite: PASS — `npx jest --ci --passWithNoTests --runInBand --silent` passed 214/214 suites, 2387/2387 tests, 5/5 snapshots. The known `Jest did not exit one second after the test run has completed` message still prints but exit code was 0, matching the prior D-011 carve-out.
- `git diff --check origin/main...HEAD`: PASS.

## Required R3 finding closure check

### R3 Code P1 — row-ID adoption after autosaved id-less insert

Status: PARTIAL / NOT CLOSED. The combined fixer added the requested minimum pieces, but the row-ID adoption path can still overwrite a coach's next unsaved edit made in the normal debounce window after the insert autosave 200 and before the refetch/adoption effect lands.

Verified implemented pieces:

- `useAutosave` now exposes `onSaved` and `rebaseline()`. The hook calls `onSavedRef.current?.(...)` after a successful 200 (`src/hooks/useAutosave.ts:455-459`) and returns `rebaseline` in the hook result (`src/hooks/useAutosave.ts:817-827`). `rebaseline()` refuses to run when `currentInFlightRef` or `pendingNextRef` is non-null, then anchors `lastSavedValueRef` to `latestValueRef` (`src/hooks/useAutosave.ts:697-703`).
- `CoachWorkoutBuilderScreen` wires `onAutosaveSaved` to `refetchPlan()` only when the current working copy has id-less rows (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:238-256`), satisfying the only-if-pending/idless-row refetch guard for pure metadata saves.
- `CoachWorkoutBuilderScreen` implements a two-phase adopt-then-rebaseline flow: a first effect replaces local rows from `existingPlan.exercises` when `!autosave.hasPending` and records `pendingRebaselineSigRef` (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:321-351`), then a second effect waits until `localRowSignature` matches and calls `autosaveRebaseline()` (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:353-376`).
- Four new row-ID regression tests exist and cover add→autosave 200→edit, add→autosave 200→delete, add→autosave 200→reorder, and metadata-only no-refetch (`src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx:307-389`).

Blocking gap found:

### P1 — Post-insert refetch adoption can clobber a follow-up edit made before the debounce flush marks `hasPending`

After the id-less insert autosave succeeds, `sendBatch` advances the saved baseline to `batch.snapshot`, calls `onSaved`, and then recomputes pending state (`src/hooks/useAutosave.ts:433-460`). The screen's `onAutosaveSaved` immediately starts `refetchPlan()` when `hasIdlessRowsRef.current` is true (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:252-256`).

A coach can then edit the just-inserted row before that refetch resolves. This is a normal UI path: row fields remain enabled and editable (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:548-599`, `src/screens/coach/CoachWorkoutBuilderScreen.tsx:661-689`). However, `useAutosave.hasPending` is not set when a value becomes dirty; it is only set when `flush()` builds/writes/sends a batch (`src/hooks/useAutosave.ts:641-683`) or when replay/queue paths run. The value-change effect merely arms an 800ms debounce and does not set `hasPending` (`src/hooks/useAutosave.ts:705-721`).

If the refetch result lands inside that debounce window, the adoption effect sees `autosave.hasPending === false` and unconditionally replaces the local `rows` array from `existingPlan.exercises` (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:331-350`). That overwrites the coach's just-entered row change with the refetched server version, typically the value from the first insert save, before the debounced autosave has a chance to send it.

Impact: a routine add→autosave 200→immediate edit sequence can lose the immediate edit. This is a data-integrity failure in the same row-ID adoption area as the R3 P1: the fix avoids duplicate/no-id follow-up ops after adoption has fully settled, but it does not preserve edits made while adoption is in flight and before `hasPending` flips true.

Why the new tests miss it: `addAndAdopt()` waits for the refetch and then advances timers to let adoption/rebaseline settle before performing the follow-up edit (`src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx:284-304`). The tests therefore cover only add→adopt→edit/delete/reorder, not add→200→edit while the adoption refetch is still outstanding.

Required fix direction: adoption must be gated on a real dirty/unsaved-local-change signal, not only on in-flight/queued `hasPending`, or it must merge only server-assigned row IDs into matching local rows without overwriting locally edited fields/order. A regression should cover: add row → autosave 200 triggers refetch → before refetch resolves, edit/delete/reorder the same row → refetch resolves → local edit/delete/reorder is preserved and the subsequent autosave names the adopted server row ID.

## R3 UX P2 closure check

Status: CLOSED.

- `useAutosave` now distinguishes the bootstrap stale-lock 409 from real conflicts. For `err.conflict?.error === 'autosave_lock_stale' && !hasSavedRef.current`, it sets `status='syncing'` and skips `onConflict`; `autosave_conflict_retry` and stale-lock after a successful save still surface as `conflict` and call `onConflict` (`src/hooks/useAutosave.ts:475-528`).
- `AutosaveStatus` includes `syncing` (`src/hooks/useAutosave.ts:90-96`).
- `AutosaveStatusPill` maps `syncing` to neutral, non-interactive copy `Syncing latest version…`, uses `semantic.info`, and marks the state busy without making it actionable (`src/components/workout/AutosaveStatusPill.tsx:155-168`, `src/components/workout/AutosaveStatusPill.tsx:236-265`).
- Regression tests cover bootstrap stale-lock not surfacing conflict and post-save stale-lock surfacing as a real conflict (`src/hooks/__tests__/useAutosave.test.tsx:362-468`).

## R0 / 50-Failures / Bradley #36 / R69 sweep

- R0 added-line grep battery: REVIEWED. Matches were test-only `no-var-requires` suppressions, hook `react-hooks/exhaustive-deps` suppressions, comments mentioning banned patterns, and UTF-8 byte constants. No added executable `as any`, `as unknown as`, `@ts-ignore`, `forceExit`, `detectOpenHandles`, TODO/FIXME, raw component hex/rgba styling, or empty catch was found.
- Bradley Law #36: PASS. No empty catches found in changed source/tests; failure paths log and/or surface state while preserving the mirror where required.
- R69 Prisma invariant: PASS. No Prisma/schema/SQL/migration files are touched.
- 50-Failures sweep: NOT CLEAN because of the P1 row-ID adoption/data-integrity race above. Other checked dimensions — feature flag dark behavior, schema strictness, idempotency key retention, 409 retry, offline mirror durability, abort threading, bounded retry, status-pill accessibility/token usage, and CI/test cleanup — did not produce additional P0/P1/P2 findings.

## Verdict

The fixer closed the explicit stale-lock UX P2 and implemented the intended row-ID adoption scaffold, but the adoption effect is still unsafe because it can overwrite a coach's local follow-up edit while the post-insert refetch is in flight and before autosave `hasPending` becomes true.

VERDICT: NOT CLEAN
