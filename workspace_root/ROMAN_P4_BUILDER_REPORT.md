# Roman P4 — ED.3 First Payment Wow + ED.4 Progress Chart — Builder Report

## Summary
Delivered the two Roman P4 "showpiece" surfaces from identity spec §2.6 onto the
`growth-project-mobile` repo. Both are flag-gated, depend on no new packages,
and introduce no schema changes (R69). All local verification gates pass.

## PR
- **PR:** #242 — https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/242
- **Title:** `feat(roman): P4 ED.3 First Payment Wow + ED.4 Progress Chart animations`
- **Branch:** `feature/roman-p4-ed3-ed4-showpieces` (base `main`)
- **HEAD SHA:** `904c182dcc0afea8daa936c803438830229e947f`
- **Base SHA:** `f1cb1018c64c37dc7aea0f42846b70d171323c96`
- **Author:** `Dynasia G <dynasia@trygrowthproject.com>` — title-only commit, no trailers (verified: empty body).
- **State:** OPEN.

## ED.3 — First Payment Wow (coach app, "THE moment")
- `src/screens/coach/ed/FirstPaymentWowScreen.tsx` — full-screen celebration overlay:
  - Reanimated radial **particle burst** (`src/components/roman/ParticleBurst.tsx`); returns null under reduce-motion; palette `[romanAccent, mutedGold, forest]`.
  - `RomanAvatar crop="smile"` (the "knowing slight smile" milestone face; accessibilityLabel "Roman, pleased").
  - Spec §2.6 **celebration** copy carrying the session's single rationed exclamation.
  - testIDs: `first-payment-wow`, `first-payment-particles`, `first-payment-avatar`, `first-payment-message`, `first-payment-dismiss`. Dismiss label `Thank you, Roman`.
- `src/screens/coach/ed/firstPaymentGate.ts` — once-only **MMKV gate** (`prefsStorage`), key `roman.ed3.first-payment-seen.${coachId}`. Helpers: `firstPaymentSeenKey`, `hasSeenFirstPayment`, `markFirstPaymentSeen`.
- `src/screens/coach/ed/useFirstPaymentRealtime.ts` — Supabase realtime subscription on `payments` INSERT, filtered `coach_id=eq.${coachId}`. Gate-checked at both subscribe time and fire time (once-only contract holds at the transport layer). Session hydrated from `secureStorage` (`supabase_token` / `supabase_refresh_token`). Lazy client creation inside the effect; the whole feature is flag-gated.
- `src/screens/coach/ed/FirstPaymentWowHost.tsx` — overlay owner; reads `useCurrentUser()`; enabled when `featureFlags.romanFirstPaymentWow && coachId`.
- Wired into `src/navigation/CoachNavigator.tsx` (host wraps `Tab.Navigator`).
- Flag: `src/config/featureFlags.ts` — `romanFirstPaymentWow` from `EXPO_PUBLIC_FF_ROMAN_FIRST_PAYMENT_WOW` (default **false**).

## ED.4 — Progress Chart animations (client app)
- `src/screens/client/progress/ProgressChartCard.tsx` — draw-in line animation, haptic scrubber (expo-haptics), personal-record **flag + glow**, and Roman commentary on PR detection.
  - testIDs: `progress-line`, `progress-pr-flag`, `progress-pr-glow`, `progress-scrubber-dot`, `progress-pr-commentary`, `progress-pr-avatar`, `progress-pr-text`. Has `reduceMotionOverride` prop.
  - Under reduce-motion renders a plain `<Path>` (not AnimatedPath) for accessibility and Jest stability.
- `src/screens/client/progress/detectPersonalRecord.ts` — `detectPersonalRecord(series)`, first strict new high via running Math.max.

