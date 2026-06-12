# MWB-4 #237 R5 — Fixer Report (D-045: delete-before-adoption row resurrection)

**Repo:** `BradleyGleavePortfolio/growth-project-mobile`
**Branch:** `feature/mwb-4-mobile-autosave`
**Base HEAD (before fix):** `21ce3e01f753b9d48089f25df2b07f54c032262b`
**New HEAD SHA:** `85760165dd9e99680924b0a59ef1adb09339d346`
**Author:** Dynasia G <dynasia@trygrowthproject.com> (title-only commit, no trailers)
**Model:** Opus 4.8
**Pushed:** `git push --force-with-lease origin feature/mwb-4-mobile-autosave` → `21ce3e0..8576016`, exit 0. Remote ref confirmed at `85760165dd9e99680924b0a59ef1adb09339d346`.

---

## 1. The Bug (D-045)

An id-less row is added in the coach workout builder → autosave POST returns 200 and **advances the diff baseline** → the coach **deletes the row before the post-insert refetch resolves**. Because `remove_exercise` requires a server `row_id` (which the row does not yet have), the diff over the now-id-less working copy produces `[]`, so `hasPending` stays `false`. When the refetch resolves, the **non-pending full-replace adoption path** (`CoachWorkoutBuilderScreen.tsx`) rebuilds local rows from server truth and **resurrects the just-deleted row**.

**Fix mechanism for re-emitting the delete:** the diff module (`workoutBuilderAutosaveDiff.ts`, unchanged) emits `remove_exercise` only when a row carrying a `row_id` is present in the baseline (`lastSavedValueRef`) but absent from the working copy. So after we drop the resurrected row from local rows, we anchor the baseline to the *full* server copy via `rebaselineTo(fullServerCopy)` — putting the resurrected row's `row_id` into the baseline while local rows exclude it. The next value-change diff then emits `remove_exercise` for that `row_id`, re-deleting it on the server. **No schema change (R69)** — `clientId` is a client-only field never serialized into the op diff or the PUT replace-all payload.

---

## 2. Diff Summary

```
 src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx | 196 ++++++++++++++++++
 src/hooks/useAutosave.ts                                |  47 ++++-
 src/screens/coach/CoachWorkoutBuilderScreen.tsx         | 227 +++++++++++++++++-
 src/utils/clientId.ts                                   |  63 ++++++
 4 files changed, 523 insertions(+), 10 deletions(-)
```

### `src/utils/clientId.ts` (NEW, 63 lines) — the `clientId` field source
- `generateClientId()`: crypto-grade v4 UUID via `crypto.getRandomValues` (Web Crypto, polyfilled for RN/Hermes by `react-native-get-random-values`), mirroring `src/utils/idempotency.ts` so there is one crypto code path across dev/Expo Go/release.
- Documented as a **CLIENT-ONLY** field — never serialized into the autosave op diff or the explicit-Save PUT payload, so the wire contract and DB schema are unchanged (R69).
- No `eslint-disable` (verified `no-bitwise` not enforced).

### `src/hooks/useAutosave.ts` (+47) — `rebaselineTo` re-anchor
- `UseAutosaveResult<TWorkingCopy = unknown>` made generic; hook returns `UseAutosaveResult<TWorkingCopy>`.
- Added `rebaselineTo(serverCopy: TWorkingCopy)`: anchors the diff baseline to an **explicit server copy** (unlike `rebaseline`, which uses the current working copy), recomputing dirty so the next diff emits `remove_exercise`. **Refuses to run mid-flight** so a genuine pending batch is never discarded.
- Added to the `useMemo` return and dependency array.

### `src/screens/coach/CoachWorkoutBuilderScreen.tsx` (+227) — `deletedKeysRef` + adoption filter + `clientId` field
- **`clientId: string`** added to `DraftExerciseRow` (client-only, never serialized).
- Module-level helpers `rowCompositeSignature()` / `serverRowCompositeSignature()`: `JSON.stringify` of server-facing fields, **excluding order** (a resurrected row may land at a different index).
- Refs:
  - **`rowIdToClientIdRef`** — `Map<serverRowId, clientId>` (identity survives refetch/adoption).
  - **`deletedKeysRef`** — `Set<clientId>` of rows the coach removed.
  - **`deletedSignaturesRef`** — `Map<signature, clientId[]>` (FIFO), the only way to recognise a resurrected row that has no previously-seen `row_id`.
