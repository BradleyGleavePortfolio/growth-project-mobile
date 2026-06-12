# MWB-4 #237 R4 Fixer Report — D-042

**Author:** Dynasia G <dynasia@trygrowthproject.com>
**Repo:** BradleyGleavePortfolio/growth-project-mobile
**Branch:** feature/mwb-4-mobile-autosave
**Base HEAD (before fix):** `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f`
**New HEAD (after fix, pushed):** `21ce3e01f753b9d48089f25df2b07f54c032262b`
**Commit message (title-only, no trailers, no co-author):**
`fix(mwb-4): #237 R4 autosave hasPending dirty signal + id-merge adoption (D-042)`

---

## 1. Defect (D-042) & Root Cause

`useAutosave.hasPending` was only set when `flush()` constructed a batch. The
value-change effect (formerly ~lines 705–721) merely armed an 800ms debounce
without flipping `hasPending`. In the gap between a coach's edit and the
debounce flush, the screen's post-insert adoption effect — gated on
`!hasPending` — clobbered the coach's local edits with refetched server data.

## 2. The Fix

### Part A — `src/hooks/useAutosave.ts` (+73 / −some)
- Added `const [_dirtyState, setDirtyState] = useState(false)` (state drives
  re-render; binding underscore-prefixed because reads go through the ref) and
  `const dirtyStateRef = useRef(false)` (read by the stable `computeHasPending`).
- Added stable `setDirty(next)` callback updating ref + state in lockstep,
  mount-guarded via `safeSet`.
- `computeHasPending` now ORs in `dirtyStateRef.current` alongside the two
  queue-slot refs.
- Value-change effect: when diff non-empty → `setDirty(true)` +
  `safeSet(setHasPending, computeHasPending())` BEFORE arming the debounce; when
  diff empty and not in-flight/queued → clears dirty.
- On 200 success (after `lastSavedValueRef.current = batch.snapshot`):
  `setDirty(diffRef.current(lastSavedValueRef.current, latestValueRef.current).length > 0)`
  to remain dirty if an edit landed in-flight.
- 409 null-rebase path: `setDirty(false)` when the refetch absorbed the ops.
- `rebaseline()`: `setDirty(false)` + recompute `hasPending` after anchoring
  the baseline.
- Added `setDirty` to `sendBatch`'s eslint-disabled dep list; added
  eslint-disable + deps to the value-change effect (the two `eslint-disable`
  lines are legitimate `react-hooks/exhaustive-deps` suppressions — NOT on the
  R0 banned list).

### Part B — `src/screens/coach/CoachWorkoutBuilderScreen.tsx` (+160 / −34)
- Added `refetchSeq` state + `refetchSeqRef`, `adoptedRefetchSeqRef`,
  `initialLoadDoneRef`.
- `onAutosaveSaved` / `onAutosaveConflict` bump `refetchSeqRef.current` +
  `setRefetchSeq()` before `refetchPlan()`.
- Rewrote the adoption effect, gated on
  `hasFreshRefetch = refetchSeq !== adoptedRefetchSeqRef.current` OR
  `!initialLoadDoneRef.current` (stops incidental renders from clobbering
  saved-but-unrefetched edits — the key regression).
  - `!hasPending` branch: full wholesale replace from server.
  - `hasPending` branch (the D-042 race): **id-only merge** — builds a FIFO
    pool of server row ids per `exercise_external_id`, reserves ids already held
    by local rows, assigns remaining ids to id-less local rows by external-id
    match, preserving ALL edited fields and order; returns the same ref when
    unmutated.
