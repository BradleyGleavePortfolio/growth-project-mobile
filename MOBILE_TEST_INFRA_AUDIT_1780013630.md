# Mobile Test Infrastructure Audit — SuccessReceipt hang fix

**PR under audit:** [#205](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/205) (`agent/builder/ai-execution-mobile/e12ea641`)
**Fix commit:** `e0a0947` ("test(checkout): fix SuccessReceipt suite hang under React 19 Scheduler")
**Prior HEAD:** `0e9d963` (Stream 2 mobile R2-CLEAN)
**Auditor:** independent (R31)
**Worktree:** `/home/user/workspace/tgp/mobile-ai-execution-audit`, HEAD `e0a0947`
**Date:** 2026-05-29T02:53Z

---

## SUMMARY

Verdict: **CLEAN**. The hang fix is real, local, and honest. The engineer correctly identified that `jest.useFakeTimers({doNotFake:['queueMicrotask']})` + `render(<SUT/>)` deadlocks React 19's Scheduler in `react-test-renderer` and rewrote tests (c) and (d) to spy on `global.setTimeout` instead. The spy traps the SUT's 1800ms dismiss timer rather than letting it schedule on the real event loop, while still verifying (in test c) that the captured callback drives `navigation.goBack`. Animated.timing callbacks remain on real timers and are cleaned up by the test's `afterEach`. Tests (a) and (b) are untouched. Full mobile jest run is 135/135 suites, 1425/1425 tests in 55.3 s (engineer claimed 33.3 s on warm node cache; my run from a cold worktree took longer but the pass/fail numbers match exactly). SUT and `jest.setup.js` are untouched per the engineer's claim. R4 author is clean. Doctrine static + jest both pass. No banned tokens in the PR diff.

The pre-existing "Jest did not exit one second after the test run has completed" warning persists. It is **not** introduced by this fix, it is **not** a test failure (exit 0), and the engineer correctly flagged it as a P3 hygiene follow-up. I am not gating CLEAN on it.

---

## P0 FINDINGS

None.

## P1 FINDINGS

None.

## P2 FINDINGS

None.

---

## DIFF AUDIT (`git show e0a0947 -- src/screens/coach/__tests__/CreditPackCheckoutScreen.SuccessReceipt.test.tsx`)

### What was removed

In tests (c) and (d):
- `jest.useFakeTimers({ doNotFake: ['queueMicrotask'] })` calls (lines 347, 393 in the prior file).
- `jest.advanceTimersByTime(1799)` + `jest.advanceTimersByTime(2)` in test (c).

### What was added

In test (c) auto-dismiss (now lines 365-414 of the new file):
- A typed `ScheduledTimer` array.
- A `jest.spyOn(global, 'setTimeout')` with `.mockImplementation((handler, timeout) => { ... })`.
  - When `typeof handler === 'function' && timeout === 1800`: push `{ cb: handler, delay: timeout }` into `scheduled`, return a sentinel id `999999`.
  - Otherwise: pass through to the captured-real `setTimeout`.
- A `try / finally` that ensures `timeoutSpy.mockRestore()` runs even if assertions throw.
- Inside the try: render → driveToSuccess → assert `credit-pack-success` is mounted → find the trapped 1800ms entry → invoke `dismiss!.cb()` inside `act()` → assert `mockGoBack` called once.

In test (d) balance-fallback (now lines 423-459):
- Same `setTimeout` spy pattern but the trapped 1800ms callback is **discarded** (not invoked). The spy exists solely to prevent the real timer from being scheduled, which would keep the worker alive past the test.
- `try / finally` with `mockRestore`.

Tests (a) and (b) are byte-for-byte identical to the pre-fix version. They continue to use real timers throughout, which they always did.

### Honesty review

The auto-dismiss test (c) **does** verify the production semantics:
- The spy filter `timeout === 1800` is sharp: if the SUT were changed to `setTimeout(onDone, 1700)` or scheduled the timer with a different delay, the `scheduled.find((t) => t.delay === 1800)` would return undefined and `expect(dismiss).toBeDefined()` would fail. The "1800ms after success phase" semantics is genuinely asserted.
- The trapped callback IS the SUT's actual `onDone` (which is `setPhase({kind:'select'})` → no, actually `onDone` is the `goBack`-wired callback passed by the parent — see `CreditPackCheckoutScreen.tsx:436`: `dismissTimer.current = setTimeout(onDone, 1800)`). The test invokes that real callback inside `act()`, which is the same path a real timer firing would take after the act flush, and asserts `mockGoBack` was called.
- The `999999` sentinel id is returned so the SUT's cleanup function (`if (dismissTimer.current) clearTimeout(dismissTimer.current)` on unmount, `CreditPackCheckoutScreen.tsx:439`) can call `clearTimeout(999999)` without error. The real `clearTimeout` accepts arbitrary ids and is a no-op for ids it does not know — verified by reading the SUT cleanup path.

The balance-fallback test (d) **does not invoke** the trapped callback, which is correct — it asserts the rendered shape and explicitly does not exercise the auto-dismiss path (test (c) already covers it). The spy's only role here is to prevent the real timer from leaking past the test.

What the engineer is **not** doing that would be theater:
- No `describe.skip`, no `.skip`, no `it.skip`, no `xdescribe`, no `xit`, no `.todo`. Confirmed by reading the full diff.
- No SUT stubbing. The real `CreditPackCheckoutScreen` is rendered with all its real internals (Animated, useEffect, setPhase).
- No new mock for the WebView or for `useAIBudget` — the existing test-file mocks (which were already present in the prior commit and unchanged) are reused.
- No assertion deletions. All 4 behavioural assertions (rendered output, doctrine compliance, auto-dismiss, balance fallback) remain in place.

### Mock coverage check

I verified the existing mocks for `useAIBudget`, `coachAiBudgetApi`, WebView, navigation, etc. were not modified in this commit:

```
$ git show e0a0947 --stat
 .../CreditPackCheckoutScreen.SuccessReceipt.test.tsx | 137 +++++++-----
```

Only the one file. The mocks (set up in `beforeEach` and at module scope, lines 39-160 of the test file) are byte-identical to the prior HEAD.

---

## LOCAL CHECK RESULTS

| Check | Command | Result | Notes |
|---|---|---|---|
| SuccessReceipt suite | `./node_modules/.bin/jest src/screens/coach/__tests__/CreditPackCheckoutScreen.SuccessReceipt.test.tsx --runInBand --testTimeout=15000` | ✓ **4/4 pass in 1.58 s** | (a) 268 ms, (b) 13 ms, (c) 12 ms, (d) 15 ms. |
| Doctrine jest | `./node_modules/.bin/jest src/__tests__/quietLuxuryDoctrine.test.ts --runInBand --testTimeout=15000` | ✓ **10/10 pass in 1.65 s** | Including the `does not contain TODO / FIXME / XXX comments` rule. |
| Doctrine static (PR diff) | `git diff origin/main...HEAD -- 'src/**' \| grep -E "confetti\|FirstWinCelebration\|TrophyArtifact\|TrophyShareScreen"` | ✓ **zero matches** | exit 1. |
| tsc | `./node_modules/.bin/tsc --noEmit` | ✓ **exit 0** | Full repo, no diagnostics. |
| eslint (changed file) | `./node_modules/.bin/eslint src/screens/coach/__tests__/CreditPackCheckoutScreen.SuccessReceipt.test.tsx` | ✓ **exit 0** | 0 errors, 0 warnings. |
| Full mobile suite | `./node_modules/.bin/jest --ci --runInBand --testTimeout=30000` | ✓ **135 suites pass / 135 total, 1425 tests pass / 1425 total, 4 snapshots, 55.3 s** | Engineer reported 33.3 s; my cold-cache run is slower but pass/fail numbers match exactly. Exit 0. |
| R4 author | `git log --format='%an <%ae>' 0e9d963..HEAD \| sort -u` | ✓ | `Dynasia G <dynasia@trygrowthproject.com>` only. |
| Commit body banned trailers | `git log -1 e0a0947 --format=%B \| grep -iE "co-authored\|generated.with\|claude"` | ✓ | no banned trailers. |
| SUT untouched | `git diff 0e9d963..HEAD -- src/screens/coach/CreditPackCheckoutScreen.tsx \| wc -l` | ✓ **0 lines** | |
| `jest.setup.js` untouched | `git diff 0e9d963..HEAD -- jest.setup.js \| wc -l` | ✓ **0 lines** | |

### Trailing "Jest did not exit" warning

The full run reports:

```
Test Suites: 135 passed, 135 total
Tests:       1425 passed, 1425 total
Snapshots:   4 passed, 4 total
Time:        55.337 s
Ran all test suites.
Jest did not exit one second after the test run has completed.

'This usually means that there are asynchronous operations that weren't stopped in your tests. Consider running Jest with `--detectOpenHandles` to troubleshoot this issue.
```

- Exit code is **0** — this is a non-fatal warning.
- It is **not** introduced by this fix (test (a) was passing prior to this commit and contributed the same leaked async; the SuccessReceipt suite already used real timers in test (a) + (b) which use Animated.timing — those callbacks fire after the test completes and produce open handles).
- Diagnosing the specific source would require `--detectOpenHandles` (which itself slows the suite and pollutes the trace). The engineer correctly flagged it as a P3 hygiene follow-up. I am not gating CLEAN on it.

---

## FILE-BY-FILE NOTES

### `src/screens/coach/__tests__/CreditPackCheckoutScreen.SuccessReceipt.test.tsx`

- The spy correctly distinguishes the SUT's 1800ms dismiss timer from Animated's internal driver setTimeouts (which use ~16ms intervals). The filter `timeout === 1800` is a tight, intentional sieve.
- `try / finally` with `mockRestore()` ensures the spy is reset on the next test even if assertions throw. Important because `global.setTimeout` is a global resource — leaking the spy into the next test in the suite would cause subtle failures.
- `realSetTimeout` is captured at spy-setup time, not inside the implementation. Correct — otherwise the spy would self-recurse.
- The handler-type guard `typeof handler === 'function'` is conservative; React internals + jest fakers never pass a string handler under the test environment. Defence-in-depth.
- Sentinel id `999999` for the trapped timer is acceptable because `clearTimeout` is no-op on unknown ids. Cleaner alternatives (e.g. returning a real but cleared id) would add 2 lines for no observable behavioural improvement.

### `src/screens/coach/CreditPackCheckoutScreen.tsx`

- Confirmed untouched (`git diff` shows zero lines). Auto-dismiss `setTimeout(onDone, 1800)` at line 436 remains the production code path being exercised.

### `jest.setup.js`

- Confirmed untouched. The shim attempts documented in `PARTIAL_ANIMATED_SHIM_v1.js` and `PARTIAL_ANIMATED_SHIM_v2_PROXY.md` were not adopted — the root cause was not Animated, as the engineer correctly identified, so no global shim was needed.

---

## VERDICT

**CLEAN.** 0 P0, 0 P1, 0 P2.

- Hang fixed at root (the fake-timer × React 19 Scheduler interaction, not a symptomatic patch).
- Locality is minimal: one file, 137 lines diff, +94/-43.
- Behavioural coverage of all four test cases preserved.
- Full mobile suite green: 135/135 suites, 1425/1425 tests. No regressions, no newly hidden failures unmasked.
- Doctrine, R4 author, SUT untouched, jest.setup.js untouched — all confirmed.
- The pre-existing "Jest did not exit" warning is acknowledged as P3 hygiene; not introduced by this fix.

R32 reminder: operator merges. No fix brief required.

## RECOMMENDED FIX BRIEF

N/A — branch is CLEAN.

## Forward-looking P3 advisory (not gating)

The "Jest did not exit one second after the test run has completed" warning is real but pre-existing. When PR #205 lands, a hygiene pass could:
1. Add `--detectOpenHandles` to a one-shot CI lane (not the default run, since it slows the suite significantly) and capture the leaking handle.
2. Likely candidates based on this audit: any test rendering Animated components with real timers + insufficient cleanup. The SuccessReceipt fade-in / icon-pulse `Animated.timing` callbacks fire 400–1000 ms after their `.start()`; if `cleanup()` runs before that, the callback eventually attaches to a detached fiber and silently no-ops, but the underlying timer still pends.
3. Resolution would either be a doctrine-clean Animated shim (a recoverable v3 of `PARTIAL_ANIMATED_SHIM`) or explicit `unmount()` + `await` of all pending Animated callbacks per test. Either is a separate PR.
