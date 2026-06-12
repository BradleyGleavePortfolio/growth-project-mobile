# MWB-4 #237 — CODE FIXER R2 REPORT

**Role**: FIXER (Opus 4.8). **Sonnet 4.6 not used. No browser_task. No github_mcp_direct.** All git/network ops via `bash` + `gh` with `api_credentials=["github"]`.

**Repo**: `BradleyGleavePortfolio/growth-project-mobile`
**PR**: #237
**Branch**: `feature/mwb-4-mobile-autosave`
**Baseline (pre-fix) HEAD**: `da393f3da53b5d8c9e2364c164bf3451bb305d90`
**New HEAD (this fix)**: `71ae45815fe6dde6bd0bbcbf459c120e69425d8a`
**Remote verified**: `git ls-remote origin feature/mwb-4-mobile-autosave` → `71ae458…` ✅
**Commit author**: `Dynasia G <dynasia@trygrowthproject.com>` — title-only, empty body, NO trailers ✅

---

## Scope delivered: 2 P0 + 3 P1 + 2 P2 (all)

| ID | Finding | Status |
|----|---------|--------|
| P0#1 | In-flight autosave coalescing drops latest edit + clears wrong mirror | FIXED |
| P0#2 | First-409 path drops unsaved edits as baseline | FIXED |
| P1#3 | Stale unmount/teardown flush (stale closure) | FIXED |
| P1#4 | Missing abort signals on unmount | FIXED |
| P1#5 | Missing retry + bounded backoff + reconnect replay | FIXED |
| P2#6 | Missing race/rollback branch tests | FIXED (8 new tests) |
| P2#7 | `as unknown as` double-cast in API test | FIXED (`jest.mocked` seam) |

**D-011 carve-out honoured**: the pre-existing React-Query GC leak was NOT touched (not mine to fix).

---

## Files changed (7 files, +989 / −172)

```
 src/__tests__/coachWorkoutBuilderAutosave.test.tsx |   8 +-
 src/api/__tests__/workoutAutosaveApi.test.ts       |  73 +-
 src/api/workoutAutosaveApi.ts                      |  44 +-
 src/hooks/__tests__/useAutosave.test.tsx           | 399 +++++-
 src/hooks/useAutosave.ts                           | 561 ++++++++++----
 src/screens/coach/CoachWorkoutBuilderScreen.tsx    |  32 +-
 src/storage/autosaveMirror.ts                      |  44 +
```

### File/line landmarks
- `src/api/workoutAutosaveApi.ts`
  - L256: error-kind union adds `'aborted'`.
  - L276–277: `isAborted` getter.
  - L298–317: `fromAxios` classifies `axios.isCancel(err)` and `err.code === 'ERR_CANCELED'` → kind `'aborted'`.
  - L429: `signal?: AbortSignal` added to `AutosaveCallArgs`.
  - L447: `signal: args.signal` threaded into the axios `patch` config.
- `src/storage/autosaveMirror.ts`
  - L154–182: new `clearAutosaveMirrorIfKey(planId, idempotencyKey): Promise<boolean>` — reads the entry and clears ONLY when the stored key matches; returns `false` (left in place) if a newer batch owns the mirror. Read/remove faults are logged, never swallowed.
- `src/hooks/useAutosave.ts` — full race/lifecycle rework (see before/after below).
- `src/screens/coach/CoachWorkoutBuilderScreen.tsx`
  - L264–271: `navigation.addListener('beforeRemove', () => void autosaveFlush())`, gated on `autosaveEnabled` — durable mirror-first capture on back-navigation.
- Test files: see "New tests" below.

---

## Before / After — the four mechanism reworks

### 1. In-flight queue (P0#1)
**Before**: a single `pendingRef`. `flush()` overwrote both `pendingRef` and the on-disk mirror with the newest batch; `sendBatch()` returned early if a request was in flight; the earlier request's 200 then blanket-cleared the mirror and nulled `pendingRef`, deleting the newer unsent batch.

