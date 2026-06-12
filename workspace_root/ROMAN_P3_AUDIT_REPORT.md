# Roman P3 audit — PR #241 (`feature/roman-p3-voice-expansion`)

Commit audited: `d79fda2837279d19d78c52119196f937bd74b507`.

## CODE verdict

### Setup and code-floor checks

| Check | Result | Evidence |
|---|---:|---|
| Repository / branch / HEAD | PASS | `feature/roman-p3-voice-expansion` at `d79fda2837279d19d78c52119196f937bd74b507`. |
| `npm ci` | PASS with audit warnings | `npm ci --prefix /home/user/workspace/tgp/audit-roman-p3` installed 1101 packages; npm reported 18 vulnerabilities, including 4 high. |
| R66 baseline `npx jest --runInBand` | FAIL | Full Jest run was killed (`exit_code: -1`, signal killed). |
| Targeted Roman P3 tests | PASS | `npx jest --runInBand src/lib/roman/__tests__/copy.test.ts src/components/roman/__tests__/romanP3Surfaces.test.tsx src/screens/coach/__tests__/CoachBriefScreenRoman.test.tsx` passed 3 suites / 147 tests. |
| R0 grep on added lines, including comments | PASS for new P3 diff | Suspicious added-line grep found the intentional `catch (err)` + `console.warn` in `src/screens/coach/CoachBriefScreen.tsx:52-56`; no added secrets, `dangerouslySetInnerHTML`, `eval`, `Date.now`, `Math.random`, `TODO`, `FIXME`, `@ts-ignore`, or `any`. |
| Bradley Law #36: zero swallowed catches | FAIL at HEAD | Changed files add no swallowed catch, but HEAD contains multiple `.catch(() => {})` / `.catch(() => undefined)` patterns; examples below. |
| R69 | N/A | Mobile app. |
| R31 distinct builder/auditor | PASS | PR commit author differs from this GPT-5.5 audit. |
| R65 50-Failures sweep | FAIL at HEAD | No new API/database/payment/auth endpoint risk in the P3 diff, but dependency audit violates supply-chain floor (#10) with 4 high vulnerabilities, and swallowed catches violate reliability/observability expectations. |

### Findings

#### P0

None found.

#### P1-CODE-01 — Full Jest baseline did not complete

- Evidence: `npx jest --runInBand` from `/home/user/workspace/tgp/audit-roman-p3` was killed with `exit_code: -1`.
- Impact: R66 requires baseline exit 0; this audit cannot certify the repository test floor.
- Note: the three new Roman P3 test files passed independently: 147/147 tests.

#### P1-CODE-02 — Bradley Law #36 fails at HEAD: swallowed catches remain

Changed P3 files add only one non-swallowed catch (`src/screens/coach/CoachBriefScreen.tsx:52-56`) that sets `briefError` and logs via `console.warn`. However, the repository at HEAD still has swallowed catch patterns, including:

| File | Line | Pattern |
|---|---:|---|
| `src/components/HeroAction.tsx` | 33 | `Haptics.impactAsync(...).catch(() => {});` |
| `src/components/PackageSelectionSheet.tsx` | 336 | `.catch(() => {});` |
| `src/components/coach/StripeSetupBanner.tsx` | 84 | `prefsStorage.set(...).catch(() => {});` |
| `src/components/coach/ai-budget/AIBudgetTutorialModal.tsx` | 144 | `.catch(() => undefined);` |
| `src/components/coach/ai-budget/AIBudgetTutorialModal.tsx` | 168 | `.catch(() => undefined)` |
| `src/navigation/RootNavigator.tsx` | 460 | `Linking.getInitialURL().then(handleUrl).catch(() => {});` |
| `src/screens/day-one/CoachPairingScreen.tsx` | 91 | `writePendingInviteCode(trimmed).catch(() => undefined);` |
| `src/services/secureStorage.ts` | 106 | `await AsyncStorage.removeItem(key).catch(() => {});` |

#### P1-CODE-03 — Dependency audit high vulnerabilities remain

- Evidence: `/home/user/workspace/roman_p3_npm_audit.json` reports 18 total vulnerabilities: 14 moderate and 4 high.
- High chain includes `@xmldom/xmldom` via `@expo/config-plugins`; npm advisory entries include XML injection and serialization DoS advisories.
- Impact: R65 / 50-Failures category #10 supply-chain floor is not clean at HEAD.

#### P2-CODE-01 — `RomanWorkoutCompleteCard` can render a celebration face with default copy if `liftName` is missing

- Evidence: `src/lib/roman/copy.ts:197-204` falls back to default copy when `mode === 'celebration'` and `liftName` is blank, but `src/components/roman/RomanWorkoutCompleteCard.tsx:34-38` still sets `crop = 'smile'` for `mode === 'celebration'`.
- Impact: a malformed caller can produce default text with celebration expression, violating expression/copy coherence.
- Fix: make `liftName` required for celebration via a discriminated union, or derive `effectiveMode` after validating `liftName` and use it for both copy and avatar.

### Per-surface FACE+VOICE evidence

| Surface | Copy evidence | Avatar evidence | Expression evidence |
|---|---|---|---|
| §2.3 Coach Brief | `src/components/roman/RomanBriefCard.tsx:17,39`; `src/lib/roman/copy.ts:51-63` | `src/components/roman/RomanBriefCard.tsx:16,43`; live screen imports card at `src/screens/coach/CoachBriefScreen.tsx:30-33` and renders at `121-132` | `src/components/roman/RomanBriefCard.tsx:34-35`: smile only on `celebration`, neutral otherwise. |
| §2.4 Client check-in | `src/components/roman/RomanCheckInNotice.tsx:15,31`; `src/lib/roman/copy.ts:83-95` | `src/components/roman/RomanCheckInNotice.tsx:14,35` | `src/components/roman/RomanCheckInNotice.tsx:30`: smile on `celebration`, neutral otherwise. |
| §2.5 New client onboarded | `src/components/roman/RomanNewClientNotice.tsx:15,34`; `src/lib/roman/copy.ts:117-129` | `src/components/roman/RomanNewClientNotice.tsx:14,38` | `src/components/roman/RomanNewClientNotice.tsx:33`: smile on `celebration`, neutral otherwise. |
| §2.7 Streak 3/7/30 | `src/components/roman/RomanStreakCard.tsx:20-24,52`; `src/lib/roman/copy.ts:158-174` | `src/components/roman/RomanStreakCard.tsx:19,56` | `src/components/roman/RomanStreakCard.tsx:46-48`: smile on `celebration`, neutral otherwise. |
| §2.8 Workout completed | `src/components/roman/RomanWorkoutCompleteCard.tsx:18,38`; `src/lib/roman/copy.ts:195-212` | `src/components/roman/RomanWorkoutCompleteCard.tsx:17,42` | `src/components/roman/RomanWorkoutCompleteCard.tsx:34-35`: smile on `celebration`, neutral otherwise; P2 mismatch possible if `liftName` missing. |
| §2.9 Voice-log confirm | `src/components/roman/RomanVoiceLogReadback.tsx:18,38`; `src/lib/roman/copy.ts:235-247` | `src/components/roman/RomanVoiceLogReadback.tsx:17,42` | `src/components/roman/RomanVoiceLogReadback.tsx:37`: smile on `celebration`, neutral otherwise. |
| §2.10 Generic error | `src/components/roman/RomanErrorBanner.tsx:24,50`; `src/lib/roman/copy.ts:272-279` | `src/components/roman/RomanErrorBanner.tsx:23,60-62` for full-screen errors; toast/banner suppresses mascot per spec table | `src/components/roman/RomanErrorBanner.tsx:60-62`: neutral when shown. |
| §2.12 Coach payout | `src/components/roman/RomanPayoutNotice.tsx:16,39`; `src/lib/roman/copy.ts:303-315` | `src/components/roman/RomanPayoutNotice.tsx:15,43` | `src/components/roman/RomanPayoutNotice.tsx:38`: smile on `celebration`, neutral otherwise. |

Toast/banner exemption: `src/components/roman/RomanErrorBanner.tsx:11-13` documents no mascot in toast mode, and `src/components/roman/RomanErrorBanner.tsx:51-62` only renders `<RomanAvatar />` when `surface === 'screen'`, matching spec §4 lines 290-292.

### Per-function spec compliance evidence

| Function | Spec excerpt | Code excerpt | Result |
|---|---|---|---:|
| `romanCoachBrief` | Spec §2.3 lines 108-113: default, record-morning celebration, and slow-source error strings. | `src/lib/roman/copy.ts:51-63` returns those three strings verbatim with `{coachName}` / `{clientCount}` substitution. | PASS |
| `romanCheckInReceived` | Spec §2.4 lines 120-126: check-in default, first check-in celebration, attachment error. | `src/lib/roman/copy.ts:83-95` returns those strings verbatim with `{clientName}` substitution. | PASS |
| `romanNewClient` | Spec §2.5 lines 132-138: roster default, roster milestone, intake transfer error. | `src/lib/roman/copy.ts:117-129` returns those strings verbatim with `{clientName}` / `{clientCount}` substitution. | PASS |
| `romanStreak` | Spec §2.7 lines 158-165: 3-day default, 7-day and 30-day celebration, tally error. | `src/lib/roman/copy.ts:158-174` returns those strings verbatim with `{firstName}` substitution. | PASS |
| `romanWorkoutComplete` | Spec §2.8 lines 171-177: workout default, PR celebration, save-failed error. | `src/lib/roman/copy.ts:195-212` returns default/error verbatim and PR verbatim when `liftName` exists; fallback avoids malformed PR text. | PASS with P2 robustness note |
| `romanVoiceLog` | Spec §2.9 lines 185-190: weight/reps readback, voice PR, parse error. | `src/lib/roman/copy.ts:235-247` returns those strings verbatim with `{weight}` / `{reps}` substitution. | PASS |
| `romanGenericError` | Spec §2.10 lines 197-203: transient default, no celebration, hard retry-exhausted error. | `src/lib/roman/copy.ts:251-279` types mode as `default | error` only and returns both strings verbatim. | PASS |
| `romanPayout` | Spec §2.12 lines 221-227: payout default, record payout, payout initiation error. | `src/lib/roman/copy.ts:303-315` returns those strings verbatim with `{amount}` / `{bankLast4}` / `{settleDays}` substitution. | PASS |
| §2.6 first payment | Spec §2.6 lines 142-152 is P4, not P3. | `src/lib/roman/copy.ts:23-24` explicitly excludes §2.6. | PASS |

### Roman-specific voice checks

- Typed copy functions exist for the eight P3 surfaces only: `src/lib/roman/copy.ts:51`, `83`, `117`, `158`, `195`, `235`, `272`, and `303`.
- No `romanFirstPayment` / §2.6 function exists in `src/lib/roman/copy.ts`.
- Forbidden-move scan of changed Roman strings found no emoji, startup slang, Gen-Z slang, fitness-bro clichés, or hype words in returned copy.
- Exclamation points appear only in spec celebration lines: `copy.ts:55`, `87`, `121`, `166`, `204`, `243`, `307`.
- Contractions in returned copy appear only in the spec payout celebration string (`month's`) and no default Roman returned string uses a forbidden contraction.
- Dry quips are not implemented in P3; comments defer quip variants until a budgeted pass, so there is no user-directed joke risk in shipped strings.

## UX verdict

### UX-floor checks

| Check | Result | Evidence |
|---|---:|---|
| Design intelligence sections read | PASS | Reviewed doctrine for emotional design, animation, reduced-motion relevance, and accessibility expectations; loaded design foundations, which requires respecting `prefers-reduced-motion`. |
| Touch targets ≥44pt for new Roman-attached affordances | PASS / N/A | New Roman P3 components render informational cards/notices, not touch controls. No new Roman-attached `Pressable` was added. |
| Reduce-motion respected on new animations | PASS / N/A | No new animation APIs, Reanimated worklets, timers, or animated values are introduced in the P3 Roman diff. |
| Live-region announcements for new dynamic copy | FAIL | Roman P3 components render dynamic copy via props/mode but do not set `accessibilityLiveRegion` / equivalent announcements; `RomanErrorBanner` uses `accessibilityRole="alert"`, but the other dynamic Roman surfaces do not. |
| Toasts/banners mascot rule | PASS | `RomanErrorBanner` suppresses the avatar by default in toast mode and only shows it for full-screen error surfaces (`src/components/roman/RomanErrorBanner.tsx:51-62`). |

### UX findings

#### P1-UX-01 — Dynamic Roman copy is not announced via live regions

The new Roman P3 surfaces compute user-visible copy from props and modes, but they do not mark the copy containers as live regions. A screen-reader user may miss a mode/copy change such as voice-log readback, streak update, payout state, or brief error.

Affected files/lines:

| File | Copy line | Current accessibility evidence |
|---|---:|---|
| `src/components/roman/RomanBriefCard.tsx` | 39, 44-46 | `accessibilityRole="summary"` / `text`, no live region. |
| `src/components/roman/RomanCheckInNotice.tsx` | 31, 36-38 | `summary` / `text`, no live region. |
| `src/components/roman/RomanNewClientNotice.tsx` | 34, 39-41 | `summary` / `text`, no live region. |
| `src/components/roman/RomanPayoutNotice.tsx` | 39, 44-46 | `summary` / `text`, no live region. |
| `src/components/roman/RomanStreakCard.tsx` | 52, 57-59 | `summary` / `text`, no live region. |
| `src/components/roman/RomanVoiceLogReadback.tsx` | 38, 43-45 | `summary` / `text`, no live region; this is the highest-risk case because the readback is an instant confirmation. |
| `src/components/roman/RomanWorkoutCompleteCard.tsx` | 38, 43-45 | `summary` / `text`, no live region. |

Recommended fix: add `accessibilityLiveRegion="polite"` for informational confirmations, use assertive only for urgent failures, and add tests that the dynamic Roman components carry the announcement prop. Keep `RomanErrorBanner` as `alert` for hard failures.

#### P2-UX-01 — Workout celebration face can disagree with fallback copy

Same root as P2-CODE-01: if `RomanWorkoutCompleteCard` receives `mode="celebration"` with no `liftName`, `romanWorkoutComplete` returns the default copy (`src/lib/roman/copy.ts:201-204`) while the card still renders `crop="smile"` (`src/components/roman/RomanWorkoutCompleteCard.tsx:34-42`). This can make Roman look pleased for a non-celebration line.

Recommended fix: make celebration props impossible without `liftName`, or compute `const isCelebration = mode === 'celebration' && liftName?.trim()` and use that for both copy and crop.

CODE VERDICT: NOT CLEAN
UX VERDICT: NOT CLEAN
