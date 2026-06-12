# MWB-4 Mobile — Tier-1 CI Fixer Report (PR #237)

**Fixer:** Dynasia G <dynasia@trygrowthproject.com>
**Repo:** BradleyGleavePortfolio/growth-project-mobile
**Branch:** `feature/mwb-4-mobile-autosave`
**Scope:** Tier-1 CI-RED fix — the 3 mobile test failures only (no audit; R31 separation of duties in force).

## HEAD SHAs

| Stage | SHA |
|---|---|
| Pre-fix HEAD (PR head as briefed) | `77cd3b4a001b66fbbfdb3577457f42c5d7d513b2` |
| Mobile main (rebased onto) | `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136` |
| Post-fix HEAD (pushed) | `c1120e127403446afe89634242eebc100dde7977` |

Branch was rebased onto current `origin/main` (`79c0a9be`) and force-pushed with `--force-with-lease`. Two `.feature`-vs-`.test` conflicts on shared append-only files were resolved keeping **both** sides:
- `src/config/featureFlags.ts` — kept main's `communityAcks` flag **and** the PR's `mwbAutosave` flag.
- `.env.example` — kept both `EXPO_PUBLIC_FF_COMMUNITY_ACKS` and `EXPO_PUBLIC_FF_MWB_AUTOSAVE`.

## The 3 failures — fixes (test-only)

| # | File:line evidence | Root cause | Fix (test-only) |
|---|---|---|---|
| 1 | `src/hooks/__tests__/useAutosave.test.tsx` — suite-failed-to-run; `expo-modules-core/src/Platform.ts:10` via `jest-expo/src/preset/setup.js:234`: `TypeError: Cannot read properties of undefined (reading 'select')` | The file's existing `jest.mock('react-native', …)` returned only `{ AppState }`, so `Platform` was `undefined`. `expo-modules-core/Platform.ts` eagerly reads `ReactNativePlatform.select` during the jest-expo preset's `expo`-winter `fetch` install, throwing before any test could run. | Extended the existing `react-native` mock with a minimal `Platform: { OS: 'ios', select: (obj) => 'ios' in obj ? obj.ios : obj.default }`. No production change, no casts. |
| 2 & 3 | `src/__tests__/coachWorkoutBuilderAutosave.test.tsx` — `Invalid hook call` → `Cannot read properties of null (reading 'useMemo')` at `CoachWorkoutBuilderScreen.tsx:115` | `setFlag()` called `jest.resetModules()` mid-test so the screen would re-read the flag env var. The post-reset `require` of the screen resolved a **fresh React**, while the module-scope `@testing-library/react-native` import was bound to the **pre-reset React** → two React copies → null hook dispatcher → `useMemo` throws. (`npm ls react` confirms a single install — this was a runtime double-instance from `resetModules`, not a dependency dup.) | Removed `jest.resetModules()` entirely. The screen reads `featureFlags.mwbAutosave` **at render time** (`CoachWorkoutBuilderScreen.tsx:206`, a live property access in `autosaveEnabled`), so a module-scope `jest.mock('../config/featureFlags', …)` whose `mwbAutosave` getter reflects the current env var flips the flag between tests with a single React instance and RTL's auto-cleanup intact. The pill assertion now drives a real edit so autosave status leaves `idle` (the pill is intentionally hidden while `idle` per `AutosaveStatusPill.tsx:130-131`). Screen/hook/debounce/ULID/offline-mirror/409 logic untouched. |

Diff footprint: 2 files, +56 / -8.

## Gate results (worktree, post-rebase at `c1120e1`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** (exit 0; no pre-existing TS1010 surfaced) |
| `npx eslint src/` | **0 errors** (83 pre-existing warnings, none in the two changed files; the two files lint clean individually) |
| `npx jest --runInBand --testPathPattern "useAutosave\|coachWorkoutBuilderAutosave"` | **green — 2 suites / 10 tests passed** |
| `npx jest --runInBand --testPathPattern "quietLuxuryDoctrine\|flagOff"` (R70 fail-fast) | **green — 4 suites / 26 tests** |
| `npx jest --runInBand` (full suite, R66) | **green — 213 suites / 2370 tests / 5 snapshots passed, 0 failed** |
| R69 schema invariant — `git diff origin/main..HEAD -- '**/*.prisma'` | **EMPTY** (no Prisma in mobile) |

