# Components

Shared, screen-agnostic UI. Anything that more than one screen renders, or anything that owns its own animation / lifecycle, lives here. Tokenised — no hardcoded hex, no inline radius / shadow values.

## Purpose

- Provide the visual primitives the screens compose with: cards, rings, bars, sheets, banners, splash, error boundary, skeleton loaders.
- Encapsulate the per-feature mini-systems that don't fit a single screen: trust-cue rails, anticipation tiles, community win cards, log modals.
- Bake the quiet-luxury motion contract in (entrance fades, hairline dividers, weight-400/500 serifs, no celebration overlays).

There is no global floating chat widget here, and no celebration / trophy chrome. The `FloatingChatWidget`, `FirstWinCelebration`, `IdentityBadge`, `TrophyArtifact`, `ComingSoonBanner`, and the duplicate `SplashScreen.tsx` were deleted in the wave-5b cleanup (#63). The doctrine forbids reintroducing them — see `docs/QUIET_LUXURY_DOCTRINE.md`. The dedicated AI surface is `src/screens/client/AIGuideScreen.tsx`.

## Key files

Client screens build from the shared primitives in `src/ui` (DS-PRIMITIVES-133): `Screen` / `ScreenTopBar` (safe-area insets plus 12 pt under the status bar, pinned keyboard-aware footer), `PrimaryButton` (the one filled forest button, 54 pt, `radius.button`), `TextLink` / `QuietTextButton`, `Headline` / `Lede` / `AccentRule`, `Overline`, `QuietSection` (optional `title`), `QuietRow` (56 pt hairline row) and `WheelBand` (two hairlines behind the selected wheel value, never a fill; render it before the ScrollView). Do not write a new button, page wrapper or headline here.

### Atoms / general

| File | What it does |
| --- | --- |
| `HapticPressable.tsx` | Pressable that fires a haptic on press. The right primitive for any tap that commits state. |
| `FadeInView.tsx` | Mount-time fade-in wrapper. Used for hero copy and milestone tiles. |
| `EmptyState.tsx` | Bone empty state: Cormorant title (`typography.h3`), one muted Inter line, theme colours; the optional CTA matches `ui/empty-states` (forest, radius 4, 44 pt, Inter 16, HapticPressable). |
| `ErrorBoundary.tsx` | Top-level error boundary. Reports to Sentry, renders a soft error card. |
| `SkeletonLoader.tsx` | Shimmering placeholder for list / card load. |
| `../ui/states/QuietStates.tsx` | `QuietError` (calm sentence, forest "Try again" text action, muted extra steps, no red) and `QuietLoading` (shared skeleton rows, spoken label), plus `loadFailureMessage` ("Check your connection" only for no-answer failures). Used by the coach booking inbox, invites, pending AI drafts, risk board and Programs. |
| `OfflineBanner.tsx` | Hairline banner shown when `useNetworkStatus` reports offline. Mounted by `RootNavigator`. |
| `OptionCard.tsx`, `MultiSelectChip.tsx` | Onboarding selection primitives. |
| `OnboardingLayout.tsx` | Header + progress + continue button frame for the legacy 10-step flow. |
| `AppSplash.tsx` | Branded splash, keyed to bone (`#F5EFE4`). Single mark + serif title fade — the duplicate `SplashScreen.tsx` was removed in #63. |

### Anticipation, community, trust

| File | What it does |
| --- | --- |
| `MilestoneList.tsx`, `HeroAction.tsx` | Home-tab hero composition + milestone list (date · note rows; single fade, no celebration). |
| `anticipation/CountdownTile.tsx`, `MilestoneProgress.tsx` | "Healthy anticipation" surfaces — the next-milestone preview. |
| `community/VoiceNotesSection.tsx`, `community/SafetyMenu.tsx` | Hall voice notes (Record, player) and the Report / Block / Delete menu every piece of community content carries (App Review 1.2); "Report sent" after "Self-harm or suicide" leads with 911 and the 988 Lifeline. Member wins render in `screens/client/CommunityScreen.tsx`. |
| `trust/TrustCueRow.tsx`, `TrustExplainerSheet.tsx` | Three-chip trust rail (encrypted, data ownership, no ads). Tap opens explainer; fires `trust_cue_tapped`. |

### Roman (AI butler) identity

| File | What it does |
| --- | --- |
| `roman/RomanAvatar.tsx` | Roman's circular face avatar (neutral / smile / monogram fallback). |
| `roman/romanAvatarAssets.ts` | Resolves bundled Roman art: `romanFaceAsset(crop)` for avatars, `romanArtAsset('portrait' \| 'hero' \| 'welcome')` for onboarding, reveal and tutorial surfaces. |
| `roman/__tests__/romanCanonicalAssets.test.ts` | Pins every file in `assets/roman/` by sha256. |
| `roman/RomanConversationsButton.tsx` | Roman chat header entry to "Your conversations with Roman" (`RomanConversations` route). Renders nothing outside a navigator. |

Roman is an older Black man in his 60s in a black three-piece butler suit, white shirt and straight black tie. The only approved art is `tgp-agent-context/design/roman/` (see `tgp-agent-context/strategy/AI_BUTLER_ROMAN_IDENTITY_SPEC.md` section 3). Until 2026-09-30 the bundled avatar files showed a different, younger man; that art is removed and must never return. Replacing any Roman asset requires an owner decision recorded in tgp-agent-context, after which the pinned hashes are updated in the same PR.

### Logging primitives

| File | What it does |
| --- | --- |
| `log/DailySummaryBar.tsx` | Macro / calorie summary header for the Log screen. |
| `log/MealSectionCard.tsx` | Per-meal card with add-food and entry list. |
| `log/FoodSearchModal.tsx`, `FoodSearchView.tsx` | Search-and-pick modal backed by `foodApi.search`. |
| `log/QuantityPickerModal.tsx` | Quantity multiplier picker after a food is chosen. |
| `log/ManualFoodEntryForm.tsx` | Free-form entry (name, macros, serving) for foods not in the catalogue. |
| `mealplan/LogPlannedMealButton.tsx` | "Log this meal" on every planned meal (`PlanScreen`, `ClientDailyMealPlanScreen`). One tap adds the meal to today's food log when the plan gives calories, protein, carbs and fat and its slot is breakfast, lunch, dinner or a snack; otherwise a sheet asks only for what the plan does not say (the meal, a missing value), so a missing value is never logged as zero. Same write as the Food log's manual entry (`utils/log/logSubmit`): online it creates the food and the entry and offers Undo; offline it queues them like the Food log. Tests: `mealplan/__tests__/LogPlannedMealButton.test.tsx`, `screens/client/__tests__/MealPlanLogThisMeal.test.tsx`. |

### Domain-specific

| File | What it does |
| --- | --- |
| `CalorieRing.tsx`, `MacroBar.tsx` | Hand-rolled charts with no third-party chart lib. |
| `WaterTracker.tsx` | Theme-coloured hairline progress and three quick-add actions. The unchanged 100 oz reference is labelled “Starter goal”; changed Settings goals and explicit targets retain their values. Metric (`kg`) settings show approximate ml totals, the equivalent glass size, and 250/350/500 ml buttons. Imperial 8/12/16 oz buttons and the ounce callback contract stay unchanged; metric callbacks convert back to ounces so the store writes the selected ml. Optional saved `entries` show their exact ml or approximate ounce amount and a 44 pt `onRemove(entry)` control. `removingId` labels only that entry as removing and disables water actions until it settles; the screen owns confirmation and API errors. Covered by `__tests__/WaterTracker.goal.test.tsx` and the Food log day-loading integration test. |
| `MealCard.tsx`, `FoodImage.tsx`, `ExerciseLogModal.tsx` | Per-domain primitives. |
| `DaySelector.tsx` | Horizontal day picker with `getTodayString` ergonomics. |
| `purchases/NonP2PPurchaseHidden.tsx`, `purchases/withNonP2PPurchaseGate.tsx` | Neutral "Not available in this app" state (packs are not sold in this version of the app; no link, URL or steering) and a route wrapper for non-P2P purchase screens on iOS (see `src/config/purchaseSurfaces.ts`). The wrapper takes an optional hide decision; `CreditPackCheckout` passes `creditPacksHidden`. |
| `coach/ai-budget/*` | AI usage meter, 95% banner, 80% tutorial and hard-pause modal. When `creditPacksHidden()` is true (`src/config/purchaseSurfaces.ts`), the meter is a non-interactive readout with neutral accessibility copy, the banner has no CTA, the tutorial shows three usage-only cards ending in "Done", and the hard pause says when AI resumes. None of them mentions packs, buying or top-ups. On a link build (`creditPackCheckoutMode() === 'external'`: iOS switch `EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK`, or Android switch `EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK`, preview and clinic-apk profiles only) they show the packs, `PackOptionsRow` prints "Credit packs are non-refundable." under the prices, and the tutorial's last card and the hard pause add that the coach pays TGP the pack price through Stripe checkout in the browser. The tutorial's close action reads "Not now"; its last card names no meter, because Coach Home shows none at 80-94% use, when the guide appears. After the coach closes the hard pause, the tappable meter chip stays on Coach Home so the packs are one tap away. |
| `coach/ai-builder/AiBuilderSheet.tsx`, `coach/ai-entry/{WeekAiSheet,AdjustForClient,RevisionHistorySheet,ClientCopyBar}.tsx` | Coach AI sheets (REDO-COACH-133, owner 17:07 rounded corners): 24 pt top corners (`radius.sheet`), a hairline edge, a grab handle, a serif `h2` title, 24 pt gutters and a bottom of `footerBottomPadding(insets.bottom)` so the last action clears the gesture bar on Android and the home indicator on iOS. Inputs, buttons, change cards, chips and badges take `radius.input / button / card / chip / control`; no cream card fills. Buttons whose handler already fires an AI haptic (send, apply, discard, close with pending changes) keep `Pressable` with a pressed veil so a press gives one haptic; the others are `HapticPressable`. The client-copy Assign is an outlined forest button so the builder keeps one filled action (Save). Tests: `coach/ai-entry/__tests__/coachSheets133.test.tsx`. |
| `coach/LoadFailedNotice.tsx` | Calm failed-read block for coach screens (QA-COACH-HOME-131): one `textPrimary` sentence naming what did not load and a forest `accentText` "Try again" text button on `HapticPressable` (44 pt target, testID `<testID>-retry`). No red, icon or fill. Used by the Command Center tabs and Team. |
| `coach/ExtensionPairingPanel.tsx` | Import pairing lifecycle. Unavailable state says import is not enabled on the account without promising later enablement. Copy code, cancel, review-import navigation and retry/new-code handlers are retained. |
| `invite/PasteInviteCodeButton.tsx` | "Paste invite code" text button used by CreateAccount and RoleSelection. It reads the clipboard only on tap and parses with `lib/inviteCodeInput.extractInviteCode`, which accepts a bare code, `/join/<code>`, `tgp://join/<code>` or `?code=`, and never truncates a token. It fills the field and never auto-attaches. |
| `tutorial/` | Clinic launch Roman-led tutorial UI (featureFlags.clientTutorial, default OFF): `TutorialHost` (hydration, signals, live macros, overlay mount), `TutorialOverlay` (Roman coach-mark card, progress, spotlight, skip/resume, defer, done line, completion), `TutorialTarget` (spotlight measurement wrapper), the C08 `MacroExplanationCard` (Home) and `PlanExplanationCard` (Train), `TutorialHomeSlot` (re-offer line, macro card, Message your coach row), `TutorialSettingsRow` (Settings > Tutorial). Logic and flags: `src/tutorial/README.md`. |
| `home/FullMacrosIntroCard.tsx` | One quiet Roman card on Home. It introduces carbohydrate and fat once, on the day a never-tracker's simple macro view ends. Dismissible and persisted per user. See `src/macros/README.md`. Home's child cards (this one, `PushPermissionCard`, `CoachIntroductionBanner`, `HolisticInsightsTile`, `PendingInviteBanner`, the coachless banner and Roman card, `MacroExplanationCard`, `DunningBanner`) render as hairline sections through `src/ui/sections/QuietSection` (overline, Inter body, forest text action for the card's primary); `PushPermissionCard` and `DunningBanner` take `presentation="section"` on Home and keep their card elsewhere. |
| `home/HomeHeaderActions.tsx` | Unboxed coach-message entry and notification bell keep their unread badges. When `featureFlags.romanChat` is on, a 32 pt neutral Roman avatar within a 44 pt target opens `MoreTab → RomanChat` with `initial: false`, keeping the You menu underneath for Back and tab re-press. |
| `log/DailySummaryBar.tsx`, `log/MealSectionCard.tsx` | Accept a `mode` / `macroMode` prop (`simple` or `full`, default `full`). `simple` shows calories and protein only. |
| `AllergySafetyPrompt.tsx` | One-time Recipes sheet asking about allergies and restrictions; the answer is saved to `profile.diet_restrictions` (Save, Set this up later, or close). What it says about hiding follows the `rule` prop, which RecipesScreen reads from GET /recipes/allergens (`src/lib/recipeAllergens.ts`, ALLERGY-M-130): `on` says recipes listing a chosen allergen are hidden, that Vegetarian, Vegan and Pescatarian hide nothing and that undeclared recipes still show; `off` (a backend without the rule, and the default) says recipes are not filtered (ALLERGY-128); `unknown` claims neither. Every state asks the client to check each recipe's ingredients, and RecipesScreen opens the sheet only after that read settles so the copy never changes while it is read. Chips are saved as shown; Soy, Sesame and Fish are the allergen names the backend maps (ALLERGY-CHOICES-131). |
| `messaging/MessageBubble.tsx`, `messaging/ThreadV2Parts.tsx` | Semantic colours through `thread/useThreadColors`: Inter message text on bone, a hairline for outgoing rows, readable metadata, quiet pins and 44 pt controls. Client timestamps are grouped; the coach keeps its existing rendering contract. Message menus and moderation handlers are unchanged. |
| `PendingInviteBanner.tsx` | Home consent banner for a pending invite code. The optional, read-only `/invite/:code/preview` names a confirmed coach; a missing name or failed preview does not block Attach. The sharing sentence and its advertised version remain on the explicit Attach flow. A successful attach keeps the existing coach cache patch, refreshes the shared entitlement and invalidates `['coachless', 'home']` so Home re-reads eligibility without reopening the app; no plan access is inferred. Attach and Dismiss remain 44 pt text actions in a `QuietSection`, with readable, unclamped copy. It refreshes on auth events and on `subscribePendingInviteCode` (a foreground invite link). Legacy scoped `pending_invite_code:*` keys are never read; they are only deleted at sign-out. Tests: `__tests__/PendingInviteBanner.test.tsx`. |

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
| `community/VoiceNotesSection.tsx`, `community/SafetyMenu.tsx` | Hall voice notes (Record, player) and the Report / Block / Delete menu every piece of community content carries (App Review 1.2); "Report sent" after "Self-harm or suicide" leads with 911 and the 988 Lifeline. Member wins render in `screens/client/CommunityScreen.tsx`. |
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
| `CalorieRing.tsx`, `MacroBar.tsx` | Hand-rolled charts with no third-party chart lib. |
| `WaterTracker.tsx` | See the WaterTracker contract above: starter-reference label, unit-aware totals/progress and three working quick-add actions, with the existing ounce callback preserved. |
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


## Community terms agreement (Apple 1.2, 2026-10-05)

`community/CommunityTermsGate.tsx` wraps the client Community stack (`CommunityNavigator`), the coach Community stack
(`CoachCommunityNavigator`) and More > Community (`withCommunityTerms(CommunityScreen)` in `ClientNavigator`). Before first
use it shows `COMMUNITY_GUIDELINES`, the zero-tolerance sentence, "Agree and continue" (stored per user in `prefsStorage`
under `community_terms_agreed:v1:<userId>`) and "Read the Terms of Service" (`TERMS_URL`). Legal links open through
`src/lib/legalLinks.ts`, which names the page and gives its web address when the phone cannot open it. The Create account
screen states the Terms of Service and Privacy Policy agreement with both links. Tests:
`community/__tests__/CommunityTermsGate.test.tsx`, `screens/auth/__tests__/CreateAccountScreen.test.tsx`.
