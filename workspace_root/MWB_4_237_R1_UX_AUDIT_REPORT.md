# MWB-4 #237 R1 UX Audit Report

Auditor: independent UX auditor (not builder/fixer)
Repo: BradleyGleavePortfolio/growth-project-mobile
PR: #237
HEAD audited: c1120e127403446afe89634242eebc100dde7977
Worktree: /home/user/workspace/tgp/audit-mwb-4-r1-ux
Surface: AutosaveStatusPill + CoachWorkoutBuilderScreen autosave indicators

## Scope / Method

- Read required brief and doctrine references.
- Cloned PR #237 into the isolated audit worktree and verified HEAD is `c1120e127403446afe89634242eebc100dde7977`.
- Reviewed `src/components/workout/AutosaveStatusPill.tsx`, `src/screens/coach/CoachWorkoutBuilderScreen.tsx`, `src/hooks/useAutosave.ts`, feature flag defaults, tokens/colors, and targeted autosave tests.
- Did not modify code.
- No browser and no `github_mcp_direct` used.

## Executive Summary

NOT CLEAN. The implementation is directionally calm and avoids panic/red treatment, but it misses explicit a11y requirements and state-duration requirements from the brief. The largest blocker is that interactive offline/conflict pills are not announced via a live region and no pill state exposes `accessibilityState={{ busy: ... }}`. There are also UX correctness gaps: `saved` and `conflict` can persist indefinitely despite copy that implies a brief/active state, offline copy does not explicitly reassure that work is preserved locally, and the pill uses a non-semantic color source.

## State-by-State UX Review

| State | Result | Notes |
| --- | --- | --- |
| idle | PASS | `AutosaveStatusPill` returns `null` for `idle` (`AutosaveStatusPill.tsx:128-132`), and `useAutosave` starts in `idle` with no save on unchanged values (`useAutosave.ts:152`, `useAutosave.ts:365-382`). This matches the fixer note that idle is intentionally hidden and not stuck. |
| saving | PARTIAL | Copy is subtle (`Saving…`) and animation is reduced-motion aware (`AutosaveStatusPill.tsx:103-126`). However the rendered status lacks `accessibilityState={{ busy: true }}` despite the brief requiring busy state where relevant (`AutosaveStatusPill.tsx:217-223`). |
| saved | FAIL | Copy is calm and non-celebratory (`Saved · just now`, `checkmark-circle-outline`) with no emoji (`AutosaveStatusPill.tsx:67-77`, `AutosaveStatusPill.tsx:141-149`). But `useAutosave` sets `status='saved'` and has no timer/settle transition back to `idle`, so the saved confirmation does not appear briefly as required (`useAutosave.ts:238`, `useAutosave.ts:440-450`). |
| offline | FAIL | Treatment avoids destructive red and uses calm warning surfaces (`AutosaveStatusPill.tsx:150-159`). But the copy is only `Offline — will sync`; it does not explicitly say the work is preserved locally, which the brief requires (`AutosaveStatusPill.tsx:153`). Offline is also interactive but the Pressable branch lacks `accessibilityLiveRegion="polite"` (`AutosaveStatusPill.tsx:201-214`). |
| conflict | FAIL | Copy is not panic/destructive and does not literally imply data loss (`Edited elsewhere — refreshing`) (`AutosaveStatusPill.tsx:160-168`). However this is an interactive dangerous state and is not live-announced (`AutosaveStatusPill.tsx:201-214`); it also can remain indefinitely after `useAutosave` sets `status='conflict'` because there is no settle transition (`useAutosave.ts:261`, `useAutosave.ts:440-450`). The word `refreshing` becomes inaccurate once the refetch attempt has been triggered (`CoachWorkoutBuilderScreen.tsx:231-239`). |

## Findings

### P1 — Interactive offline/conflict pills are not announced, and busy state is missing

Evidence:
- Non-interactive states render a `View` with `accessibilityLiveRegion="polite"` (`AutosaveStatusPill.tsx:217-223`).
- Interactive states render a `Pressable` without `accessibilityLiveRegion` or `AccessibilityInfo.announceForAccessibility` (`AutosaveStatusPill.tsx:201-214`).
- No rendered branch includes `accessibilityState`; specifically the saving state never exposes `busy: true` (`AutosaveStatusPill.tsx:201-223`).

Impact:
- Screen-reader users may not be notified when the most important states (`offline`, `conflict`) appear.
- The saving state is not semantically exposed as busy, violating the brief’s a11y requirements.

Required bar:
- All state changes must be politely announced.
- `saving` should expose busy true; settled/non-busy states should expose busy false where appropriate.
- Interactive conflict/offline affordance should keep button role, hit area, clear label, and live announcement.

### P2 — `saved` confirmation is persistent, not brief

