# PR #123 — Audit Round 1 (post-typecheck fixes)

**Branch:** `feat/phase-11-workout-builder`
**Scope of this audit:** The 6 files I changed to make the Typecheck step green again. Reviewed as a strict senior-staff engineer would, against ENGINEERING_RULES.md and the AI-coding failure-pattern checklist (race conditions, hydration timing, conditional hooks, missing useEffect deps, swallowed errors, missing awaits, `any` types, ts-ignore, raw error codes surfaced to users, WCAG AA contrast, never-shrink-features).

The user's PR-original commits (workout-builder screen + tokens + tests) were already through two GPT-5.5 audit rounds and a dark-mode contrast fix; I did not modify them in round 1 except for the cross-cutting type fixes below. I revisited them as part of the audit and call out anything that bears mention.

---

## A. Findings on my changes

### A1. `src/api/invites.ts` — `resendInvite` signature

- **Change:** Made `email` an optional second argument. Body becomes `{}` when the caller has no email to override.
- **Audit:**
  - ✅ Backwards-compatible at the call site that uses `(id)` only, and at the existing `(id, email)` form.
  - ✅ JSDoc updated — the intent shift (optional override, not mandatory) is documented so a future reader doesn't reintroduce the required `email`.
  - ✅ No `any`, no ts-ignore, no swallowed errors (the `isNotFound` branch is a deliberate `{ supported: false }` contract, not a silent swallow).
  - ⚠ **Risk:** If the backend's `POST /coach/invite-codes/:id/send` actually requires the `email` field in the body (rather than resolving it server-side), sending `{}` will 400. The mobile error handler shows `response.data.message`, so the user sees a structured message rather than a crash — but the feature would silently fail.
  - **Mitigation:** The only live caller (`CoachInvitesScreen`) now always passes `invite.clientEmail`. The `{}` branch only fires when `clientEmail` is `undefined`, which per the `Invite` type is the case for invite-code-only invites that the backend has no email for in the first place. So the `{}` path is the only sensible thing to send — the backend cannot be expecting an email it never had.
  - **Verdict:** Acceptable. No fix required, but flagged.

### A2. `src/screens/coach/CoachInvitesScreen.tsx` — pass `invite.clientEmail`

- **Change:** Pass the invite's email to the resend call.
- **Audit:**
  - ✅ Preserves prior behaviour for the common case (the invite has an email).
  - ✅ No new hook calls, no useEffect changes, no new conditional rendering — no hook-rules / hydration risk.
  - ✅ Error message rendering still uses `errorMessage(err, 'Unknown error')` — Rule 3 (mobile errorMessage) preserved.
  - **Verdict:** Clean.

### A3. `src/services/aiGatewayClient.ts` — `meta` typed + `narrowDisabledReason` helper

- **Change:** Added `meta?: { reason?: string }` to the typed response and a `narrowDisabledReason()` helper that maps the server's string into the strict enum. Unknown values fall through to `feature_flag_off`.
- **Audit:**
  - ✅ Removes the previous `data.meta as { reason?: string } | undefined` cast — no more inline `as` to a structural type. Replaced with proper typed field on the response.
  - ✅ The fallback `'feature_flag_off'` is the safest disabled state: it matches the mobile fail-closed default, won't accidentally render rate-limit copy when the backend was actually role-denied, won't trip "kill switch" telemetry.
  - ⚠ **Behavioural change:** previously, an unknown server reason became the literal string `'ai_unavailable'`, which was a type error in the discriminated union — the UI's `switch` on `reason` would not have matched it. Now it maps to `'feature_flag_off'`, which the UI handles. So this is a strict improvement to the fail-closed posture, not a regression.
  - ✅ No `any`, no swallowed errors. The `narrowDisabledReason` function is exhaustive on the union; if `AIGatewayDraftDisabled['reason']` ever gains a new value, TS will not flag it (the function returns the input directly), but the default arm covers safety.
  - **Verdict:** Clean. The narrower-than-needed exhaustiveness is acceptable since the function's job is "narrow untrusted server input."

### A4. `src/services/commandCenterApi.ts` — `getLtvMetrics`

