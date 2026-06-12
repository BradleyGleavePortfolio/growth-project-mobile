# FIXER REPORT — Roman P1 #238 reduce-motion P2

Role: FIXER (Opus 4.8). Surgical.
Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR #238 branch: `feat/roman-p1-mobile-chat`
Worktree: `/home/user/workspace/tgp/fixer-roman-p1-238-reduce-motion`
Base PR HEAD (verified): `00d8a0abee809ebe67b2fb35d54ef788ffc1cfd6`
New commit (pushed): `77424ffdfd88e7d43ad5e9ae8707a3e6660e1176`
Author: Dynasia G <dynasia@trygrowthproject.com>

## Finding addressed

R4 UX audit P2: `src/screens/client/MoreScreen.tsx:169-201` renders the client Roman
entry row through `HapticPressable` with default `disableAnimation=false`. Reduce-motion
users still received the press scale/opacity micro-animation. The audit's **preferred**
fix was to make `HapticPressable` respect reduce motion **globally** so every row (Roman
+ all others) degrades in lock-step.

## Fix (preferred / global)

`src/components/HapticPressable.tsx`
- Imported the repo's existing shared `useReduceMotion()` hook
  (`src/screens/client/wearables/components/useReduceMotion.ts`) — the canonical
  reduce-motion source of truth (mount probe + live `reduceMotionChanged` subscription,
  documented Bradley-#36 motion-on fallback). This is an established cross-pillar import
  (already used by `src/screens/coach/client-detail/WearableInsightPanel.tsx`).
- Added `const reduceMotion = useReduceMotion();` and
  `const animationDisabled = disableAnimation || reduceMotion;`.
- Gated both `animateIn()` and `animateOut()` on `animationDisabled` instead of the raw
  `disableAnimation` prop, and updated their `useCallback` deps accordingly.
- Net effect: under Reduce Motion ON, press-in/press-out run **no** `Animated.spring`
  (scale) and **no** `Animated.timing` (opacity); the scale value is never driven below
  its resting value of 1. Haptics, the button role, `onPress`, and all forwarded props
  are untouched. The explicit `disableAnimation` prop still force-disables regardless.

This fixes the Roman entry row **and every other `HapticPressable` row** automatically —
no per-row `MoreScreen` change needed.

## Regression test added

`src/components/__tests__/HapticPressable.reducedMotion.test.tsx` (new)
- Mocks the shared `useReduceMotion()` hook (the single seam) and spies on
  `Animated.timing` / `Animated.spring`.
- **Case 1 (Reduce Motion ON):** press-in + press-out fire NO `Animated.timing` and NO
  `Animated.spring`, and no spring `toValue` is < 1 (no shrink); `onPress` still fires
  once (haptic/press path preserved).
- **Case 2 (Reduce Motion OFF, positive control):** press-in DOES run the scale spring
  with `toValue` 0.97 (< 1) and the opacity timing — proving the gate is the cause and
  the test is not vacuously passing.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `eslint` (changed files, max-warnings 99999) | exit 0 |
| Targeted Jest (HapticPressable.reducedMotion + wearables/components) | 2/2 pass, exit 0 |
| HapticPressable consumer suites (RiskBoard, CreditPackCheckout, share-card) | 27/27 pass, exit 0 |
| Full `npx jest --runInBand` | 214 suites / 2476 tests pass, exit 0 |
| R0 grep on diff + new test (empty catch, forceExit, TODO/FIXME, console.log, hex, @ts-ignore, fontWeight 700+, any) | clean |

Notes: The "Jest did not exit one second after the test run" notice is informational and
pre-existing (open handles in unrelated suites); no `--forceExit` was added. The
`share-card` act() warning is pre-existing and unrelated to this change.

## Constraints

- **Bradley #36 (zero swallowed catches):** none added; the imported hook's fallback is
  documented, not silent. PASS.
- **D-012 FACE+VOICE preserved:** no Roman-voiced render sites touched. PASS.
- **D-013 RomanAvatar canonical preserved:** `RomanAvatar` untouched; MoreScreen unchanged. PASS.
- **No forceExit:** PASS.
- **R66 full Jest exit 0:** PASS (2476 tests).
- **R0 grep clean on diff:** PASS.

## Files changed

- `src/components/HapticPressable.tsx` (modified — global reduce-motion gate)
- `src/components/__tests__/HapticPressable.reducedMotion.test.tsx` (new — regression test)

## Commit / push / dispatch

- Title-only commit: `fix(community): #238 Roman P1 HapticPressable respects reduce-motion globally`
- Pushed force-with-lease (lease = `00d8a0a`, matched): `00d8a0a..77424ff` → `feat/roman-p1-mobile-chat`.
- `workflow_dispatch` 265423898 on `feat/roman-p1-mobile-chat`: dispatched (HTTP 204).
  Run `27414119786` confirmed in_progress.

FIX COMPLETE: 77424ffdfd88e7d43ad5e9ae8707a3e6660e1176