**After** (`useAutosave.ts`):
- Two-slot queue: `currentInFlightRef` (running request) + `pendingNextRef` (batch produced while in flight), each a `PendingBatch<TWorkingCopy>` with its OWN idempotency key and a `snapshot` of the working copy it was diffed up to.
- `sendBatch()` early-return when `currentInFlightRef !== null` parks the batch in `pendingNextRef` (never overwrites the in-flight one).
- On 200: `clearAutosaveMirrorIfKey(planId, batch.idempotencyKey)` (keyed clear — never blanket), then `pumpRef.current()` drains `pendingNext`.
- `lastSavedValueRef` advances to `batch.snapshot` (NOT the current latest value), so the queued batch re-derives only the unsent delta.

### 2. 409 rebase (P0#2)
**Before**: on 409 the hook cleared the mirror + `pendingRef`, and `flush()` advanced `lastSavedValueRef` whenever `pendingRef === null` — baselining an UNAPPLIED batch and losing the user's ops.

**After** (`useAutosave.ts` L443–478):
- On 409: adopt `conflict.head_revision_index` + `conflict.lock_token` into `indexRef`/`tokenRef`, call `onConflict`, set status `'conflict'`.
- `rebaseBatch()` re-diffs `lastSavedValueRef` vs `latestValueRef` onto the fresh head, preserving the SAME idempotency key; re-mirrors via `writeMirrorRef`; re-sends via `pumpRef`.
- `lastSavedValueRef` advances ONLY after a 200 — never on a bare 409. If the caller's refetch already absorbed the ops (diff empty) the batch is keyed-cleared cleanly.

### 3. Abort on unmount (P1#4)
**Before**: no AbortController; the API didn't accept a `signal`; an unmount left a request racing after teardown.

**After**: `abortRef` holds an `AbortController` per request; `controller.signal` threaded into `workoutAutosaveApi.autosave`. Unmount cleanup does a mirror-first `flush().finally(() => abortRef.current?.abort())` — the batch is durable on disk, so the cancelled network call is safe. The `'aborted'` error kind keeps the batch pending (not an error path, no status churn).

### 4. Bounded backoff + reconnect (P1#5)
**Before**: transient failures set `status='offline'` and stopped — no timer, no NetInfo listener.

**After**:
- `computeBackoffDelayMs(attempt, random?)` — exported; 1s→2s→4s→8s→16s, capped at `AUTOSAVE_BACKOFF_CAP_MS=16000`, ±25% jitter (`AUTOSAVE_BACKOFF_JITTER=0.25`), `AUTOSAVE_MAX_RETRY_ATTEMPTS=5`.
- `scheduleBackoff()` arms a retry on `network`/`server` errors; paused while `isOnlineRef` is false.
- `NetInfo.addEventListener` resets attempts + replays immediately on an offline→online edge. 409 is NOT retried via this path (handled by rebase).

### Stable flush (P1#3)
`latestValueRef.current = value` set every render; `flush` is `useCallback` with no `value` dep and reads `latestValueRef`. The AppState / unmount / `beforeRemove` paths therefore never fire a stale closure that misses the last keystroke.

---

## New tests (every P0/P1 branch) — `src/hooks/__tests__/useAutosave.test.tsx`

Hook test file now has **15 `it(...)` tests** (8 baseline updated/kept + 7 new branch tests; one baseline rewritten into 2):

- **P0#1**: "queues a second edit made while a save is in flight and sends it after the first 200, clearing only the first batch by key" — uses a deferred to hold the first request open; asserts the second edit lands in `pendingNext` with its own key (`idem-2`), the first 200's keyed clear is declined (newer batch owns the mirror), the second batch is then sent (NOT dropped) and clears its own key.
- **P0#2 (a)**: "adopts the conflict token + index, calls onConflict, then rebases + re-sends the local ops on the fresh head" — 409 then 200; asserts re-send carries the adopted base/token, SAME key, full ops, and baseline advances only after the 200.
- **P0#2 (b)**: "does NOT advance the diff baseline across repeated 409s" — two 409s then 200; every send carries the same ops + key; second rebase adopts the second conflict head/token.
- **P1#3**: "writes the latest edit to the mirror on immediate unmount (no stale closure)" — edit then immediate unmount before debounce; mirror holds `v5`.
- **P1#4**: "aborts the in-flight network call on unmount and keeps the batch in the mirror for replay" — captures `signal`, unmounts mid-flight, asserts `signal.aborted === true` and mirror NOT cleared.
- **P1#5 (a)**: "exposes a capped, jittered backoff schedule" — deterministic `computeBackoffDelayMs` center values + jitter bounds.
- **P1#5 (b)**: "schedules a backoff retry after a network error, then retries when the timer fires".
- **P1#5 (c)**: "replays immediately on a NetInfo offline→online reconnect transition".

