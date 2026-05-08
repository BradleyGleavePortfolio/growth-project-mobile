# Components

Shared, screen-agnostic UI. Anything that more than one screen renders, or anything that owns its own animation / lifecycle, lives here. Tokenised — no hardcoded hex, no inline radius / shadow values.

## Purpose

- Provide the visual primitives the screens compose with: cards, rings, bars, sheets, banners, splash, error boundary, skeleton loaders.
- Encapsulate the per-feature mini-systems that don't fit a single screen: trust-cue rails, anticipation tiles, community win cards, log modals.
- Bake the quiet-luxury motion contract in (entrance fades, hairline dividers, weight-400/500 serifs, no celebration overlays).

There is no global floating chat widget here, and no celebration / trophy chrome. The `FloatingChatWidget`, `FirstWinCelebration`, `IdentityBadge`, `TrophyArtifact`, `ComingSoonBanner`, and the duplicate `SplashScreen.tsx` were deleted in the wave-5b cleanup (#63). The doctrine forbids reintroducing them — see `docs/QUIET_LUXURY_DOCTRINE.md`. The dedicated AI surface is `src/screens/client/AIGuideScreen.tsx`.

## Key files

### Atoms / general

| File | What it does |
| --- | --- |
| `HapticPressable.tsx` | Pressable that fires a haptic on press. The right primitive for any tap that commits state. |
| `FadeInView.tsx` | Mount-time fade-in wrapper. Used for hero copy and milestone tiles. |
| `EmptyState.tsx` | Bone-on-bone empty state with serif headline + caption. |
| `ErrorBoundary.tsx` | Top-level error boundary. Reports to Sentry, renders a soft error card. |
| `SkeletonLoader.tsx` | Shimmering placeholder for list / card load. |
| `OfflineBanner.tsx` | Hairline banner shown when `useNetworkStatus` reports offline. Mounted by `RootNavigator`. |
| `OptionCard.tsx`, `MultiSelectChip.tsx` | Onboarding selection primitives. |
| `OnboardingLayout.tsx` | Header + progress + continue button frame for the legacy 10-step flow. |
| `AppSplash.tsx` | Branded splash, keyed to bone (`#F5EFE4`). Single mark + serif title fade — the duplicate `SplashScreen.tsx` was removed in #63. |

### Anticipation, community, trust

| File | What it does |
| --- | --- |
| `MilestoneList.tsx`, `HeroAction.tsx` | Home-tab hero composition + milestone list (date · note rows; single fade, no celebration). |
| `anticipation/CountdownTile.tsx`, `MilestoneProgress.tsx` | "Healthy anticipation" surfaces — the next-milestone preview. |
| `community/CommunityWinCard.tsx` | Community feed primitive. |
| `trust/TrustCueRow.tsx`, `TrustExplainerSheet.tsx` | Three-chip trust rail (encrypted, data ownership, no ads). Tap opens explainer; fires `trust_cue_tapped`. |

### Logging primitives

| File | What it does |
| --- | --- |
| `log/DailySummaryBar.tsx` | Macro / calorie summary header for the Log screen. |
| `log/MealSectionCard.tsx` | Per-meal card with add-food and entry list. |
| `log/FoodSearchModal.tsx`, `FoodSearchView.tsx` | Search-and-pick modal backed by `foodApi.search`. |
| `log/QuantityPickerModal.tsx` | Quantity multiplier picker after a food is chosen. |
| `log/ManualFoodEntryForm.tsx` | Free-form entry (name, macros, serving) for foods not in the catalogue. |

### Domain-specific

| File | What it does |
| --- | --- |
| `CalorieRing.tsx`, `MacroBar.tsx`, `WaterTracker.tsx` | Hand-rolled SVG charts with no third-party chart lib. |
| `MealCard.tsx`, `FoodImage.tsx`, `ExerciseLogModal.tsx` | Per-domain primitives. |
| `DaySelector.tsx` | Horizontal day picker with `getTodayString` ergonomics. |

## Data flow

Components are mostly presentational. The one component that owns data is `OfflineBanner` — it reads `useNetworkStatus` and renders nothing when online. Everything else takes props.

## App-store / deep-link dependencies

- The splash background colour (`#F5EFE4`) declared in `app.json → expo.splash.backgroundColor` and `expo.android.adaptiveIcon.backgroundColor` must match `bone` from the theme. `AppSplash` uses the same value.
- `TrustCueRow` and `TrustExplainerSheet` provide the in-app surface that mirrors the privacy policy. Whatever copy lives in the explainer must match what the policy says — they are a sync pair.

## Security and tenancy

- Components do not read storage directly. They consume props or call `services/api` through a screen.
- The AI surface lives in `src/screens/client/AIGuideScreen.tsx` — there is no global widget. The screen sends only the user's message and short history; the backend attaches structured context. PII is never read into a prompt by the client.
- Analytics events fire from `TrustCueRow` (`trust_cue_tapped`). Payloads are PII-safe — only the cue id / event name go through `track()`.

## Environment variables

None.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Skeleton loader keeps shimmering forever | Parent never flips `loading={false}` because the underlying query is stuck | Add a 30 s timeout in the parent screen. |
| OfflineBanner never appears | `useNetworkStatus` reports `isInternetReachable: undefined` on iOS simulator | The hook treats `undefined` as online; the banner only shows on a confirmed offline state. |
| Component looks "flat" or "too quiet" | The wave-5b cleanup deliberately removed gradients, glows, shimmer, confetti, and trophy chrome | This is by design — see `docs/QUIET_LUXURY_DOCTRINE.md`. The doctrine test (`src/__tests__/quietLuxuryDoctrine.test.ts`) will reject reintroductions. |

## Tests

```bash
npm test
```

Tests for the log primitives live alongside the screen-level helpers (`utils/__tests__/log/*`). Visual components are exercised by the smoke matrix.

## Release notes

- The dedicated AI surface is `src/screens/client/AIGuideScreen.tsx`. Reach it from the **Guidance** row on `MoreScreen`. There is no global FAB / floating widget — `docs/QUIET_LUXURY_DOCTRINE.md` §6 forbids reintroducing one.
- The log primitives in `components/log` are the first thing to rev when the food-search flow changes; the offline queue contract in `services/foodLogQueue` depends on the shape of the payload they construct.
- `TrustCueRow` copy is part of the privacy review. Editing the explainer text is a release-blocking sync with the marketing privacy page.

### Auth & security

| File | What it does |
| --- | --- |
| `AppleSignInButton.tsx` | Thin wrapper around `<AppleAuthentication.AppleAuthenticationButton/>` (mandatory by Apple HIG). Renders nothing on Android or unsupported iOS configurations so call sites can drop it in unconditionally. |
| `BiometricUnlockGate.tsx` | Wraps the app shell. When the user has opted in, blocks render until `useBiometricGate` reports `unlocked`. Pass-through otherwise. |
| `BiometricUnlockSetting.tsx` | Settings row that toggles the SecureStore opt-in flag (`biometric_unlock_enabled`). Hides itself when the device has no biometrics. |

### Anticipation, community, trust

| File | What it does |
| --- | --- |
| `MilestoneList.tsx`, `HeroAction.tsx` | Home-tab hero composition + milestone list (date · note rows; single fade, no celebration). |
| `anticipation/CountdownTile.tsx`, `MilestoneProgress.tsx` | "Healthy anticipation" surfaces — the next-milestone preview. |
| `community/CommunityWinCard.tsx` | Community feed primitive. |
| `trust/TrustCueRow.tsx`, `TrustExplainerSheet.tsx` | Three-chip trust rail (encrypted, data ownership, no ads). Tap opens explainer; fires `trust_cue_tapped`. |

### Logging primitives

| File | What it does |
| --- | --- |
| `log/DailySummaryBar.tsx` | Macro / calorie summary header for the Log screen. |
| `log/MealSectionCard.tsx` | Per-meal card with add-food and entry list. |
| `log/FoodSearchModal.tsx`, `FoodSearchView.tsx` | Search-and-pick modal backed by `foodApi.search`. |
| `log/QuantityPickerModal.tsx` | Quantity multiplier picker after a food is chosen. |
| `log/ManualFoodEntryForm.tsx` | Free-form entry (name, macros, serving) for foods not in the catalogue. |

### Domain-specific

| File | What it does |
| --- | --- |
| `CalorieRing.tsx`, `MacroBar.tsx`, `WaterTracker.tsx` | Hand-rolled SVG charts with no third-party chart lib. |
| `MealCard.tsx`, `FoodImage.tsx`, `ExerciseLogModal.tsx` | Per-domain primitives. |
| `DaySelector.tsx` | Horizontal day picker with `getTodayString` ergonomics. |

## Data flow

Components are mostly presentational. The one component that owns data is `OfflineBanner` — it reads `useNetworkStatus` and renders nothing when online. Everything else takes props.

## App-store / deep-link dependencies

- The splash background colour (`#F5EFE4`) declared in `app.json → expo.splash.backgroundColor` and `expo.android.adaptiveIcon.backgroundColor` must match `bone` from the theme. `AppSplash` uses the same value.
- `TrustCueRow` and `TrustExplainerSheet` provide the in-app surface that mirrors the privacy policy. Whatever copy lives in the explainer must match what the policy says — they are a sync pair.

## Security and tenancy

- Components do not read storage directly. They consume props or call `services/api` through a screen.
- The AI surface lives in `src/screens/client/AIGuideScreen.tsx` — there is no global widget. The screen sends only the user's message and short history; the backend attaches structured context. PII is never read into a prompt by the client.
- Analytics events fire from `TrustCueRow` (`trust_cue_tapped`). Payloads are PII-safe — only the cue id / event name go through `track()`.

## Environment variables

None.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Skeleton loader keeps shimmering forever | Parent never flips `loading={false}` because the underlying query is stuck | Add a 30 s timeout in the parent screen. |
| OfflineBanner never appears | `useNetworkStatus` reports `isInternetReachable: undefined` on iOS simulator | The hook treats `undefined` as online; the banner only shows on a confirmed offline state. |
| Component looks "flat" or "too quiet" | The wave-5b cleanup deliberately removed gradients, glows, shimmer, confetti, and trophy chrome | This is by design — see `docs/QUIET_LUXURY_DOCTRINE.md`. The doctrine test (`src/__tests__/quietLuxuryDoctrine.test.ts`) will reject reintroductions. |

## Tests

```bash
npm test
```

Tests for the log primitives live alongside the screen-level helpers (`utils/__tests__/log/*`). Visual components are exercised by the smoke matrix.

## Release notes

- The dedicated AI surface is `src/screens/client/AIGuideScreen.tsx`. Reach it from the **Guidance** row on `MoreScreen`. There is no global FAB / floating widget — `docs/QUIET_LUXURY_DOCTRINE.md` §6 forbids reintroducing one.
- The log primitives in `components/log` are the first thing to rev when the food-search flow changes; the offline queue contract in `services/foodLogQueue` depends on the shape of the payload they construct.
- `TrustCueRow` copy is part of the privacy review. Editing the explainer text is a release-blocking sync with the marketing privacy page.

---

## src/ui/skeletons — Phase 11 Skeleton Loader Library

Added in Phase 11 / Track 2. A hand-rolled animated skeleton library built on
`react-native-reanimated` (already bundled with Expo SDK 51). No additional
npm dependency is required.

### Design contract

- Pulse animation: opacity oscillates between **0.4** and **1.0** over **1 500 ms**
  using `withRepeat` / `withTiming` / `Easing.inOut(Easing.sine)`.
- Colors: `tokens.colors.cream` (`#F1E8D5`) as the skeleton fill — no hardcoded hex.
- All skeletons set `accessibilityElementsHidden` so VoiceOver / TalkBack
  skips them entirely.

### Components

| File | Shape it represents |
| --- | --- |
| `Skeleton.tsx` | Primitive block — `{ width, height, borderRadius? }` |
| `SkeletonClientCard.tsx` | Coach client list card (avatar + name + email + status + chevron) |
| `SkeletonWorkoutRow.tsx` | Workout assignment row (icon + name + sets/reps + badge) |
| `SkeletonStatTile.tsx` | Dashboard stat card (icon + value + label) |
| `SkeletonProgressChart.tsx` | Bar chart placeholder (6 bars, varying heights) |
| `SkeletonProfileHeader.tsx` | Client/coach profile header (avatar + name + role + 2 stat chips) |
| `index.ts` | Barrel re-exports all six components |

### Wired screens

| Screen | Skeleton used | Condition |
| --- | --- | --- |
| `coach/CoachHomeScreen.tsx` | `SkeletonStatTile` | `isLoading && !refreshing`; also inline `dashboardLoading` metric tiles |
| `coach/ClientsListScreen.tsx` | `SkeletonClientCard` | `isLoading` — replaces `ActivityIndicator` in list area |
| `coach/ClientDetailScreen.tsx` | `SkeletonProfileHeader`, `SkeletonStatTile`, `SkeletonWorkoutRow` | `isLoading && !refreshing` |

### Tests

`src/__tests__/skeleton.test.tsx` covers:
- Source-level contract guards (no hardcoded hex, reanimated usage, a11y)
- Barrel export completeness
- RTL render of the Skeleton primitive
- Wiring assertions for all three screens

