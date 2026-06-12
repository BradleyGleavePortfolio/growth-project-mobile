# MWB-4 #237 — CI Handle Cleanup Report (FIXER, Opus 4.8)

**PR:** #237 (`feature/mwb-4-mobile-autosave` → `main`)
**Repo:** https://github.com/BradleyGleavePortfolio/growth-project-mobile
**Baseline HEAD:** `71ae45815fe6dde6bd0bbcbf459c120e69425d8a`
**Fix SHA:** `1c63aa2735e687cc9673ca2093081e59f463f02b`
**Author:** Dynasia G <dynasia@trygrowthproject.com> (title-only commit, no trailers)
**Worktree:** `/home/user/workspace/tgp/fixer-mwb-4-mobile-ci-handle`

---

## Problem (recap)

CI run `27406755122` on the R2 baseline (`71ae458`) failed with **exit code 1**: 213 suites / 2381 tests all *passed*, but the run was marked failed. The R2 code-fixer added 10 new autosave tests that introduced open-handle / async-after-teardown leaks the existing cleanup missed. Global `--forceExit` is REJECTED per D-011 / 50-Failures #42, so the fix had to clean the handles directly.

---

## Diagnosis — `--detectOpenHandles` + suite isolation

Ran the three new autosave suites with `--detectOpenHandles` and then isolated the leak by running suites individually, in pairs, and with an unrelated suite appended.

| Run | Exit | `Cannot log after tests` | Notes |
|-----|------|--------------------------|-------|
| each file alone | 0 | 0 | clean in isolation |
| coach + api | 0 | 0 | clean |
| api + hook | **1** | **1** | leak surfaced |
| hook + coach | **1** | **1** | leak surfaced |
| **hook** + unrelated suite | **1** | **1** | **`useAutosave.test.tsx` is the sole trigger** |
| coach + unrelated | 0 | 0 | clean |
| api + unrelated | 0 | 0 | clean |

### Handle / leak types found
1. **Async flush resolving after teardown (`useAutosave.test.tsx`).** RTL's auto-cleanup unmounts the hook *after* the file's `afterEach` had already restored real timers. The unmount-triggered stable flush then ran async on the real clock and its rejection (`[useAutosave] flush rejected … kind:'unknown'`) logged after the test finished.
2. **`global.fetch` lazy expo getter (`useAutosave.test.tsx`).** jest-expo installs `global.fetch` as a lazy getter that requires `ExpoFetchModule` on first access. This suite replaces `react-native` with a minimal stub, leaving `expo-modules-core` unable to satisfy that require. When the fetch getter was touched at/after teardown it emitted an async `console.warn` ("An error occurred while requiring the 'ExpoModulesCoreJSLogger' module") that landed **after** the suite completed → Jest reported the `●  Cannot log after tests are done` suite-level failure → **exit 1**. This was the actual exit-1 trigger.
3. **Armed debounce / backoff / saved-settle timers** left scheduled when `jest.useRealTimers()` was called without first clearing them (both timer suites). Defensive: pattern A.

> Note: `0` literal open-handle traces were printed by `--detectOpenHandles` after the fix; the failure was an async-after-teardown console leak, which `--detectOpenHandles` does not enumerate as a "handle" but which still fails the suite.

---

## Files touched (test files only — no source changes)

```
 src/__tests__/coachWorkoutBuilderAutosave.test.tsx |  4 +++
 src/hooks/__tests__/useAutosave.test.tsx           | 41 ++++++++++++++++++++--
 2 files changed, 43 insertions(+), 2 deletions(-)
```

### `src/hooks/__tests__/useAutosave.test.tsx`
- **Pattern B / fetch pin (`beforeAll`):** eagerly pin `global.fetch` to an inert `jest.fn()` rejecting stub so the broken lazy expo `ExpoFetchModule` require never fires. The hook makes no real network calls here (API fully mocked), so this is safe and file-scoped. **Eliminates the `Cannot log after tests are done` → exit-1 trigger.**
- **Pattern A + C (`afterEach`, now async):** before restoring real timers, explicitly `cleanup()` (RTL unmount) *while the fake clock is still active*, then `jest.runOnlyPendingTimers()` + `await Promise.resolve()` inside `act(...)` to settle the unmount flush + debounce/backoff/saved-settle chains, then `jest.clearAllTimers()` and finally `jest.useRealTimers()`. Removes the leaked `flush rejected` after-teardown logs.
- Added `cleanup` to the `@testing-library/react-native` import.

### `src/__tests__/coachWorkoutBuilderAutosave.test.tsx`
- **Pattern A (`afterEach`):** added `jest.clearAllTimers()` before `jest.useRealTimers()` so a debounced screen-level flush can't resolve after the test.

The repo's **global NetInfo mock already exists** in `jest.setup.js` (its `addEventListener` returns a real unsubscribe), and `useAutosave.test.tsx` additionally has its own per-file NetInfo mock returning a `jest.fn()` unsubscribe — so Pattern B for NetInfo was already satisfied; no setup-file change was needed. **`jest.setup.js` was NOT modified** (kept scope surgical).

---

## Before / after

### The 3 autosave suites combined (`npx jest --runInBand <3 files>`)
| | Before | After |
|---|---|---|
| Exit code | **1** | **0** |
| `Cannot log after tests are done` | present (`●` suite failure) | **gone** |
| `ExpoModulesCoreJSLogger` async warn | present | **gone** |
| `--detectOpenHandles` | exit 1 | exit 0, **0 open handles** |
| Tests | 40 passed | 40 passed |
| Stability | flaky exit 1 | exit 0 across re-runs + reversed order |

### Full suite (`npm test -- --ci --passWithNoTests --runInBand`)
- **Exit code: 0** (was 1 on baseline `71ae458`).
- Test Suites: **213 passed, 213 total**; Tests: **2381 passed, 2381 total**; Snapshots: 5 passed.
- **Zero `●` failure bullets, zero FAIL lines, zero `Cannot log after tests are done`.**
- The bare `Jest did not exit one second after the test run has completed` message is still printed — this is the **pre-existing D-011 baseline** (it persists even with the 5 named D-011 suites excluded, confirming it is not introduced by the new autosave tests). It does **not** set a non-zero exit code, matching the previous passing #237 fixer at `da393f3` which CI tolerated. The exit-1 differentiator was the autosave `Cannot log` failure, now removed.

---

## R0 grep battery (added `+` lines only) — CLEAN
- `forceExit`: CLEAN (none added)
- swallowed `catch {}` / `catch(e){}`: CLEAN
- `pictograph`: CLEAN
- banned font weights: CLEAN
- `TODO`/`FIXME`/`placeholder`/`XXX`: CLEAN
- `as any` / `as unknown`: CLEAN

No source-file changes outside test files; no jest config / setup changes.

---

## Commit & push
- Commit: `1c63aa2735e687cc9673ca2093081e59f463f02b`
  - Title: `fix(community): #237 jest open handle cleanup for autosave tests`
  - Author/Committer: `Dynasia G <dynasia@trygrowthproject.com>`, empty body, **no trailers**.
- Pushed `71ae458..1c63aa2` → `origin/feature/mwb-4-mobile-autosave` (PR #237 head, now `1c63aa2`).

## CI re-run
- Run **27409069542** (event: `workflow_dispatch`, headSha `1c63aa2…`): **conclusion = success**.
- URL: https://github.com/BradleyGleavePortfolio/growth-project-mobile/actions/runs/27409069542
- (The prior baseline run `27406755122` on `71ae458` = failure.)

---

FIX COMPLETE: 1c63aa2735e687cc9673ca2093081e59f463f02b
