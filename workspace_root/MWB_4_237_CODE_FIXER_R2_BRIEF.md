# FIXER BRIEF — MWB-4 #237 code fixer R2 (2 P0 + 3 P1 + 2 P2)

FIXER (Opus 4.8 ONLY — Sonnet 4.6 FORBIDDEN). NOT builder. NOT auditor. Read `/home/user/workspace/MWB_4_237_R1_CODE_AUDIT_REPORT.md` FIRST. Read `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md`. This is a substantial autosave race/lifecycle correctness rework — invest the time needed to get it right.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #237, latest HEAD `da393f3da53b5d8c9e2364c164bf3451bb305d90` (post UX R1 fixer)
- Author: `Dynasia G <dynasia@trygrowthproject.com>` (title-only commits, NO trailers)
- D-011 carve-out: pre-existing React-Query GC leak — NOT yours to fix.

## Worktree (isolated)
```bash
mkdir -p /home/user/workspace/tgp/fixer-mwb-4-mobile-code
cd /home/user/workspace/tgp/fixer-mwb-4-mobile-code
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/237/head:pr-237
git checkout pr-237
git log -1 --format=%H   # MUST equal da393f3da53b5d8c9e2364c164bf3451bb305d90
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Findings to fix (verbatim per audit)

### P0 — In-flight autosave coalescing drops latest edit + clears mirror
**Evidence**: `useAutosave.ts:214,228-230,319-329,347-356`. `flush()` overwrites `pendingRef` and on-disk mirror with the newest batch, but `sendBatch()` returns immediately when another request is in flight. When the earlier request later succeeds, it unconditionally clears the mirror and sets `pendingRef.current = null`, deleting the newer unsent batch.

**Fix**: Refactor to a proper queue model:
1. Maintain `currentInFlight: { batch, key } | null` and `pendingNext: { batch, key } | null` (distinct).
2. `flush()` writes to `pendingNext` (with own fresh idempotency key) — never overwrites `currentInFlight`.
3. `sendBatch()` only runs when `currentInFlight === null`; it moves `pendingNext → currentInFlight` and sends.
4. On 200, clear `currentInFlight` from the mirror by KEY (not blanket clear), then if `pendingNext` exists, immediately call `sendBatch()` again.
5. On error, leave both intact (mirror keeps `currentInFlight`'s batch under its key, `pendingNext` retained).
6. Mirror should be keyed/scoped by idempotency key so per-batch clear is precise.

Add tests:
- Second edit while save in flight → second batch is queued and sent after first 200 settles.
- Second batch mirror is NOT cleared when first batch's 200 returns.

### P0 — First 409 path can drop unsaved edits as baseline
**Evidence**: `CoachWorkoutBuilderScreen.tsx:72-86, useAutosave.ts:244-261,356-362, CoachWorkoutBuilderScreen.tsx:231-239`. The screen intentionally starts with a placeholder lock token so the first autosave 409s. The hook clears the mirror and `pendingRef` on 409, then `flush()` advances `lastSavedValueRef` whenever `pendingRef.current === null` — even though the batch was NOT applied. Screen's conflict handler only refetches; doesn't preserve/retry the local ops.

**Fix**:
1. On 409: keep the local batch pending. Adopt the new token/index from the 409 response.
2. After refetch settles (server head fresh), re-diff the local batch against the new server value and re-submit (rebase the local ops onto the new baseline).
3. Only advance `lastSavedValueRef` after a 200 response for the user's ops.
4. The screen's conflict handler must trigger the refetch AND signal the hook to retry-after-refetch (don't just refetch and pray).

Add tests:
- First-autosave 409 → local edits survive, get rebased, and successfully save after refetch.
- Multiple 409s in a row → no advancement of `lastSavedValueRef` until 200.

### P1 — Stale unmount/teardown flush
**Evidence**: `useAutosave.ts:300-363,366-382,425-438`. Lifecycle effect excludes `flush`/`value` from deps, so cleanup calls the OLD `flush()` closure. On unmount, debounce cleanup can cancel the timer before stale cleanup runs; stale flush sees old value, computes no diff.

**Fix**:
1. Store latest `value` in a ref (`latestValueRef`).
2. Make `flush` stable: use `useCallback` with no value dep; flush reads `latestValueRef.current`.
3. OR: Register a real `navigation.addListener('beforeRemove', ...)` handler that awaits the current mirror-first flush. Use `@react-navigation/native` hook. Block navigation until mirror written; allow it after.
4. Test: edit + immediate unmount → mirror contains latest value; on remount, replay sends to server.

### P1 — Missing abort signals on unmount
**Evidence**: `workoutAutosaveApi.ts:399-412, useAutosave.ts:212-291,384-423`. API doesn't accept Axios `signal`. Hook starts requests from debounce/background/replay with no AbortController.

**Fix**:
1. Thread `signal?: AbortSignal` through `workoutAutosaveApi.autosave()`.
2. In hook: create AbortController per in-flight request. Store in ref.
3. On unmount: abort obsolete request (CAREFUL: if mirror writeback is pending, await it first; only abort the network call).
4. Replay-on-mount uses its own controller.

Add test: unmount during in-flight autosave → axios call is aborted; mirror retained for replay.

### P1 — Missing retry + backoff
**Evidence**: `useAutosave.ts:266-276,398-423,373-375`. Network/server failures leave batch in mirror and set `status='offline'`, but no exponential backoff timer, NetInfo reconnect listener, or bounded retry loop.

**Fix**:
1. Add `useNetInfo` (`@react-native-community/netinfo`) listener — on `isConnected: true` transition, trigger replay.
2. Add bounded exponential backoff for transient `network`/`server` errors:
   - Delays: 1s, 2s, 4s, 8s, 16s (cap at 16s). Add jitter (±25%).
   - Max attempts: 5 before surfacing terminal error.
3. Pause backoff while offline; resume on reconnect.
4. 409 is NOT retried via this path (handled by 409 rebase logic above).

Add tests: network error → backoff timer fires; reconnect from offline → immediate replay.

### P2 — Missing race/rollback branch tests
Already covered above by adding tests per P0/P1.

### P2 — `as unknown as` in test
**Evidence**: `src/api/__tests__/workoutAutosaveApi.test.ts:73`. Replace with `jest.mocked(axios.isAxiosError)` or a typed Jest mock seam.

## Mandatory checks (R0 hectacorn)

1. **R0 grep battery on added lines**:
   ```bash
   git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | \
     grep -vE '^\+\+\+' | \
     grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}' || echo "CLEAN"
   ```
2. **R69 (Prisma)**: ZERO Prisma schema diff.
3. **Bradley Law #36**: ZERO swallowed catches.
4. **R66 full suite**: `npx jest --runInBand`. D-011 pre-existing leak suites:
   - `src/hooks/useWearablePreference.test.tsx`
   - `src/screens/client/wearables/__tests__/cards.test.tsx`
   - `src/__tests__/coachLtvDashboard.test.tsx`
   - `src/components/coach/ai-budget/__tests__/AIBudgetMount.test.tsx`
   - `src/screens/day-one/__tests__/day1OnboardingScreens.test.tsx`
5. **Targeted autosave tests must all pass**:
   ```bash
   npx jest --runInBand src/hooks/__tests__/useAutosave.test.tsx src/__tests__/coachWorkoutBuilderAutosave.test.tsx src/api/__tests__/workoutAutosaveApi.test.ts
   ```

## Push + finish
```bash
git add -A
git commit -m "fix(mwb-4): autosave queue + 409 rebase + abort signals + backoff (P0+P1+P2)"
git push origin HEAD:feature/mwb-4-mobile-autosave
```
Then report:
```
FIX COMPLETE: <new SHA>
Report at /home/user/workspace/MWB_4_237_CODE_FIXER_R2_REPORT.md
```

Report must include:
- Full file/line list of changes
- Before/after for queue logic, 409 rebase, abort, backoff
- All new tests + targeted run output
- R0 grep result, FACE+VOICE result (N/A here), Bradley Law result
- Full jest result with D-011 leak signature confirmation

## Quality gate
ALL 2 P0 + 3 P1 + 2 P2 closed. Race-safety + lifecycle correctness proven via tests. No new regressions. D-011 carve-out maintained.
