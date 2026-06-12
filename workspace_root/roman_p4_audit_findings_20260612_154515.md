# Roman P4 PR #242 Audit

PR: BradleyGleavePortfolio/growth-project-mobile #242  
Branch: feature/roman-p4-ed3-ed4-showpieces  
Audited HEAD: 904c182dcc0afea8daa936c803438830229e947f  
Worktree: /home/user/workspace/tgp/audit-roman-p4

## CODE verdicts

- Checkout verified: branch is `feature/roman-p4-ed3-ed4-showpieces`; HEAD is exactly `904c182dcc0afea8daa936c803438830229e947f`.
- Dependency install: `npm ci` succeeded from the repo root.
- R0 added-line grep: only test-only `jest.mock` / mock-fixture hits; no production added-line hits for console/debugger/TODO/ts-ignore/eslint-disable/raw hex/bare spinner.
- Bradley Law #36: **NOT CLEAN**. New code includes swallowed or unhandled async failure paths.
- R69: N/A.
- R31 distinct builder/auditor: satisfied by fresh-context GPT-5.5 audit against a fresh clone.
- R66 full Jest: `npm test -- --runInBand --silent` exited `0`; 230 suites / 2607 tests passed. Jest still emitted the repo-level open-handle warning after completion.
- TypeScript: `npm run typecheck` exited `0`.
- R65 / 50-Failures sweep: **NOT CLEAN** because ED.4 is dead/unwired product surface, and ED.3 has fire-and-forget persistence around a once-only money moment.

### ED.3 evidence — First Payment Wow Screen

- Coach navigator is wrapped in `FirstPaymentWowHost`, so ED.3 is mounted at the coach shell level (`src/navigation/CoachNavigator.tsx:529-633`).
- Host subscribes through `useFirstPaymentRealtime` behind `featureFlags.romanFirstPaymentWow` and a coach id (`src/screens/coach/ed/FirstPaymentWowHost.tsx:51-55`).
- The screen renders a full-screen overlay, particle layer, prominent centered avatar, §2.6 celebration copy, and dismiss button (`src/screens/coach/ed/FirstPaymentWowScreen.tsx:95-121`).
- Particle burst uses Reanimated and documents Skia fallback rationale; Skia is not installed (`src/components/roman/ParticleBurst.tsx:5-14`, `package.json:77-80`).
- Supabase realtime listens to `public.payments` INSERTs filtered by `coach_id` (`src/screens/coach/ed/useFirstPaymentRealtime.ts:154-177`).
- Realtime cleanup exists in the effect return via `channel.unsubscribe()` and `client.removeAllChannels()` (`src/screens/coach/ed/useFirstPaymentRealtime.ts:196-207`), but `removeAllChannels()` is fire-and-forget and can reject outside the `try`.
- §2.6 copy is spec-exact for default / celebration / error in `romanFirstPayment()` (`src/lib/roman/copy.ts:62-76`) and pinned by tests (`src/lib/roman/__tests__/copy.test.ts:19-42`).

### ED.4 evidence — Progress Chart animation

- `ProgressChartCard` implements SVG + Reanimated draw-in over 1500ms (`src/screens/client/progress/ProgressChartCard.tsx:149-164`, `src/screens/client/progress/ProgressChartCard.tsx:238-248`).
- Victory Native XL is not installed; fallback to `react-native-svg` + Reanimated is documented (`src/screens/client/progress/ProgressChartCard.tsx:4-13`, `package.json:77-80`).
- Haptic scrubber emits haptics on selected data-point changes (`src/screens/client/progress/ProgressChartCard.tsx:166-203`).
- PR detection is pure Math.max/new-high logic (`src/screens/client/progress/detectPersonalRecord.ts:39-60`) and tested (`src/screens/client/progress/__tests__/detectPersonalRecord.test.ts:10-55`).
- PR commentary uses `romanPRDetected()` beside a RomanAvatar (`src/screens/client/progress/ProgressChartCard.tsx:309-316`).
- **Blocking integration gap:** no non-test production file imports or renders `ProgressChartCard`; the existing client `ProgressScreen` still renders `TgpLineChart` (`src/screens/client/ProgressScreen.tsx:490-495`).

### MMKV gate evidence

- Gate key shape is per coach: `roman.ed3.first-payment-seen.${coachId}` (`src/screens/coach/ed/firstPaymentGate.ts:22-35`).
- Unit tests prove first consult unseen, mark seen, second consult no-op, idempotence, and per-coach isolation (`src/screens/coach/ed/__tests__/firstPaymentGate.test.ts:27-65`).
- **Not actually MMKV-backed in this repo:** `react-native-mmkv` is absent from `package.json` dependencies (`package.json:29-84`), so `src/storage/mmkv.ts` falls back to AsyncStorage when `require('react-native-mmkv')` fails (`src/storage/mmkv.ts:30-39`, `src/storage/mmkv.ts:161-166`).
- Dismiss ordering is not truly enforced: the host calls `void markFirstPaymentSeen(coachId)` and immediately clears overlay state (`src/screens/coach/ed/FirstPaymentWowHost.tsx:57-63`).

