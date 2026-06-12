# D-011 RQ-GC Leak Surgical Sweep — Build Report

**PR:** #240 — https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/240
**Branch:** `chore/rq-gc-leak-surgical-sweep` (from main `f1cb1018c64c37dc7aea0f42846b70d171323c96`)
**HEAD SHA:** `5f5729fb622328af1c01d7ca7b285fb85311bc7c`
**Author:** Dynasia G <dynasia@trygrowthproject.com>
**Authority:** D-011 Path B — per-suite remediation, NO global `forceExit`, NO `detectOpenHandles`, test files only.
**React Query version in repo:** `@tanstack/react-query ^5.100.1` → v5, so `gcTime` is the correct knob (not `cacheTime`).

---

## Scope decision

The task named 5 "known leaky" suites from the R64 audit. Empirical baseline (each run individually with `npx jest --runInBand <suite>`) showed only **2** actually emit the "Jest did not exit one second after the test run has completed" warning, and of those only **1** is a genuine React-Query GC leak. The other 3 named suites were already clean and contain no in-test `QueryClient`, so they were left untouched to honor the TIGHT scope and "leak surgery, not behavior" constraint.

**Files changed: 2 test files only. No production source touched.**

---

## Per-suite before / after

| # | Suite | Before: warning? | After: warning? | After: exit | Root cause / action |
|---|-------|------------------|-----------------|-------------|---------------------|
| 1 | `src/hooks/useWearablePreference.test.tsx` | **YES** (and hung to the 120s timeout, rc=124) | **NO** | 0 | RQ-GC leak. Per-test `QueryClient` used finite `gcTime: 60_000` (a 60s query-GC timer) **and** the mutation cache left its default 5-min removal timer pending after every settled mutation. **Fix:** `queries.gcTime: Infinity` + `mutations.gcTime: Infinity` (never scheduled as timers) + `afterEach` that `unmount()`+`clear()`s every minted client. |
| 2 | `src/screens/client/wearables/__tests__/cards.test.tsx` | NO | NO | 0 | No `QueryClient` in test; already clean. No change. |
| 3 | `src/__tests__/coachLtvDashboard.test.tsx` | NO | NO | 0 | No `QueryClient` in test; already clean. No change. |
| 4 | `src/components/coach/ai-budget/__tests__/AIBudgetMount.test.tsx` | **YES** | **NO** | 0 | **NOT a React-Query leak.** `useAIBudget` is fully mocked (no `QueryClient` exists). `--detectOpenHandles` traced the open handle to a `setInterval` in `@sentry/react-native`'s `AsyncExpiringMap`, loaded at module import via `ErrorBoundary → services/sentry`. **Fix:** test-only `jest.mock('@sentry/react-native', ...)` inert stub so no background timer is scheduled. Assertions unchanged. |
| 5 | `src/screens/day-one/__tests__/day1OnboardingScreens.test.tsx` | NO | NO | 0 | No `QueryClient` in test; already clean. No change. |

Diagnosis detail for Suite 1: the warning persisted after `queries.gcTime: Infinity` alone; bisecting by test name showed only tests that fire a **mutation** hung, isolating the mutation-cache GC timer (RQ default 5 min) as the true open handle — resolved by `mutations.gcTime: Infinity`.

---

## Verification gates (all green — local is source of truth)

| Gate | Result |
|------|--------|
| 1. `npm ci` | exit 0 |
| 2. `npx tsc --noEmit` | exit 0 |
| 3. `npm run lint` | exit 0 (0 errors; 82 pre-existing warnings, **none in touched files**) |
| 4. Targeted: each of 5 suites individually | all exit 0 AND none print "did not exit" warning |
| 5. Full `npx jest --runInBand` | exit 0 — **224 suites / 2579 tests passed**. Overall "did not exit" warning still prints (other unrelated suites import Sentry/reanimated at module load); permitted by task. |
| 6. R0 grep battery on added lines | clean — no `forceExit`, `detectOpenHandles`, `.skip`/`.only`, `xit`/`xdescribe`, swallowed/empty catches, `console.log`, `eslint-disable`, `@ts-ignore`/`@ts-nocheck`, TODO/FIXME/HACK |

Targeted gate raw output:
```
rc=0 warn=NO | Tests: 10 passed, 10 total | src/hooks/useWearablePreference.test.tsx
rc=0 warn=NO | Tests: 11 passed, 11 total | src/screens/client/wearables/__tests__/cards.test.tsx
rc=0 warn=NO | Tests: 21 passed, 21 total | src/__tests__/coachLtvDashboard.test.tsx
rc=0 warn=NO | Tests:  4 passed,  4 total | src/components/coach/ai-budget/__tests__/AIBudgetMount.test.tsx
rc=0 warn=NO | Tests: 26 passed, 26 total | src/screens/day-one/__tests__/day1OnboardingScreens.test.tsx
```

---

## Constraints compliance

- TEST FILES ONLY — diff is 2 `.test.tsx` files (+45 / -3); no production source touched.
- NO `forceExit`, NO `detectOpenHandles` added to jest.config or any file (used `--detectOpenHandles` only as a transient local diagnostic, never committed).
- Test assertions unchanged in both files.
- Bradley Law #36 — no swallowed catches added (R0 grep clean).
- Author `Dynasia G <dynasia@trygrowthproject.com>`, title-only commit, no trailers.
- Used bash + git + gh with the github credential; no browser_task, no github_mcp_direct.

## CI caveat
A GitHub hosted-runner outage is in effect on this repo (jobs failing fast with empty runner_name). Per task instructions, local gates above are the source of truth; CI status will be evaluated by a separate watcher.

---

BUILD COMPLETE: 240 5f5729fb622328af1c01d7ca7b285fb85311bc7c
