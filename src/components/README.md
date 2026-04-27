# Components

Shared, screen-agnostic UI. Anything that more than one screen renders, or anything that owns its own animation / lifecycle, lives here. Tokenised — no hardcoded hex, no inline radius / shadow values.

## Purpose

- Provide the visual primitives the screens compose with: cards, rings, bars, sheets, banners, splash, error boundary, skeleton loaders.
- Hold the floating AI chat surface that overlays most client tabs.
- Encapsulate the per-feature mini-systems that don't fit a single screen: trophy artifacts, trust-cue rails, anticipation tiles, community win cards, log modals.
- Bake the quiet-luxury motion contract in (entrance fades, gold shimmer for founding badges, hairline dividers, weight-400 serifs).

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
| `ComingSoonBanner.tsx` | Inline "we hear you" banner for features not yet wired up. |
| `OptionCard.tsx`, `MultiSelectChip.tsx` | Onboarding selection primitives. |
| `OnboardingLayout.tsx` | Header + progress + continue button frame for the legacy 10-step flow. |
| `SplashScreen.tsx`, `AppSplash.tsx` | Native splash bridge + branded splash, both keyed to bone (`#F5EFE4`). |

### Identity, trophy, anticipation, community, trust

| File | What it does |
| --- | --- |
| `IdentityBadge.tsx` | Pill badge for the founding-rank label. Gold accent + one-shot shimmer for founding members; neutral for everyone else. Tap opens a sheet explaining the tier. |
| `MilestoneList.tsx`, `HeroAction.tsx` | Home-tab hero composition + milestone list. |
| `FirstWinCelebration.tsx` | Modal celebration for the first qualifying log of the week. |
| `trophy/TrophyArtifact.tsx` | Minimal trophy card used by `TrophyShareScreen`. Renders streak, badge, or identity-title kinds. |
| `anticipation/CountdownTile.tsx`, `MilestoneProgress.tsx` | "Healthy anticipation" surfaces — the next-milestone preview. |
| `community/CommunityWinCard.tsx`, `BadgeCabinet.tsx` | Community feed primitives. |
| `trust/TrustCueRow.tsx`, `TrustExplainerSheet.tsx` | Three-chip trust rail (encrypted, data ownership, no ads). Tap opens explainer; fires `trust_cue_tapped`. |

### Logging primitives

| File | What it does |
| --- | --- |
| `log/DailySummaryBar.tsx` | Macro / calorie summary header for the Log screen. |
| `log/MealSectionCard.tsx` | Per-meal card with add-food and entry list. |
| `log/FoodSearchModal.tsx`, `FoodSearchView.tsx` | Search-and-pick modal backed by `foodApi.search`. |
| `log/QuantityPickerModal.tsx` | Quantity multiplier picker after a food is chosen. |
| `log/ManualFoodEntryForm.tsx` | Free-form entry (name, macros, serving) for foods not in the catalogue. |

### AI Guide overlay

| File | What it does |
| --- | --- |
| `FloatingChatWidget.tsx` | Persistent button (bottom-right) that opens the AI Guide as a modal overlay. Calls `aiApi.chat`. Hidden on profile-like screens by `RootNavigator`. |

### Domain-specific

| File | What it does |
| --- | --- |
| `CalorieRing.tsx`, `MacroBar.tsx`, `WaterTracker.tsx` | Hand-rolled SVG charts with no third-party chart lib. |
| `MealCard.tsx`, `FoodImage.tsx`, `ExerciseLogModal.tsx` | Per-domain primitives. |
| `DaySelector.tsx` | Horizontal day picker with `getTodayString` ergonomics. |

## Data flow

Components are mostly presentational. The two that own data are:

- `FloatingChatWidget` — owns its message list locally. Sends through `aiApi.chat`. Visibility is controlled by the parent (`RootNavigator`).
- `OfflineBanner` — reads `useNetworkStatus`. Renders nothing when online.

Everything else takes props.

## App-store / deep-link dependencies

- The splash background colour (`#F5EFE4`) declared in `app.json → expo.splash.backgroundColor` and `expo.android.adaptiveIcon.backgroundColor` must match `bone` from the theme. `AppSplash` and `SplashScreen` use the same value.
- `TrustCueRow` and `TrustExplainerSheet` provide the in-app surface that mirrors the privacy policy. Whatever copy lives in the explainer must match what the policy says — they are a sync pair.

## Security and tenancy

- Components do not read storage directly. They consume props or call `services/api` through a screen.
- `FloatingChatWidget` sends only the user's message (and history) — same contract as `AIGuideScreen`. It does not read PII into a prompt.
- `IdentityBadge` reads founding rank from `usersApi.getFoundingNumber`; the response carries no sensitive fields.
- Analytics events fire from `TrustCueRow` (`trust_cue_tapped`) and a few celebration components (`first_win_shown`). Payloads are PII-safe — only the cue id / event name go through `track()`.

## Environment variables

None.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| AI widget overlaps a More-tab screen | The screen name was added without updating the `hideWidget` check in `RootNavigator` | Add the screen name to the hide list. |
| Trophy artifact looks "flat" | Wave 1 deliberately removed gradients / glows for the luxury repositioning. | This is by design. |
| Skeleton loader keeps shimmering forever | Parent never flips `loading={false}` because the underlying query is stuck | Add a 30 s timeout in the parent screen. |
| OfflineBanner never appears | `useNetworkStatus` reports `isInternetReachable: undefined` on iOS simulator | The hook treats `undefined` as online; the banner only shows on a confirmed offline state. |
| Identity badge shimmers on every focus | Animation `useEffect` depends on a prop that changes every render | The animation is a one-shot on mount; do not pass `key={Math.random()}` or similar. |

## Tests

```bash
npm test
```

Tests for the log primitives live alongside the screen-level helpers (`utils/__tests__/log/*`). Visual components are exercised by the smoke matrix.

## Release notes

- `FloatingChatWidget` is reachable from every client tab except the profile-like ones. If you add a new screen that should not show the widget, edit the `hideWidget` predicate in `navigation/RootNavigator.tsx`.
- `IdentityBadge` shimmer runs once on mount. It is intentionally subtle — do not loop the animation.
- The log primitives in `components/log` are the first thing to rev when the food-search flow changes; the offline queue contract in `services/foodLogQueue` depends on the shape of the payload they construct.
- `TrustCueRow` copy is part of the privacy review. Editing the explainer text is a release-blocking sync with the marketing privacy page.