Evidence:
- `useAutosave` sets `status='saved'` after a successful 200 (`useAutosave.ts:238`).
- There is no timeout or state transition that returns `saved` to `idle`; the returned status remains whatever state was last set (`useAutosave.ts:440-450`).
- The pill then keeps rendering `Saved · Xs ago` and updates every second while saved (`AutosaveStatusPill.tsx:94-101`, `AutosaveStatusPill.tsx:141-149`).

Impact:
- The brief requires saved confirmation to appear briefly. Persistent saved chrome adds visual residue to a quiet-luxury surface and conflicts with the stated idle-hidden model.

Required bar:
- Show saved confirmation briefly, then settle back to idle/hidden unless another save-relevant state is active.

### P2 — Conflict copy/status can become stale and does not guide resolution enough

Evidence:
- The conflict label is `Edited elsewhere — refreshing` (`AutosaveStatusPill.tsx:162`).
- The conflict handler only triggers a refetch (`CoachWorkoutBuilderScreen.tsx:231-239`).
- `useAutosave` sets `status='conflict'` and does not transition it after the refetch is requested (`useAutosave.ts:261`, `useAutosave.ts:440-450`).
- The interactive a11y hint is generic retry copy: `Tap to retry syncing now` (`AutosaveStatusPill.tsx:207`).

Impact:
- The copy is calm and avoids data-loss language, but it can say “refreshing” after refreshing has completed or failed, leaving a dangerous 409 state ambiguous.
- It does not clearly guide the user through resolution beyond a generic retry hint.

Required bar:
- Conflict copy should remain calm, explicitly preserve confidence, and describe the next action/state without implying data loss.
- If the pill is tappable in conflict, the a11y hint should match conflict resolution, not generic offline retry.

### P2 — Offline copy does not explicitly reassure local preservation

Evidence:
- Offline label is `Offline — will sync` (`AutosaveStatusPill.tsx:153`).
- The brief requires the offline state to indicate work is preserved locally.

Impact:
- “Will sync” implies queued work, but does not explicitly reassure the coach that the current edits are safe on-device. In an autosave anxiety moment, that reassurance is the core UX job.

Required bar:
- Offline copy should calmly communicate local preservation and later sync without alarm language or red/destructive treatment.

### P2 — Quiet-luxury semantic-token invariant is not fully met

Evidence:
- `AutosaveStatusPill` imports `Colors` from `../../constants/colors` (`AutosaveStatusPill.tsx:49`).
- The offline foreground color uses `Colors.offlineBanner` instead of the semantic token set already imported (`AutosaveStatusPill.tsx:155`).
- Added test mock lines contain raw hex color literals outside `src/theme/tokens.ts` (`src/__tests__/coachWorkoutBuilderAutosave.test.tsx:61-72`).

Impact:
- Runtime pill styling mostly uses semantic surfaces, but the offline foreground bypasses the semantic token system.
- The added raw hex test mock violates the brief’s “NO raw hex outside `src/theme/tokens.ts`” added-line invariant, even though it is not runtime UI.

Required bar:
- Use semantic tokens only for the pill surface.
- Avoid raw hex literals in added lines outside the token source, including test mocks when strict invariant checks are in scope.

## Positive Notes

- Feature flag default is OFF as required: `mwbAutosave: readFlag('EXPO_PUBLIC_FF_MWB_AUTOSAVE', false)` (`src/config/featureFlags.ts:142-158`), and `.env.example` sets `EXPO_PUBLIC_FF_MWB_AUTOSAVE=false` (`.env.example:102-106`).
- Idle hidden behavior is intentional and correctly avoids UI residue before edits (`AutosaveStatusPill.tsx:128-132`, `CoachWorkoutBuilderScreen.tsx:364-376`).
- Saving motion is reduced-motion aware via `useReduceMotion()` and suppresses the pulse when reduce motion is enabled (`AutosaveStatusPill.tsx:92`, `AutosaveStatusPill.tsx:103-126`).
- Offline/conflict use warning/calm surfaces rather than destructive red (`AutosaveStatusPill.tsx:150-168`).
- No pictograph emoji found in the runtime pill/screen autosave indicator copy.
- Font weight added in the pill is `600`, within the stated maximum (`AutosaveStatusPill.tsx:251-253`).
- Interactive pill tap target declares `minHeight: 48` (`AutosaveStatusPill.tsx:245-249`).
- No Roman voice attribution was introduced in this surface; the pill copy is system-status microcopy, and no RomanAvatar requirement is triggered.

## Validation Notes

- Attempted targeted tests: `npm test -- --runInBand src/__tests__/coachWorkoutBuilderAutosave.test.tsx src/hooks/__tests__/useAutosave.test.tsx`.
- Tests could not run in this isolated worktree because dependencies are not installed (`jest: not found`). Static review was completed instead.

## Merge Bar Assessment

Standard P0+P1+P2 CLEAN is not met. There is at least one P1 a11y blocker and multiple P2 UX/quiet-luxury issues on the audited surface.

VERDICT: NOT CLEAN
