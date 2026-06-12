# FIXER BRIEF — MWB-4 #237 CI handle cleanup (Jest did not exit)

FIXER (Opus 4.8 ONLY). Surgical fix only. NO browser_task, NO github_mcp_direct.

## Problem
CI run 27406755122 on HEAD `71ae45815fe6dde6bd0bbcbf459c120e69425d8a` reported:
- Test Suites: 213 passed, 213 total
- Tests: 2381 passed, 2381 total
- Exit code: 1 because "Jest did not exit one second after the test run has completed" (D-011 React-Query leak signature, but EXIT 1 now means CI fails)

Previous #237 fixer (UX R1) at HEAD `da393f3` PASSED CI with the same D-011 baseline (2371 tests). The code fixer R2 added 10 new tests for autosave queue/409/abort/backoff branches. Some of those new tests introduce new open handles (NetInfo listener, AbortController, debounce timers) that the test cleanup misses.

## Goal
Make Jest exit cleanly in CI without enabling global `forceExit` (REJECTED per D-011 / 50-Failures #42).

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/fixer-mwb-4-mobile-ci-handle
cd /home/user/workspace/tgp/fixer-mwb-4-mobile-ci-handle
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/237/head:pr-237
git checkout pr-237
git log -1 --format=%H   # MUST equal 71ae45815fe6dde6bd0bbcbf459c120e69425d8a
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```
`api_credentials=["github"]`.

## Diagnosis steps
1. Run with `--detectOpenHandles` on the new autosave test files only:
   ```bash
   npx jest --runInBand --detectOpenHandles \
     src/hooks/__tests__/useAutosave.test.tsx \
     src/__tests__/coachWorkoutBuilderAutosave.test.tsx \
     src/api/__tests__/workoutAutosaveApi.test.ts 2>&1 | tee /tmp/handles.log
   ```
2. Inspect handle traces — likely sources:
   - **NetInfo listener** not unsubscribed: each test that mounts the hook subscribes to NetInfo; teardown must call the returned unsubscribe.
   - **AbortController signal listeners** not aborted: tests that simulate unmount must call `controller.abort()` or rely on hook cleanup.
   - **Debounce/backoff timers** not cleared: `setTimeout` for backoff (1s, 2s, 4s, 8s, 16s) must be cleared by `jest.useFakeTimers()` and `jest.clearAllTimers()` in `afterEach`.
   - **`saved` settle timer** from UX R1 fix.

## Likely fix patterns

### Pattern A: Add `jest.useFakeTimers()` per test
Wrap suites that exercise timers/backoff:
```ts
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
```

### Pattern B: Mock NetInfo properly
In Jest setup (or test file):
```ts
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
  addEventListener: jest.fn(() => () => {}),
  useNetInfo: jest.fn(() => ({ isConnected: true })),
}));
```
The function returned by `addEventListener` is the unsubscribe — test must call it on cleanup OR the mock can be a no-op stub.

### Pattern C: Ensure hook teardown
After every test that mounts `useAutosave`, call `unmount()` and run any pending timers/microtasks:
```ts
await act(async () => { unmount(); });
await new Promise((r) => setImmediate(r));
```

### Pattern D: Cancel AbortControllers in finally
Inside the hook: ensure `controller.abort()` is called in every code path that creates a controller, even on success (in finally).

## Mandatory checks
1. `npx jest --runInBand --ci --passWithNoTests` — must exit 0 (no "did not exit" warning).
2. Other D-011 pre-existing leak suites (NOT yours):
   - `src/hooks/useWearablePreference.test.tsx`, `src/screens/client/wearables/__tests__/cards.test.tsx`, `src/__tests__/coachLtvDashboard.test.tsx`, `src/components/coach/ai-budget/__tests__/AIBudgetMount.test.tsx`, `src/screens/day-one/__tests__/day1OnboardingScreens.test.tsx`
   - If CI still exits 1, run the audit lane WITHOUT D-011 suites:
     ```bash
     npx jest --runInBand --ci --passWithNoTests \
       --testPathIgnorePatterns="useWearablePreference|wearables/__tests__/cards|coachLtvDashboard|AIBudgetMount|day1OnboardingScreens"
     ```
     If THIS exits 0, then the residual leak IS D-011 baseline and you should ADD `--forceExit` ONLY IF the auditor/operator approves a temporary CI workaround. PREFER: clean handles instead.

If even after fully cleaning new test handles the leak persists (matching D-011 baseline that the previous #237 fixer's CI tolerated), STOP and report — escalate as the CI runner may have changed behavior between runs.

## R0 grep on added lines
Must remain CLEAN.

## Push + finish
```bash
git add -A
git commit -m "test(mwb-4): clear open handles in new autosave tests (NetInfo/timers/abort cleanup)"
git push origin HEAD:feature/mwb-4-mobile-autosave
```
Report `FIX COMPLETE: <new SHA>` at `/home/user/workspace/MWB_4_237_CI_HANDLE_CLEANUP_REPORT.md` with:
- Output of `--detectOpenHandles` diagnosis
- Files changed + before/after for each cleanup
- Final `npm test -- --ci --passWithNoTests` exit code (must be 0)
- CI re-run URL after push