- **Change:** Added the missing `getLtvMetrics` method that `OverviewScreen.tsx:224` already calls.
- **Audit:**
  - ✅ Mirrors the failure posture of the other 5 methods in this file: try the GET, on failure return a zero-valued dataset so the dashboard renders its empty state instead of error-noise.
  - ✅ Path `/coach/command-center/ltv-metrics` matches the path the inline `fetchLtvMetrics` function in `CoachLtvDashboard.tsx` was already calling — so live behaviour is unchanged.
  - ✅ Type imported from `CoachLtvDashboard.tsx` (where `LtvMetrics` is `export interface`), so we don't fork the type.
  - ⚠ **Smell:** the rich fallback object hard-codes every field of `LtvMetrics` (~20 fields). If `LtvMetrics` gains a new required field, this fallback breaks the build — which is the correct behaviour, but worth knowing.
  - ⚠ **Smell:** the `try/catch` silently swallows the actual failure. The other 5 methods do the same. Engineering rule 3 ("errors must surface as structured user-friendly messages") is satisfied by the dashboard component's own error state when it sees zero data, but a `__DEV__`-only `console.warn` for telemetry would be marginally better. **Will fix in round 2.**
  - **Verdict:** Acceptable. Will add a dev-only warn in round 2 to keep parity with how the rest of the codebase handles network failures.

### A5. `src/ui/empty-states/EmptyStateNoClients.tsx` — `Clipboard` import + prop rename

- **Change 1:** Imported `expo-clipboard` instead of the deprecated `react-native` Clipboard. The previous `Clipboard.setStringAsync` call did not exist on the RN type; the previous fallback cast (`as unknown as { setString }`) is now dead and removed.
- **Change 2:** Renamed `onGoToSettings` → `onInvite` (the prop name the two existing call sites and the test already used), kept the rest of the component shape, added `testID="empty-state-headline"` and renamed the CTA testID to `empty-state-cta` to match the shared empty-state contract.
- **Audit:**
  - ✅ Never-shrink-features: all three states (loading skeleton / loaded share+copy / notfound settings nudge) preserved. Only the prop name changed.
  - ✅ Removed an `unknown as` cast — type safety improved.
  - ✅ Hook rules: `useEffect`, `useState`, `useCallback`, `useMemo` order unchanged. No conditional hook calls. No new race conditions introduced.
  - 🚨 **Pre-existing AI-failure-pattern (not introduced by my change but visible in the diff):** the `useEffect` on line 96 has an empty dep array `[]` even though the closure reads `code` (line 90). The lint warning calls this out:
      > `React Hook useEffect has a missing dependency: 'code'.`
      In practice, mount-only is the intended behaviour (the effect is the one-time hydrator). Adding `code` to the deps would re-run the network fetch every time `code` changes, which is a bug. The correct fix is to read `code` from a ref to silence the warning without changing behaviour, or to inline the optimistic-vs-network race. **This pre-dates this PR, was flagged by GPT-5.5 round 2 but not fixed.** I will fix it in round 2.
  - 🚨 **Pre-existing AI-failure-pattern:** `loading` state variable is declared but never read (lint warning). It is set in the effect's `finally` but no branch reads it; the `state` enum already drives the three views. Dead state. **I will remove it in round 2.**
  - ⚠ The `accessibilityLabel` for the CTA says "Go to Settings to create an invite code" but now the prop is generically named `onInvite` and a parent might wire it to something other than Settings. The label is still meaningful (the visible text is "GO TO SETTINGS"), and parent screens that pass `onInvite={() => navigation.navigate('InviteCodes')}` are doing exactly that — routing into the invite-code surface. Acceptable. **No fix.**
  - ✅ WCAG AA: text colors use theme tokens (`colors.textPrimary`, `colors.textSecondary`, `colors.textMuted`, `colors.textOnPrimary`). These tokens are the source of the dark-mode contrast fix that commit `a56f7fc` already shipped; this PR doesn't change them.

### A6. `src/ui/empty-states/__tests__/EmptyState.test.tsx` — updated test expectations