## Copy (`src/lib/roman/copy.ts`)
- `romanFirstPayment({coachName, amount, clientName, mode})` — §2.6 default / celebration / error, **verbatim** spec strings.
- `romanPRDetected({liftName, weight})` — inline PR commentary (§2.8/§5 register), quip-free and exclamation-free.
- **P3/P4 coordination:** edited additively only (union merge). P4 owns §2.6 + `romanPRDetected`; P3 owns §2.3/2.4/2.5/2.7/2.8/2.9/2.10/2.12. At push time `origin/main` was still at the base SHA (P3 had not merged), so **no rebase was required**.

## Tech choices
- **Particle burst:** pure react-native-reanimated. `@shopify/react-native-skia` is not a dependency — confirmed; not added.
- **Chart engine:** react-native-svg + reanimated (the repo's existing charting engine). `victory-native` is not a dependency (documented Skia-v1 peer conflict in `src/ui/charts/index.ts` and `docs/charting.md`). **No new chart dependency added.**
- **MMKV:** `prefsStorage` from `src/storage/mmkv.ts` — async-capable; AsyncStorage shim under Jest/Expo Go, real MMKV on device.
- **Supabase client import:** switched from a dynamic `await import(...)` to a **static** `import { createClient }`, matching the repo's other realtime modules (`src/api/communityRealtime.ts`, `src/services/realtime.ts`). Rationale: the dynamic-import callback fails under Jest (`--experimental-vm-modules` not enabled), which blocked `jest.mock`; static import is the repo idiom for realtime, supabase-js is already a dependency, and the feature is flag-gated so cold-start cost is negligible.
- RomanAvatar uses `crop="smile"` (repo idiom) rather than an `expression` prop.

## MMKV once-only gate evidence
`src/screens/coach/ed/__tests__/firstPaymentGate.test.ts` and the
`FirstPaymentWowScreen` / realtime tests prove: the gate opens exactly once per
coach; a second open is a verified **no-op** (channel never reopened, callback
not re-fired). The realtime hook re-checks the gate at fire time so a payment
arriving after the celebration was already seen does not re-trigger.

## FACE+VOICE invariant evidence
Every Roman copy render-site has `RomanAvatar` in the same component tree:
- `FirstPaymentWowScreen.tsx:102` — `<RomanAvatar crop="smile" .../>` beside the `romanFirstPayment` message.
- `ProgressChartCard.tsx:312` — `<RomanAvatar crop="smile" .../>` beside the `romanPRDetected` commentary (line 314).
No other render sites of `romanFirstPayment` / `romanPRDetected` exist outside tests + copy.ts.

## Bradley Law #36 (no swallowed catches)
Every catch in the new files logs via the shared `logger` and/or surfaces
through component/hook state. No empty catch blocks (verified by grep). The
realtime hook surfaces transport failures via the returned `error` state and
`logger.error/warn`.

## Verification gates (local — source of truth during the hosted-runner outage)
1. `npm ci` — exit 0 ✅
2. `npx tsc --noEmit` — exit 0 ✅
3. `npm run lint` — exit 0 ✅ (0 errors; 82 pre-existing warnings, none in P4 files)
4. Targeted (all 6 P4 test files) — **6 suites / 28 tests pass, exit 0** ✅
5. Full `npx jest --runInBand` — **230 suites / 2607 tests pass, exit 0** ✅ (R66)
6. R0 debug-hygiene sweep — clean ✅ (no `console.*`, no `.only`/`.skip`/`fdescribe`/`fit`, no TODO/FIXME/XXX/HACK, no `debugger`, no raw hex colors, no emoji in new source files — removed one stray ✅ glyph from a copy.ts comment)

Note: R0 has no explicit definition anywhere in the repo, brief, or doctrine; it
was treated as the standard forbidden-token / debug-hygiene grep sweep.

## CI note
GitHub hosted-runner outage was active; per the brief, local gates are the
source of truth and CI was not re-dispatched.

BUILD COMPLETE: 242 904c182dcc0afea8daa936c803438830229e947f
