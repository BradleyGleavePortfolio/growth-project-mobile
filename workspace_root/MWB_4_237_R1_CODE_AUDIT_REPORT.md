# AUDIT — MWB-4 mobile autosave (PR #237)
VERDICT: NOT CLEAN

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR HEAD audited: `c1120e127403446afe89634242eebc100dde7977`  
Base used: `origin/main` = `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`

Typecheck: PASS — `npx tsc --noEmit` exited 0.  
Lint: PASS — `npm run lint` exited 0 with 83 existing warnings; no lint errors.  
Targeted tests: PARTIAL/PASS-BUT-EXIT-1 — individual `useAutosave.test.tsx` and `coachWorkoutBuilderAutosave.test.tsx` runs passed 7/7 and 3/3; the combined brief command passed 10/10 but exited 1 after an Expo post-test logger warning.  
Full suite: NOT COMPLETED in this audit worktree — attempted `npx jest --runInBand`, but the sandbox root filesystem hit 100% full after dependency install/logging. Per D-011, the known CI “Jest did not exit” open-handle failure is pre-existing and is not treated as a PR blocker here.

R0 grep battery: DIRTY — one added test line uses `as unknown as`, plus two comment-only matches.  
R69 schema invariant: CLEAN — no Prisma schema diff.

## P0 findings

- [src/hooks/useAutosave.ts:214, src/hooks/useAutosave.ts:228-230, src/hooks/useAutosave.ts:319-329, src/hooks/useAutosave.ts:347-356] In-flight autosave coalescing can silently drop the latest edit and clear its offline mirror. `flush()` overwrites `pendingRef` and the on-disk mirror with the newest batch, but `sendBatch()` returns immediately when another request is in flight; when the earlier request later succeeds, it unconditionally clears the mirror and sets `pendingRef.current = null`, deleting the newer unsent batch. This violates #16/#28 race handling, #20 dedupe semantics, and the offline-mirror guarantee because a coach typing during an in-flight save can see the UI edit remain locally while the only durable copy is removed. Fix: serialize a queue, or keep a distinct `currentInFlight` vs `pendingNext` batch; after the in-flight request settles, send the newer batch with a fresh idempotency key and never clear a mirror entry that belongs to a different batch.

- [src/screens/coach/CoachWorkoutBuilderScreen.tsx:72-86, src/hooks/useAutosave.ts:244-261, src/hooks/useAutosave.ts:356-362, src/screens/coach/CoachWorkoutBuilderScreen.tsx:231-239] The designed first autosave 409 path can mark unsaved user edits as the new baseline and drop them. The screen intentionally starts every edit session with a placeholder lock token so the first autosave 409s, but the hook clears the mirror and `pendingRef` on 409 and then `flush()` advances `lastSavedValueRef` whenever `pendingRef.current === null`, even though the batch was not applied. The screen’s conflict handler only refetches the server plan; it does not preserve and retry the local ops, so the first edit after enabling autosave can be lost or never retried. Fix: on 409, keep the local batch pending, adopt the fresh token/index, rebase/refetch, then retry or re-diff against the server head; only advance `lastSavedValueRef` after a 200 for the user’s ops.

## P1 findings

- [src/hooks/useAutosave.ts:300-363, src/hooks/useAutosave.ts:366-382, src/hooks/useAutosave.ts:425-438] The unmount/teardown flush is stale and can miss the last edit. The lifecycle effect intentionally excludes `flush`/`value` from its dependency list, so its cleanup calls the old `flush()` closure captured when the effect last bound; on unmount, the debounce cleanup can cancel the current timer before this stale cleanup runs, and the stale flush can compute no diff against the initial value. This fails the “beforeRemove/teardown must force-flush” guarantee and can lose an edit if the coach navigates away before the debounce fires. Fix: store the latest value in a ref used by a stable flush, or register a real navigation `beforeRemove` handler that awaits a current mirror-first flush.

- [src/api/workoutAutosaveApi.ts:399-412, src/hooks/useAutosave.ts:212-291, src/hooks/useAutosave.ts:384-423] Autosave requests are not cancellable and there is no abort signal on screen unmount. The API client does not accept/pass an Axios `signal`, and the hook starts requests from debounce/background/replay without an AbortController; the unmount cleanup actually starts another flush rather than cancelling an obsolete request. This fails the brief’s #29 abort-signal focus and can leave obsolete network writes racing after the editor is gone. Fix: thread an AbortController through `workoutAutosaveApi.autosave`, abort obsolete in-flight requests on unmount/navigation where appropriate, and keep the mirror for replay instead of relying on post-unmount network completion.