- **Change:** Updated the two `EmptyStateNoClients` tests to (a) match the actual headline copy the component renders ("Your first client is one link away.") and (b) await the `notfound` branch since the component starts in `loading`. Added top-level `jest.mock` calls for `services/api`, `storage/mmkv`, `expo-clipboard`, `expo-haptics` so the component renders deterministically without spinning up native modules.
- **Audit:**
  - ✅ No `.skip`, no test was deleted, no test asserts less than before. The new tests verify the headline copy AND the CTA wiring — strictly more coverage than the originals, which checked an outdated headline string.
  - ✅ Mocks are at module top level (hoisted by babel-jest), so they apply to all tests in the file equally and don't break the other 17 tests' React reconciler state. (My first attempt used `jest.resetModules()` inside `beforeEach`, which broke React's hook context for sibling describes — caught and corrected before this round.)
  - ✅ The mock of `coachApi.listInviteCodes` resolves with `{ data: [] }`, which is exactly the path that drives the component to `state === 'notfound'` and renders the CTA. The test reflects production behaviour for a coach with no live invite codes.
  - **Verdict:** Clean.

---

## B. Findings on the workout-builder PR's own files (re-audit)

I re-read the four PR-original files even though they passed two prior GPT-5.5 rounds: `CoachWorkoutBuilderScreen.tsx`, `__tests__/CoachWorkoutBuilderScreen.test.tsx`, `theme/tokens.ts`, `CoachNavigator.tsx`, `ClientsListScreen.tsx`.

- ✅ The most-recent commit `a56f7fc` introduces `errorOnLight` / `errorOnDark` semantic tokens and switches the workout-builder error text to them — meets WCAG AA 4.5:1 in both modes (confirmed in tokens.ts).
- ✅ Commit `44bfa0b` ("block save during hydration") is the correct fix for the hydration-race AI failure pattern: save is gated on `!isHydrating`, preventing the empty-form-overwrites-real-data class of bug.
- ✅ Commit `1bae83b` rejects zero/negative numeric inputs at the form layer rather than relying on the backend — defensive depth.
- ✅ No `@ts-ignore`, no `any`, no `eslint-disable` in the PR-original files.
- ⚠ One nit: `CoachWorkoutBuilderScreen.tsx` is now over 500 lines. Worth a future split (search panel, form panel, hydration hook) but not blocking.

---

## C. Out-of-scope test failures inherited from `main`

`npm test` against `main` produces 15 failing suites that have nothing to do with the workout-builder PR or my type-fixes:

| Suite | Root cause (one-liner) |
|---|---|
| `DeleteAccountScreen.test.tsx` | Alert copy changed; test still asserts the old substring. |
| `bulkInviteScreen.test.tsx` | Submission flow uses a different mutation path than the test expects. |
| `Day1WinScreen.test.tsx` | onComplete wiring changed; test expects 1 call, gets 0. |
| `quietLuxuryDoctrine.test.ts` | A different feature (active-workout styles) introduced fontWeight 700/800 and 3 TODO comments; this cross-cutting linter test now flags them. |
| `paymentsConnectPackages.test.ts` | Live API URLs and payload shapes diverged from the test's expectations (`/v1/checkout/sessions` vs `/v1/clients/me/coach/checkout`, `tgp://` vs `com.growthproject.app://`). Test, not code, looks correct per ENGINEERING_RULES rule 1+9 — but **changing the live URLs would break the production payments path**. Out of scope; needs backend coordination. |
| `tgpCharts.test.tsx` | Tooltip palette assertion against the bone token — chart source changed. |
| `aiGatewayClient.test.ts` | Test expects `/ai/gateway/drafts`; the live client calls `/ai/gateway/invoke`. Backend contract divergence (the design doc cited in the file's header doc-comment also says `invoke`, so the test is the stale one). |
| `leanOnboardingFlow.test.ts` | Source-file regex scanning test that expects strings the source no longer contains. |
| `DataExportScreen`, `conciergePhase1`, `wave11Screens`, `TimelineScreen`, `notificationCenter`, `exerciseCatalog`, `RiskBoardScreen` | Mix of stale copy, stale endpoint paths, and tests that rely on env vars/feature-flags not set in the Jest harness. |

**All 15 also fail when I run `npm test` against `origin/main` HEAD.** None of these are introduced or aggravated by this PR. Fixing all of them would expand this PR's scope by 10–20x and at least 4 of them (payments, AI gateway, etc.) would require changing production API contracts — which is exactly the "destructive shortcut" the rules tell me to avoid.

**Action:** Reporting these in the final PR comment so an owner can triage them separately. Not blocking this PR's merge — the PR's CI failed at Typecheck (which is fixed); when Test starts running, the same 15 failures will be present as they are on `main` and have been for at least several recent merges (see `gh run list --branch main`, every recent main CI run is `failure`).

---

## D. Items I will fix in round 2

From section A above, two items I caught in the audit that I will fix before requesting a second pass:

1. **`commandCenterApi.getLtvMetrics`** — add a `__DEV__`-only `console.warn` in the catch so silent network failures leave a breadcrumb in dev, matching the codebase's pattern in `CoachLtvDashboard.tsx:471`.
2. **`EmptyStateNoClients`** — remove the unread `loading` state variable (dead code per rule 7), and refactor the `useEffect` so the `code` reference in the catch branch reads from a ref instead of the closure, eliminating the missing-deps lint warning without re-triggering the effect.

Both are small, behaviour-preserving cleanups.
