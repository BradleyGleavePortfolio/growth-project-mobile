# MWB-4 #237 R3 Combined Fixer — Report

**Repo:** `BradleyGleavePortfolio/growth-project-mobile`
**PR:** #237 (`feature/mwb-4-mobile-autosave`)
**Role:** FIXER (Opus 4.8) — no browser_task, no github_mcp_direct; GitHub via `api_credentials=["github"]`
**Author:** Dynasia G <dynasia@trygrowthproject.com>
**Base PR HEAD (verified):** `1c63aa2735e687cc9673ca2093081e59f463f02b`
**New commit (pushed):** `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f`

---

## Findings Closed

### P1 — Data integrity: row-ID adoption on autosave insert
A brand-new exercise row inserts via an id-less `upsert_exercise`. The autosave 200 response carries only `head_revision_index` / `lock_token` / `saved_at` — **not** the new server row id (confirmed via `AutosaveResponseSchema` in `workoutAutosaveApi.ts`). Without adoption, the hook's `lastSavedValueRef` baseline advanced to the id-less snapshot, so the next edit/delete/reorder of that same row re-diffed as brand-new:
- edit → a SECOND id-less upsert (duplicate insert),
- delete → no `remove_exercise` (falsy row_id skipped),
- reorder → row could not be named (id-less rows filtered out).

**Fix (minimum-viable refetch path — backend `client_temp_id → row_id` contract NOT in scope per brief):**
- `useAutosave` gains an `onSaved` callback and a new `rebaseline()` method (refuses to run mid-flight / with pending edits, then re-anchors `lastSavedValueRef` to the latest value).
- `CoachWorkoutBuilderScreen` wires `onAutosaveSaved` → `refetchPlan()` only when id-less rows exist (`hasIdlessRowsRef`); a two-phase effect adopts the server-assigned row id into local rows (signature-matched), then a follow-up effect calls `rebaseline()` once the working copy reflects the adopted rows and pending has cleared.
- Re-baseline effect deps now `[autosaveEnabled, autosave.hasPending, existingPlan, serverRowSignature]` (eslint-disable removed; complex dep folded into a `useMemo`).

### P2 — UX: stale-lock bootstrap
First-ever autosave can 409 with `autosave_lock_stale` during lock bootstrap. Previously this surfaced a "conflict" to the coach (alarming, wrong).

**Fix:**
- `useAutosave` 409 branch distinguishes `autosave_lock_stale` **with no prior successful save** (`!hasSavedRef.current`) → silent retry, new `'syncing'` status, `onConflict` NOT fired. A real conflict (`autosave_conflict_retry`, or `autosave_lock_stale` after a successful save) → `onConflict` + `'conflict'` status.
- New `'syncing'` status added to `AutosaveStatus` union.
- `AutosaveStatusPill` maps `'syncing'` → neutral copy "Syncing latest version…", `sync-outline` icon, `semantic.info` triad (calm, not warning), `interactive: false`, `accessibilityState.busy = saving || syncing`.

---

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx eslint --max-warnings=99999` (5 changed files) | **exit 0**, 0 warnings |
| Targeted jest (useAutosave + coachWorkoutBuilderAutosave + new row-ID adoption) | **24 passed**, exit 0 |
| New P1 suite `coachWorkoutBuilderRowIdAdoption.test.tsx` | **4 passed** |
| Full `npx jest --ci --passWithNoTests --runInBand --silent` | **214 suites / 2387 tests passed, exit 0** |

Full-suite baseline was 213 suites / 2381 tests; this R3 adds 1 new suite (+4 P1 tests) and +2 P2 tests in `useAutosave.test.tsx`, consistent with 214 / 2387. The "Jest did not exit one second after the test run has completed" message is the known D-011 carve-out — **exit code is 0**, with no `--forceExit` and no `--detectOpenHandles` masking.

### Constraints honored
- **R0 hectacorn:** R3 diff grep clean — no `as any`, no `as unknown as`, no `@ts-ignore`, no `forceExit`, no `detectOpenHandles`, no `TODO`/`FIXME`, no emoji/pictographs, no raw hex/rgba in components. (The only grep hits are doc-comment text literally naming the banned patterns and a pre-existing UTF-8 surrogate-pair byte-length test — false positives outside R3 changes.)
- **Bradley #36 (zero swallowed catches, incl. tests):** all catch blocks have meaningful bodies; no empty catches added.
- **R69 (no schema diff):** no Prisma/SQL changes.
- **R66:** full `jest --runInBand` exits 0.
- **R70:** fail-fast lane respected; no `forceExit`.
- No `as any` / `as unknown as` in runtime code; `'syncing'` mapping uses `semantic.info` tokens (bg #E8F4FD, fg #1E4971, border #93C5DC) from `tokens.ts`, not raw hex.

---

## Files Changed (R3 commit `50f0bf2`)
1. `src/hooks/useAutosave.ts` — `'syncing'` status; `hasSavedRef`; bootstrap-stale-lock vs real-conflict 409 branch; `rebaseline()` method.
2. `src/components/workout/AutosaveStatusPill.tsx` — `'syncing'` neutral copy + `semantic.info` + a11y busy.
3. `src/screens/coach/CoachWorkoutBuilderScreen.tsx` — `onAutosaveSaved` refetch on id-less rows; two-phase adopt + rebaseline; re-baseline deps incl. `autosave.hasPending`.
4. `src/hooks/__tests__/useAutosave.test.tsx` — first-409 test → real conflict; +2 P2 tests (bootstrap stale-lock never surfaces conflict; post-save stale-lock = real conflict).
5. `src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx` (NEW) — 4 P1 integration tests (add→200→edit single upsert WITH row_id; add→200→delete remove_exercise; add→200→reorder names adopted id; metadata-only save = no refetch).

`5 files changed, 698 insertions(+), 29 deletions(-)`

---

## Push & CI
- **Push:** `git push --force-with-lease=feature/mwb-4-mobile-autosave:1c63aa2... origin HEAD:feature/mwb-4-mobile-autosave` → `1c63aa2..50f0bf2`, exit 0.
- **Workflow dispatch:** `POST /repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches -f ref=feature/mwb-4-mobile-autosave` → 204, exit 0.
- **CI run:** `27414459135` — status `in_progress`, event `workflow_dispatch`, head_sha `50f0bf2`.

---

FIX COMPLETE: 50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f