### P2#7 — `src/api/__tests__/workoutAutosaveApi.test.ts`
Replaced the `(axios as unknown as { isAxiosError: jest.Mock })` double-cast with typed `jest.mocked(axios.isCancel)` / `jest.mocked(axios.isAxiosError)` seams. Added 3 tests: `CanceledError → 'aborted'`, `ERR_CANCELED → 'aborted'`, and signal-threaded-through-config. **22/22 pass.**

### Screen test mock — `src/__tests__/coachWorkoutBuilderAutosave.test.tsx`
Added `addListener: jest.fn(() => jest.fn())` to the `@react-navigation/native` `useNavigation` stub (the screen now registers a `beforeRemove` listener; without this the effect throws on mount).

---

## Gate results

### Targeted run
```
$ npx jest --runInBand \
    src/hooks/__tests__/useAutosave.test.tsx \
    src/__tests__/coachWorkoutBuilderAutosave.test.tsx \
    src/api/__tests__/workoutAutosaveApi.test.ts
PASS src/__tests__/coachWorkoutBuilderAutosave.test.tsx
PASS src/api/__tests__/workoutAutosaveApi.test.ts
PASS src/hooks/__tests__/useAutosave.test.tsx
Test Suites: 3 passed, 3 total
Tests:       40 passed, 40 total
```

### TypeScript
```
$ npx tsc --noEmit   → exit 0 (clean)
```

### ESLint (changed files)
```
$ npx eslint <7 changed files>   → 0 errors
```
(One pre-existing warning at `CoachWorkoutBuilderScreen.tsx:301` — a `.map().join(',')` dependency-array expression with an existing `eslint-disable` above it, present on the prior PR HEAD; not introduced by this fix. The previously-flagged unused `clearAutosaveMirror` import in `useAutosave.ts` was removed.)

### R0 grep battery (on the fix's working changes vs baseline da393f3)
```
$ git diff HEAD~1 -- '*.ts' '*.tsx' | grep '^+' | grep -vE '^\+\+\+' | \
    grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}'
CLEAN
```
Notes on the full `origin/main...HEAD` PR-range grep (pre-existing, not introduced here):
- `0x80/0x800/0xd800/0xdbff` — pre-existing UTF-8 byte-count code (untouched).
- Doc-comment lines literally stating *"no `as unknown as`, no `as any`"* — descriptive, false positives.
- The old `(axios as unknown as …)` cast is REMOVED by this fix (now `jest.mocked`); it only appears in the PR-range three-dot diff as historical content.

### Bradley Law #36 (no silent failures / no swallowed catches)
```
$ git diff baseline -- '*.ts' '*.tsx' | grep '^+' | grep -E 'catch\s*\([^)]*\)\s*\{\s*\}'
NO EMPTY CATCHES
```
Every failure path logs (`logger.warn`/`logger.error`) and sets a visible status (`offline`/`conflict`) while retaining the mirror — never a quiet resolve. The hook tests emit the expected `[useAutosave] flush deferred (offline/server)` warnings, proving the surfacing fires.

### R69 — Prisma schema diff
```
NO PRISMA FILES TOUCHED   (zero schema diff)
```

### FACE + VOICE
N/A — no avatar/voice surface in this change.

### Full jest suite
```
$ npx jest --runInBand
Test Suites: 213 passed, 213 total
Tests:       2381 passed, 2381 total
Snapshots:   5 passed, 5 total
```
**D-011 leak signature**: the carve-out suites (`useWearablePreference.test.tsx`, `wearables/__tests__/cards.test.tsx`, `coachLtvDashboard.test.tsx`, `ai-budget/__tests__/AIBudgetMount.test.tsx`, `day-one/__tests__/day1OnboardingScreens.test.tsx`) all PASS under `--runInBand`; the pre-existing React-Query GC leak is a teardown-warning concern (not a test failure) and was left untouched per the carve-out. No suite failed; no `jest did not exit` blocker surfaced in the run summary.

---

FIX COMPLETE: 71ae45815fe6dde6bd0bbcbf459c120e69425d8a
