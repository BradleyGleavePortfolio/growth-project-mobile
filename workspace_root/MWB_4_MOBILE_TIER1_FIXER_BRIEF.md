# FIXER BRIEF — MWB-4 MOBILE (PR #237) — TIER-1 CI-RED FIX

## Role and stakes

You are an Opus 4.8 **tier-1 fixer**. PR #237 (`feature/mwb-4-mobile-autosave`) is the MWB-4 mobile autosave slice (debounced ops sync + offline mirror + 409 rebase). CI is RED at HEAD `77cd3b4a` with 3 mobile test failures. The PR has NOT been audited yet — your job is **CI-green at HEAD only**. No audit findings to address. Do NOT introduce new functionality; do NOT refactor; do NOT touch anything outside what's required to make these specific tests pass. **R31 separation of duties** is in force.

## Required reading (no skim)

1. `/tmp/tgp-agent-context/specs/MASTER_WORKOUT_BUILDER_SPEC.md` §6.3–6.5 — the autosave contract you're testing against.
2. `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md` — the canonical fixer template.
3. `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md` — for the regression sweep at end.

## Setup

- Tooling: `bash` + `gh` with `api_credentials=["github"]`. **NEVER use browser tools.**
- Clone fresh to `/home/user/workspace/tgp/fixer-mwb-4-mobile`. Don't reuse stale worktrees.
- Verify HEAD at start: `gh pr view 237 --repo BradleyGleavePortfolio/growth-project-mobile --json headRefOid` should show `77cd3b4a...`.
- Mobile main has MOVED to `79c0a9be` (v2-2 merged). Rebase before final push.

## The failures (from CI run 27383882280)

### Failure 1 — `src/hooks/__tests__/useAutosave.test.tsx` — test suite failed to run

```
TypeError: Cannot read properties of undefined (reading 'select')
  at Object.<anonymous> (node_modules/expo-modules-core/src/Platform.ts:10:74)
  at node_modules/jest-expo/src/preset/setup.js:234:32
```

This is **`Platform.select` undefined** during expo-modules-core import. Root cause: the test file is importing or transitively importing a module that touches `expo-modules-core/Platform` before `react-native`'s `Platform` mock is wired. Standard fix patterns:

- Add a `jest.mock('expo-modules-core', () => require('expo-modules-core/build/__mocks__'))` or
- Add a top-of-file `jest.mock('react-native', () => ({ Platform: { OS: 'ios', select: (obj: any) => obj.ios } }))` shim, or
- Ensure the test's import order puts the `react-native` mock setup before any expo-* import — usually means `import 'react-native';` first, or move the offending imports inside the test body so they execute after the preset setup.

Find the actual fix by reading `node_modules/jest-expo/src/preset/setup.js:234` and `node_modules/expo-modules-core/src/Platform.ts:10` to understand what's expected. Apply the minimal shim. Do NOT add `as any` casts.

### Failure 2 — `src/__tests__/coachWorkoutBuilderAutosave.test.tsx` — Invalid hook call

```
TypeError: Cannot read properties of null (reading 'useMemo')
  at CoachWorkoutBuilderScreen (src/screens/coach/CoachWorkoutBuilderScreen.tsx:115:25)
```

The screen renders during the **flag-OFF invariance** test ("renders no save-state pill and fires zero autosave calls") but React itself is null. This is a classic **two-copies-of-React** issue — most likely the test is rendering with `react-test-renderer` while a hook (`useMemo`) is being called via a different React resolver. Or the `useTheme()` hook on line 114 returns something that breaks `useMemo`'s dispatcher.

Inspect:
- `src/screens/coach/CoachWorkoutBuilderScreen.tsx:113-115` — the actual `useTheme()` + `useMemo` lines.
- The test's render setup — what's the `renderHook` or `render` import? If it's `react-test-renderer` and the component uses any hook that depends on a context provider, the provider must wrap the render.
- Confirm `package.json` has a single `react` resolution: `npm ls react` in the worktree.

Apply the minimal fix — usually wrapping the render with the required provider (theme provider, query client provider, etc.) or switching the test to `@testing-library/react-native`'s `render` if it isn't already.

## Gates (RUN ALL — R66)

After the fix, in the worktree:

1. **Typecheck**: `npx tsc --noEmit` — 0 NEW errors (pre-existing expo-notifications TS1010 is allowed).
2. **Lint**: `npx eslint src/` — 0 errors.
3. **Targeted tests**: `npx jest --runInBand --testPathPattern "useAutosave|coachWorkoutBuilderAutosave"` — green.
4. **Full fail-fast lane** (R70): `npx jest --runInBand --testPathPattern "quietLuxuryDoctrine|flagOff"` < 30s.
5. **Full suite** (R66): `npx jest --runInBand` — all green.
6. **R69 schema invariant**: there should be no Prisma in mobile, but verify `git diff origin/main -- '**/*.prisma'` is EMPTY.

If any gate fails, fix the regression. Do NOT silence or skip tests.

## R65 50-Failures sweep on the diff

Run on `git diff origin/main..HEAD`:

- **#36 silent failure (Bradley Law)**: grep for `.catch(() => undefined)`, `catch(e) {}`, `catch(e) { console.log` — ZERO new lines.
- **#3 input validation, #28 race conditions** (relevant to autosave debounce + 409 rebase) — verify the test you fixed doesn't bypass the debounce timing checks or AppState force-flush invariants.
- **R0 grep battery on added lines INCLUDING comments**: `as any`, `as unknown as`, `@ts-ignore`, TODO/FIXME, "Coming soon", empty `.catch`, sonnet literal, raw hex outside tokens, pictograph emoji — ZERO.
- **FACE+VOICE check** — if you added any Roman copy, RomanAvatar must render alongside.

## Push and PR body

- Commit titles only, author `Dynasia G <dynasia@trygrowthproject.com>`, no trailers.
- Rebase onto current `origin/main` before final push. Force-push: `git push --force-with-lease origin feature/mwb-4-mobile-autosave`.
- Update PR #237 body via `gh api PATCH /repos/.../pulls/237` (NOT `gh pr edit`) with: "Tier-1 CI fix: resolved 3 test failures (Platform.select shim in useAutosave.test, theme provider wrap in coachWorkoutBuilderAutosave.test). All gates green."

## Report

Write `/home/user/workspace/MWB_4_MOBILE_TIER1_FIXER_REPORT.md`:
- Pre/post HEAD SHAs.
- Per-failure fix table with file:line evidence.
- Gate output excerpts (tsc/lint/jest pass counts).
- 50-Failures sweep one-line-per-category.
- CI confirmation: `gh pr checks 237` green.

End your completion message **exactly** as: `FIX COMPLETE: <new-sha>`

## What you must NOT do

- Do NOT modify `useAutosave` hook implementation or `CoachWorkoutBuilderScreen` logic — only the **tests** (or test setup) and the bare minimum render-time wiring (provider wrap) needed to make the existing logic testable.
- Do NOT add `as any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`.
- Do NOT skip tests (`.skip`, `.only`, `xit`, `xtest`).
- Do NOT touch the autosave debounce, ULID generation, AsyncStorage offline mirror, or 409 rebase logic — those are the audit's job, not yours.
- Do NOT use `gh pr edit` to update PR body.
- Do NOT use browser tools or `github_mcp_direct`.