- [src/hooks/useAutosave.ts:266-276, src/hooks/useAutosave.ts:398-423, src/hooks/useAutosave.ts:373-375] There is no retry + backoff policy for transient failures. Network/server failures leave the batch in the mirror and set `status='offline'`, but no exponential backoff timer, NetInfo reconnect listener, or bounded retry loop exists; replay only happens on mount, and manual pill taps call `flush()`. This fails the #19 retry/backoff requirement for autosave/offline sync. Fix: add bounded exponential backoff with jitter for transient `network`/`server` errors, pause while offline, resume on reconnect, and keep the mirror until a 200 or successful conflict rebase/retry.

## P2 findings

- [src/hooks/__tests__/useAutosave.test.tsx:192-227, src/hooks/__tests__/useAutosave.test.tsx:291-311, src/hooks/__tests__/useAutosave.test.tsx:314-336] Critical race/rollback branches are not tested. The tests cover one happy-path 409 fast-forward, one network offline case, mount replay, background flush, and flag-off invariance, but there is no test for second edit while a save is in flight, 409 preserving/retrying local edits, unmount before debounce, abort on unmount, or retry/backoff. Fix: add regression tests for all P0/P1 branches above before re-audit.

- [src/api/__tests__/workoutAutosaveApi.test.ts:73] Added test code uses `as unknown as`, which tripped the required R0 grep battery. Fix: replace the double-cast with a typed Jest mock seam or `jest.mocked(axios.isAxiosError)` pattern.

## P3 (non-blocking)

- Pre-existing CI infra leak: per operator decision D-011, the `Jest did not exit one second after the test run has completed` CI exit-1 is a pre-existing React-Query GC timer leak in unrelated tests and is not a P0/P1/P2 blocker for this PR. A separate test-infra sweep should handle it surgically; do not mask it with global `forceExit`.

- The combined targeted Jest command in this worktree passed all 10 targeted tests but exited 1 due an Expo post-test logger warning. The two target files pass when run individually, so I am not treating this as a product-code blocker; it should be watched in CI/test-infra follow-up.

## Verification of PR claims

- Claim: flag-off autosave is inert. Verified by code gating `autosaveEnabled` on `featureFlags.mwbAutosave && isEditing && Boolean(planId)` and passing it into `useAutosave`; tests also cover the flag-off zero-network path. [src/screens/coach/CoachWorkoutBuilderScreen.tsx:198-249, src/__tests__/coachWorkoutBuilderAutosave.test.tsx:205-221]

- Claim: offline mirror writes before network. Verified on the normal `flush()` path: the hook writes `writeAutosaveMirror(mirror)` before `sendBatch(batch)`. The guarantee is broken under in-flight races as described in P0. [src/hooks/useAutosave.ts:332-356]

- Claim: 409 fast-forward is safe. FALSE. The hook adopts token/index and clears the mirror on 409, but it does not rebase/retry the local ops and can advance `lastSavedValueRef` after an unapplied conflict. [src/hooks/useAutosave.ts:244-261, src/hooks/useAutosave.ts:356-362]

- Claim: dedupe prevents duplicate saves. PARTIAL/FALSE under races. The same pending idempotency key is reused when `pendingRef.current` exists, even if the user has produced a different batch, and the in-flight completion can clear a newer batch’s mirror. [src/hooks/useAutosave.ts:319-329]

- Claim: AppState background flush exists. Verified for the current `flush()` closure via AppState listener. [src/hooks/useAutosave.ts:384-396]

- Claim: navigation/beforeRemove flush exists. FALSE. The hook comments mention `beforeRemove`, but the implementation only has a React unmount cleanup and no `navigation.addListener('beforeRemove', ...)`; that cleanup also captures a stale flush closure. [src/hooks/useAutosave.ts:425-438]

- Claim: abort signals on unmount exist. FALSE. No `AbortController`, `signal`, or cancellation path appears in the changed autosave hook/API. [src/hooks/useAutosave.ts:212-291, src/api/workoutAutosaveApi.ts:399-412]

VERDICT: NOT CLEAN