- `clientIdForServerRow()` reuses the minted clientId for a known `row_id` or mints a fresh one.
- `addExercise` mints a `clientId` at creation.
- `removeRow` records the removed row's `clientId` into `deletedKeysRef` **and** indexes it by composite signature into `deletedSignaturesRef` — regardless of whether the row has a `row_id` yet.
- **Non-pending full-replace adoption path** now:
  1. Filters server rows, **dropping resurrected-deleted rows** matched two ways: (1) a server `row_id` already mapped to a `clientId` now in `deletedKeysRef`, or (2) a never-seen `row_id` whose **composite signature** matches a pending deleted signature (consuming one FIFO entry per match).
  2. Sets local rows to the kept rows.
  3. **Cleanup (step 6):** prunes `deletedKeysRef` entries whose mapped `row_id` is no longer in server truth (the remove has been confirmed).
  4. If any rows were dropped, calls `autosaveRebaselineTo(buildServerWorkingCopy(serverExercises))` so the next diff emits `remove_exercise` for each dropped `row_id`.
- Merge (pending) path binds the adopted `row_id` → `clientId`.
- Added `buildServerWorkingCopy` (`useCallback`): server-facing working copy carrying only server fields + `row_id`.
- Imported `generateClientId` and the `WorkoutPlanExercise` type.

---

## 3. Race-Test Evidence

New describe block **"CoachWorkoutBuilderScreen — D-045 delete-before-adoption (op-empty window)"** in `src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx`, using the `deferRefetch`/`settleRefetch` harness, `mockServerPlan`, `NEW_SERVER_ROW_ID` = `bbbbbbbb-…`, flag `EXPO_PUBLIC_FF_MWB_AUTOSAVE=true`. All 3 new tests pass (plus 7 pre-existing adoption tests = 10/10):

```
✓ add -> insert 200 -> delete id-less row -> settle refetch: row stays deleted
  AND next autosave emits remove_exercise for the server id (43 ms)
✓ double-delete: deleting the id-less row TWICE across two refetch settles stays
  deleted (no resurrection, idempotent remove) (44 ms)
✓ add-delete-add interleaving: re-adding the SAME exercise after a
  delete-before-adoption keeps the new row (only the deleted one is dropped) (45 ms)
```

Full adoption suite (`r5_jest_adoption.log`): **Test Suites: 1 passed; Tests: 10 passed.**

---

## 4. Verification Gate Evidence (all logs in `/home/user/workspace/`)

| # | Gate | Result | Log |
|---|------|--------|-----|
| 1 | `npm ci` | **exit 0** — added 1101 packages in 24s (cache `.npmcache-235`) | `r5_npm_ci.log` |
| 2 | `tsc --noEmit` | **exit 0** — clean, no errors | `r5_tsc_3.log` |
| 3 | lint (`eslint src/**/*.{ts,tsx}`) | **exit 0** — 82 problems (**0 errors**, 82 pre-existing warnings; none in changed files) | `r5_lint2.log` |
| 4 | Targeted 5 suites | **5 passed / 64 tests passed** (useAutosave, coachWorkoutBuilderAutosave, coachWorkoutBuilderRowIdAdoption, workoutAutosaveApi, workoutBuilderAutosaveDiff) | `r5_jest_targeted5.log` |
| 5 | Full `jest --runInBand` | **exit 0** — 214 suites, **2393 tests passed** (benign "Jest did not exit" open-handles warning only) | `r5_jest_full.log` |
| 6 | R0 grep sweep (523 added lines) | **ALL CLEAN** — no swallowed catch, eslint-disable, ts-ignore, console, TODO/FIXME/HACK, only/skip, as any/unknown, any type, eval, debugger | `r5_r0_grep_sweep.txt` |

**Constraint compliance:**
- **R0 grep clean** on added lines ✓
- **Bradley Law #36** (no swallowed catches) ✓ — R0 sweep `swallowed_empty_catch: CLEAN`
- **R66** full jest exit 0 ✓
- **R69** NO schema changes ✓ — `clientId` is client-only, never serialized; diff/PUT payloads unchanged
- Title-only commit, no trailers ✓
- Author Dynasia G <dynasia@trygrowthproject.com> ✓
- Tooling: bash + gh + git with `api_credentials=["github"]`; no browser_task, no github_mcp_direct ✓

---

## 5. CI Note

CI auto-dispatched on push. Recent runs on this branch show fast (6–7s) `workflow_dispatch` failures consistent with the **known runner outage** flagged in the brief. **Local is the source of truth** — all 6 gates pass locally as evidenced above.

---

FIX COMPLETE: 85760165dd9e99680924b0a59ef1adb09339d346