CI run `27402531352` (head `c1120e1`) log confirms: `Test Suites: 213 passed, 213 total`, `Tests: 2370 passed, 2370 total`, with both `PASS src/hooks/__tests__/useAutosave.test.tsx` and `PASS src/__tests__/coachWorkoutBuilderAutosave.test.tsx`.

## R65 / 50-Failures sweep (on my authored lines — `46b8e03..c1120e1`)

| Category | Result |
|---|---|
| #36 silent failure / Bradley Law (empty/silent `.catch`, `catch(e){}`) | 0 |
| R0: `as any` | 0 |
| R0: `as unknown as` | 0 |
| R0: `@ts-ignore` / `@ts-expect-error` | 0 |
| R0: `eslint-disable` (newly added) | 0 |
| R0: `TODO` / `FIXME` | 0 |
| R0: "Coming soon" | 0 |
| R0: `sonnet` literal | 0 |
| R0: raw hex outside tokens | 0 (the `#fff`-style mock palette is pre-existing in the feature commit, not added by me) |
| R0: pictograph emoji | 0 |
| #3 input validation / #28 race conditions — debounce + 409 invariants preserved | Yes — no debounce/AppState-force-flush/409 logic touched; tests still exercise mirror-first + 409 fast-forward |
| Skipped tests (`.skip`/`.only`/`xit`/`xtest`) | 0 |
| FACE+VOICE — Roman copy touched? | No Roman copy touched → RomanAvatar check N/A |

## PR body

Updated via `gh api --method PATCH /repos/BradleyGleavePortfolio/growth-project-mobile/pulls/237` (NOT `gh pr edit`) — appended a "Tier-1 CI fix" section describing both fixes and the green gates.

## CI confirmation — `gh pr checks 237`

`Typecheck, lint, test` → **fail**, but NOT because of the 3 target failures or any test:

- **All 2370 tests pass** (the 3 briefed failures are fixed and verified green in CI).
- The Test step exits 1 solely due to **`Jest did not exit one second after the test run has completed`** — a **pre-existing open-handle leak** unrelated to MWB-4.

### Pre-existing blocker (OUT OF SCOPE — flagged for parent / audit)

`npx jest --runInBand --detectOpenHandles` pinpoints the leak as **React-Query GC `setTimeout` timers** scheduled by `@tanstack/query-core` (`removable.ts:scheduleGc` → `timeoutManager.ts:setTimeout`) in test files that create a `QueryClient` without `gcTime: Infinity`/teardown. Confirmed sources include (none MWB-4):
- `src/hooks/useWearablePreference.test.tsx`
- `src/screens/client/wearables/__tests__/cards.test.tsx`
- `src/__tests__/coachLtvDashboard.test.tsx`
- `src/components/coach/ai-budget/__tests__/AIBudgetMount.test.tsx`
- `src/screens/day-one/__tests__/day1OnboardingScreens.test.tsx`

**Evidence this is pre-existing (not introduced by this PR or my fix):** the ORIGINAL CI run `27383882280` at HEAD `77cd3b4a` already shows the identical `Jest did not exit one second after the test run has completed` followed by `Process completed with exit code 1` — it was simply co-present with the 3 real test failures. My two test files show **no** open handles under `--detectOpenHandles`.

Because R31 separation of duties is explicitly in force and this leak lives in test files unrelated to MWB-4 (and would require either touching ~5 unrelated test files or a shared `jest`-config / workflow change such as `forceExit`), I deliberately did **not** expand scope to "fix" it. The disciplined remedy (e.g. `forceExit: true` in jest config, or per-test `queryClient.clear()` / `gcTime: Infinity` in the offending suites) belongs to a separate, owner-approved change — flagging here for the parent agent to route.

## Net assessment

- **Assigned scope (3 MWB-4 failures): COMPLETE and verified green** in local + CI, with 0 production-code changes, 0 R0/Bradley violations, all gates green.
- **CI overall status: RED** only because of a pre-existing, unrelated React-Query GC open-handle leak that fails the process exit code (not any test). This pre-dates the PR and is outside the briefed 3-failure scope under R31.