- Phase-2 rebaseline effect: removed the `if (autosave.hasPending) return` gate
  (relies on `rebaseline()`'s own in-flight/queued guard) so adoption-induced
  dirty cannot deadlock baseline advancement.

This merge-adoption is the audit's sanctioned alternative: "merge only
server-assigned row IDs into matching local rows without overwriting locally
edited fields/order." Pure hook-side blocking preserved edits but left rows
id-less, causing duplicate inserts.

## 3. Regression Tests — `src/__tests__/coachWorkoutBuilderRowIdAdoption.test.tsx` (+184)

- Made `mockRefetch` controllable via a module-level `deferRefetch` flag +
  `settleRefetch` callback (stashes `forceUpdate` instead of calling
  immediately); reset in `beforeEach`.
- New describe block "P1 row-ID adoption RACE (edit before refetch resolves)"
  with helper `addThenDeferRefetch()` and 3 tests: edit / delete / reorder the
  just-inserted row AFTER insert-200 (refetch dispatched) but BEFORE refetch
  settles, then settle → assert the local change is preserved + the subsequent
  autosave names `NEW_SERVER_ROW_ID`.
- Upsert op nests fields under `payload` (e.g. `upserts[0].payload?.sets`).

**Regression proof:** against the original unfixed HEAD code the edit + delete
race tests FAIL (edits clobbered); the reorder test happens to pass either way.
With the fix, all race tests pass.

## 4. Verification Gates — ALL PASS

| Gate | Command | Result |
|------|---------|--------|
| 1. Install | `npm ci` | exit 0 |
| 2. Typecheck | `npx tsc --noEmit` | exit 0 |
| 3. Lint | `npm run lint` | exit 0 — 0 errors, 83 pre-existing warnings; **none in changed files** |
| 4. Targeted | `npx jest --runInBand` (5 autosave suites) | **61/61 pass**, exit 0 |
| 5. Full (R66) | `npx jest --runInBand` | **2390/2390 pass, 214 suites**, exit 0 |
| 6. R0 grep (added lines) | banned-pattern battery | **CLEAN** (see below) |
| 7. Diff check | `git diff --check` | exit 0, clean |
| R70 fail-fast | 2 suites `--bail` | 24/24 pass, **3s**, exit 0 |

**R0 grep battery on 383 added lines — all CLEAN:** `as any`, `as unknown as`,
`@ts-ignore/@ts-nocheck/@ts-expect-error`, `forceExit`, `detectOpenHandles`,
`TODO/FIXME`, raw hex colors, `rgba()/rgb()`, empty catch. Only `eslint-disable`
hits are 2 legitimate `react-hooks/exhaustive-deps` lines (not banned).
**Bradley Law #36:** no catch blocks added — vacuously satisfied.

**R66 note (D-011 carve-out):** full jest prints "Jest did not exit one second
after the test run has completed" (open-handle warning). Exit code is **0** as
required; this is the documented benign carve-out.

## 5. Lint cleanup made during gate run

The initial lint surfaced one warning in a changed file:
`'dirtyState' is assigned a value but never used`. The state binding exists only
to drive re-renders (reads go through `dirtyStateRef`). Renamed the binding to
`_dirtyState` to satisfy the `no-unused-vars` allow-pattern `/^_/u` — no
eslint-disable added. Re-ran tsc (exit 0), lint (exit 0, changed files clean),
and the targeted suite (61/61) after the edit.

## 6. Commit & Push

- Committed on branch `feature/mwb-4-mobile-autosave` (not detached).
- Author + committer both `Dynasia G <dynasia@trygrowthproject.com>`.
- Message is a single title line — verified no body, no trailers, no co-author.
- `git push --force-with-lease` → exit 0; `50f0bf2..21ce3e0`.
- Confirmed `local HEAD == origin/feature/mwb-4-mobile-autosave == 21ce3e0...`.

## 7. ⚠️ CI Status — Infrastructure Outage (NOT a code failure)

CI workflow 265423898 was dispatched against the new SHA `21ce3e0` **three
times**; all three concluded `failure` in **6–7 seconds** — far too fast to have
run install/validate/lint/tsc/test (passing runs take ~470–496s).

**Evidence this is environmental, not my code:**
- Local reproduction of the **exact CI command set** all pass on `21ce3e0`:
  `npm run validate:config` (exit 0), `npm run lint --if-present` (exit 0),
  `npx tsc --noEmit` (exit 0), `npm test --if-present -- --ci --passWithNoTests`
  → **2390/2390 pass, exit 0** (note: CI runs tests WITHOUT the
  `EXPO_PUBLIC_FF_MWB_AUTOSAVE` flag — still all green).
- Cross-branch run history shows a clear outage window: **every** run created at
  or before 12:39 UTC succeeded (~470–496s); **every** run from ~12:56 UTC
  onward failed in 6–7s, across unrelated branches
  (`feature/community-v3-challenges-mobile` AND `feature/mwb-4-mobile-autosave`).
- The parent baseline `50f0bf2` itself passed at 12:03 (478s) before the outage.

Run history (workflow 265423898):
```
13:08:58 failure 7s  feature/mwb-4-mobile-autosave   (21ce3e0, mine)
13:01:25 failure 7s  feature/mwb-4-mobile-autosave   (21ce3e0, mine)
12:59:01 failure 6s  feature/community-v3-challenges  (unrelated)
12:57:18 failure 7s  feature/community-v3-challenges  (unrelated)
12:56:32 failure 6s  feature/community-v3-challenges  (unrelated)
12:39:44 success 491s main
12:30:5x success ~478s feat/roman-p1-mobile-chat
12:17:4x success ~483s feature/community-v3-challenges
12:03:37 success 478s feature/mwb-4-mobile-autosave  (50f0bf2 baseline)
```
(Plus a 4th dispatch at ~13:11 after a 90s wait: still 6s failure — outage
ongoing.)

The GitHub Actions proxy returns HTTP 404 on the jobs/logs endpoint for these
runs, so step-level logs are not retrievable to me. Repeatedly re-dispatching
during an active infra outage would be unproductive brute-forcing; I am
surfacing this to the parent agent to decide when to re-dispatch CI once the
runner infrastructure recovers.

**Bottom line:** the fix is complete and fully verified locally against the
identical CI command set. The remaining red CI is an infrastructure outage
affecting all branches, not a defect in `21ce3e0`. A re-dispatch after infra
recovery is expected to pass.

---

FIX COMPLETE: 21ce3e01f753b9d48089f25df2b07f54c032262b