### Realtime subscription cleanup evidence

- Cleanup is implemented on unmount (`src/screens/coach/ed/useFirstPaymentRealtime.ts:196-207`).
- Tests mock `unsubscribe` / `removeAllChannels` but do not assert either is called on unmount (`src/screens/coach/ed/__tests__/useFirstPaymentRealtime.test.tsx:45-69`, `src/screens/coach/ed/__tests__/useFirstPaymentRealtime.test.tsx:95-150`).
- The event-time gate recheck uses `void hasSeenFirstPayment(...).then(...)` without a rejection handler (`src/screens/coach/ed/useFirstPaymentRealtime.ts:165-174`).

### FACE+VOICE evidence

- ED.3 places the RomanAvatar directly above the §2.6 message in the same screen tree (`src/screens/coach/ed/FirstPaymentWowScreen.tsx:99-111`).
- ED.4 places the RomanAvatar in the PR commentary row beside the `romanPRDetected()` text (`src/screens/client/progress/ProgressChartCard.tsx:309-316`).
- Copy module contains only P4-owned `romanFirstPayment()` and `romanPRDetected()` additions, not overlapping P3 §2.x functions (`src/lib/roman/copy.ts:21-27`, `src/lib/roman/copy.ts:62-76`, `src/lib/roman/copy.ts:101-108`).

### Findings

#### P0

- None found.

#### P1

1. **ED.4 is not wired into the client app.** `ProgressChartCard` exists only in its own file/tests; production `ProgressScreen` still renders `TgpLineChart`, so users will not see the ED.4 draw-in, haptic scrubber, PR flag, or Roman PR commentary. Files: `src/screens/client/progress/ProgressChartCard.tsx:88`, `src/screens/client/ProgressScreen.tsx:490`.
2. **ED.3 once-only gate is not actually MMKV-backed.** `react-native-mmkv` is absent from dependencies, and the storage abstraction falls back to AsyncStorage when the require fails. Files: `package.json:29`, `src/storage/mmkv.ts:30`, `src/storage/mmkv.ts:161`.
3. **Dismiss does not wait for the gate write before clearing the overlay.** `void markFirstPaymentSeen(coachId); setEvent(null);` can clear UI before persistence succeeds, and a rejection becomes unhandled. File: `src/screens/coach/ed/FirstPaymentWowHost.tsx:61`.
4. **Bradley Law #36 is violated by swallowed/unhandled async failures.** Haptic scrubber uses an empty `.catch`, event-time `hasSeenFirstPayment()` has no rejection handler, and `removeAllChannels()` is fire-and-forget inside cleanup. Files: `src/screens/client/progress/ProgressChartCard.tsx:83`, `src/screens/coach/ed/useFirstPaymentRealtime.ts:167`, `src/screens/coach/ed/useFirstPaymentRealtime.ts:200`.

#### P2

1. **PR detected text lacks a live-region announcement.** The PR commentary `Text` has no `accessibilityLiveRegion="polite"` or `AccessibilityInfo.announceForAccessibility`, so screen-reader users may not be notified when PR commentary appears. File: `src/screens/client/progress/ProgressChartCard.tsx:313`.
2. **The §3.8 “slight_smile” expression is not mechanically represented.** New render sites use `RomanAvatar crop="smile"`, while `RomanAvatarProps` has no `expression="slight_smile"` API and tests assert the broader label `Roman, pleased`; this weakens the “knowing slight smile, never broad grin” invariant. Files: `src/components/roman/RomanAvatar.tsx:40`, `src/screens/coach/ed/FirstPaymentWowScreen.tsx:102`, `src/screens/client/progress/ProgressChartCard.tsx:312`.
3. **FirstPaymentWow dismiss touch target is not explicitly guaranteed ≥44pt.** The button has padding but no `minHeight: 44` or `hitSlop`; current computed height depends on platform text metrics. File: `src/screens/coach/ed/FirstPaymentWowScreen.tsx:148`.

## UX verdicts

- ED.3 visual hierarchy is strong: centered full-screen overlay, prominent 132px avatar, calm copy, and high-contrast ink-on-bone text.
- ED.3 reduce-motion is handled through the shared AccessibilityInfo-backed hook and suppresses particles / scale motion (`src/screens/coach/ed/FirstPaymentWowScreen.tsx:67-81`, `src/components/roman/ParticleBurst.tsx:147-156`).
- ED.3 color contrast passes: ink on bone is ~15.23:1; button bone on forest is ~8.57:1.
- ED.4 reduce-motion is handled by rendering a static SVG path and setting draw progress to 1 (`src/screens/client/progress/ProgressChartCard.tsx:149-160`, `src/screens/client/progress/ProgressChartCard.tsx:223-248`).
- ED.4 performance is acceptable for 100 points by inspection: geometry and path length are memoized O(n), haptic emissions are gated by selected-index crossover, and no per-frame React state is used for the draw-in.
- UX is **NOT CLEAN** because ED.4 is not reachable in the client app, PR commentary lacks a live-region announcement, and the smile-expression invariant is not exact/mechanical.

CODE VERDICT: NOT CLEAN
UX VERDICT: NOT CLEAN
