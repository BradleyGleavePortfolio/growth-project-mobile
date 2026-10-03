# Mobile reachability map

Every route registered in `src/navigation/*.tsx`, for each role, with the way a
person reaches it, the backend routes it depends on and whether production
serves them, its flag, and the verdict. Lane S-REACH (agent 113), 2026-10-02.

## How this was built

- Routes, flag guards and component files: read from every
  `<X.Screen name=...>` in `src/navigation/`. Entry points: every
  `navigate('Route')`, `screen: 'Route'`, `push`/`replace` call outside
  `src/navigation/`, plus tab bars, navigator roots, deep links
  (the `linking` config in `RootNavigator.tsx`) and push-tap routing (`pushTapRouter`).
  Entries named in this table come from on-screen files unless marked
  "push tap" or "deep link".
- Backend routes: API paths used by the screen file and the modules it imports
  (two levels), matched against every controller on backend `main` (9cfd70d6,
  the commit production runs). The list is over-inclusive for screens that
  import shared stores; the first four are shown, missing routes always first.
- Production status: one unauthenticated `GET` per path against
  `https://backend-spring-lake-3890.fly.dev/api/...`. `401` means the route is
  mounted and guarded. `404 Cannot GET` means the route does not exist on
  production. A handler 404 (for example "This link is not available." for a
  made-up join token) means the route is mounted. Writes (`POST`, `PUT`,
  `PATCH`, `DELETE`) were not sent; they are marked "on backend main".
- Flags: `src/config/featureFlags.ts` defaults plus `eas.json` profiles. The
  clinic profile turns on `clientTutorial`, `communityTab`, `communityHall`,
  `communityCohorts`, `coachBrief` and `consultationOnboarding`; every other
  flag below is OFF in every profile.
- Tests that hold these guarantees: `src/navigation/__tests__/reachabilityGates.test.ts`
  (entries exist for every surface wired here, lab routes stay behind
  `bloodwork`, the consultation view is registered once and unflagged).

## Decisions in this PR

| Change | Why |
|---|---|
| More gains a "your plan" group: Meal plan, Macro targets, Progress, Habits and check-in, Timeline, Exercise library | Each screen works on production routes and had no on-screen way in. Each has an honest empty state for a coachless client. Each opens with a native back header so the way back is always visible. |
| Workout header gains an Exercise library icon | Same: `GET /exercise-catalog` is live; the library had no entry. |
| Clients header gains an "At risk" pill (coach, owner) | `GET /coach/clients/risk-board` is live with nightly scores; its only entry was the retired Dashboard. |
| New coach consultation view: Client detail > Summary > Consultation | Owner ask: the coach sees every client's consultation answers easily. Reads `GET /coach/clients/:clientId/consultation` (backend #607, live). |
| `Bloodwork` and `BloodworkReviewQueue` now register only behind `bloodwork` (OFF) | Personal training only. Before, a deep link or a stale navigate call could still open them. |

## Coach consultation view (backend #607)

- Route: `GET /api/coach/clients/:clientId/consultation` (and `/revisions`),
  `JwtAuthGuard` + `RolesGuard`, readable by the client's coach, the head
  coach, and a sub-coach with an open assignment. Every refusal is a uniform
  `404 Consultation not found` so a coach cannot probe other rosters.
  Production answers `401` unauthenticated (mounted).
- States: loading; no answers on file (the uniform 404); answers, with the
  readiness questions answered yes shown first and highlighted, then every
  chapter, then consent; specific failure states for no connection, busy,
  session ended (Log in again) and unexpected (short reference, Try again,
  Email support, reported to Sentry with status, code and request id only,
  never answers). A router 404 (route missing on an older backend) is treated
  as unexpected, never as "no answers".
- The answers stay out of the persisted query cache (`meta.persist: false`).
- Summary card on Client detail shows the status line ("Completed Oct 1, 2026",
  or "In progress") and flags readiness yes answers before any tap.


## Signed out and onboarding

`ConsultationOnboardingNavigator` (single flow, `ConsultationFlow`) replaces the lean flow when `consultationOnboarding` is on (ON in the clinic profile). It reads and writes `/me/onboarding/*` and finishes only through `POST /me/onboarding/complete` (live). Verdict: works, gate confirmed.

| Route | Role | Stack | Entry point | Backend route(s), prod status | Flag | Verdict |
|---|---|---|---|---|---|---|
| `Welcome` | Signed out | Auth | Auth root | none (local or static) |  | Works, reachable |
| `Login` | Signed out | Auth | AuthCallbackScreen, AcceptInviteScreen, ForgotPasswordScreen +3; deep link | `GET /auth/signup-policy` live (200, public)<br>`POST /auth/apple` on backend main<br>`POST /auth/google` on backend main<br>`POST /auth/login` on backend main |  | Works, reachable |
| `CreateAccount` | Signed out | Auth | LoginScreen, AcceptInviteScreen, WelcomeScreen; deep link | `GET /auth/signup-policy` live (200, public)<br>`GET /invite/:p/preview` live (200, public)<br>`POST /auth/apple` on backend main<br>`POST /auth/google` on backend main<br>+3 more, none missing |  | Works, reachable |
| `ForgotPassword` | Signed out | Auth | LoginScreen, CreateAccountScreen | `POST /auth/forgot-password` on backend main |  | Works, reachable |
| `ResetPassword` | Signed out | Auth | Password reset email link (deep link) | none (local or static) |  | Works: deep link only by design |
| `RoleSelection` | Signed out | Auth | LoginScreen, CreateAccountScreen | `GET /auth/signup-policy` live (200, public)<br>`GET /invite/:p/preview` live (200, public)<br>`POST /auth/select-role` on backend main |  | Works, reachable |
| `AcceptInvite` | Signed out | Auth | Invite link (deep link) | none (local or static) |  | Works: deep link only by design |
| `AuthCallback` | Signed out | Auth | OAuth / magic link return (deep link) | none (local or static) |  | Works: deep link only by design |
| `SupportInbox` | Signed out | Auth | MessagesScreen, SettingsScreen, LoginScreen +2 | none (local or static) |  | Works, reachable |
| `LeanQ1` | New client | Lean onboarding | RootNavigator (onboarding, consultation flag off) | `PUT /profile` on backend main |  | Works, reachable |
| `LeanQ2` | New client | Lean onboarding | LeanQ1GoalScreen | `PUT /profile` on backend main |  | Works, reachable |
| `LeanQ3` | New client | Lean onboarding | LeanQ2ExperienceScreen | `PUT /profile` on backend main |  | Works, reachable |
| `LeanQ4` | New client | Lean onboarding | LeanQ3IntentScreen | none (local or static) |  | Works, reachable |
| `LeanQ5` | New client | Lean onboarding | LeanQ4MetricsScreen | none (local or static) |  | Works, reachable |
| `LeanQ6` | New client | Lean onboarding | LeanQ5Screen | `PUT /profile` on backend main |  | Works, reachable |
| `Welcome` | New client | Day 1 onboarding | AcceptInviteScreen; deep link | `PATCH /notifications/preferences` on backend main<br>`PATCH /users/me/preferences` on backend main<br>`PUT /profile` on backend main |  | Works, reachable |
| `CoachPairing` | New client | Day 1 onboarding | WelcomeScreen | `PATCH /notifications/preferences` on backend main<br>`PATCH /users/me/preferences` on backend main<br>`PUT /profile` on backend main |  | Works, reachable |
| `Goals` | New client | Day 1 onboarding | CoachPairingScreen | `PATCH /notifications/preferences` on backend main<br>`PATCH /users/me/preferences` on backend main<br>`PUT /profile` on backend main |  | Works, reachable |
| `Notifications` | New client | Day 1 onboarding | GoalsScreen | `PATCH /notifications/preferences` on backend main<br>`PATCH /users/me/preferences` on backend main<br>`PUT /profile` on backend main |  | Works, reachable |
| `CheckInTime` | New client | Day 1 onboarding | NotificationsScreen | `PATCH /notifications/preferences` on backend main<br>`PATCH /users/me/preferences` on backend main<br>`PUT /profile` on backend main |  | Works, reachable |
| `Ready` | New client | Day 1 onboarding | CheckInTimeScreen | `PATCH /notifications/preferences` on backend main<br>`PATCH /users/me/preferences` on backend main<br>`PUT /profile` on backend main |  | Works, reachable |
| `Step1` | None (legacy) | Legacy onboarding | none found | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step2` | None (legacy) | Legacy onboarding | OnboardingStep1 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step3` | None (legacy) | Legacy onboarding | OnboardingStep2 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step4` | None (legacy) | Legacy onboarding | OnboardingStep3 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step5` | None (legacy) | Legacy onboarding | OnboardingStep4 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step6` | None (legacy) | Legacy onboarding | OnboardingStep5 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step7` | None (legacy) | Legacy onboarding | OnboardingStep6 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step8` | None (legacy) | Legacy onboarding | OnboardingStep7 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step9` | None (legacy) | Legacy onboarding | OnboardingStep8 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Step10` | None (legacy) | Legacy onboarding | OnboardingStep9 | none (local or static) |  | Legacy flow, not mounted by RootNavigator: unreachable by design |
| `Results` | None (legacy) | Legacy onboarding | OnboardingStep10 | `PUT /profile` on backend main |  | Legacy flow, not mounted by RootNavigator: unreachable by design |

## Client (with a coach, and coachless)

| Route | Role | Stack | Entry point | Backend route(s), prod status | Flag | Verdict |
|---|---|---|---|---|---|---|
| `Home` | Client | Client tabs | Tab bar | none (local or static) |  | Works. HomeScreen owned by #322; not edited here |
| `WorkoutTab` | Client | Client tabs | Tab bar | none (local or static) |  | Works, reachable |
| `Log` | Client | Client tabs | Tab bar | `GET /foods/search` live (401)<br>`GET /log/daily` live (401)<br>`GET /me/macros/current` live (401)<br>`GET /nutrition/water` live (401)<br>+5 more, none missing |  | Works, reachable |
| `MoreTab` | Client | Client tabs | Tab bar | none (local or static) |  | Works, reachable |
| `CommunityTab` | Client | Client tabs | Tab bar (flag on) | `GET /community/challenges/:p/comments` live (401)<br>`GET /community/challenges/:p/leaderboard` live (401)<br>`GET /community/challenges/:p` live (401)<br>`GET /community/classroom/:p` live (401)<br>+35 more, none missing | `communityTab` | Flag `communityTab`: ON in clinic profile, OFF elsewhere. Gate confirmed. Owned by #314 |
| `HomeMain` | Client | Home tab | Home tab root | `GET /insights/holistic` live (401)<br>`GET /log/daily` live (401)<br>`GET /notifications/preferences` live (401)<br>`GET /notifications/unread-count` live (401)<br>+10 more, none missing |  | Works, reachable |
| `Habits` | Client | Home tab | More > Habits and check-in; push tap | `GET /check-ins` live (401)<br>`GET /community/feed` live (401)<br>`GET /habits/logs` live (401)<br>`GET /habits` live (401)<br>+21 more, none missing |  | Wired in this PR (push tap only before) |
| `Notifications` | Client | Home tab | GoalsScreen | `GET /check-ins` live (401)<br>`GET /community/feed` live (401)<br>`GET /habits/logs` live (401)<br>`GET /habits` live (401)<br>+21 more, none missing |  | Works, reachable |
| `Messages` | Client | Home tab | TutorialHomeSlot, HomeHeaderActions, MembershipScreen +3; push tap | `GET /messages/coach-review` live (401)<br>`GET /messages` live (401)<br>`GET /profile` live (401)<br>`GET /users/blocks` live (401)<br>+5 more, none missing |  | Works, reachable |
| `NotificationCenter` | Client | Home tab | HomeHeaderActions; push tap | `GET /notifications/preferences` live (401)<br>`GET /notifications/unread-count` live (401)<br>`GET /notifications` live (401)<br>`PATCH /notifications/preferences` on backend main<br>+2 more, none missing |  | Works, reachable |
| `NotificationPreferences` | Client | Home tab | SettingsScreen; push tap | `GET /notifications/preferences` live (401)<br>`GET /notifications/unread-count` live (401)<br>`GET /notifications` live (401)<br>`PATCH /notifications/preferences` on backend main<br>+2 more, none missing |  | Works, reachable |
| `WorkoutMain` | Client | Workout tab | Workout tab root | `GET /assignments/:p` live (401)<br>`GET /assignments/me` live (401)<br>`GET /routines` live (401)<br>`GET /workout-plans/:p/assignments` live (401)<br>+10 more, none missing |  | Works, reachable |
| `ActiveWorkout` | Client | Workout tab | WorkoutAssignmentDetailScreen, WorkoutScreen, _completionLogging +1 | `GET /assignments/:p` live (401)<br>`GET /assignments/me` live (401)<br>`GET /check-ins` live (401)<br>`GET /community/feed` live (401)<br>+32 more, none missing |  | Works, reachable |
| `RoutineBuilder` | Client | Workout tab | WorkoutScreen | `GET /check-ins` live (401)<br>`GET /community/feed` live (401)<br>`GET /habits/logs` live (401)<br>`GET /habits` live (401)<br>+21 more, none missing |  | Works, reachable |
| `CoachGuidelines` | Client | Workout tab | WorkoutScreen | none (local or static) |  | Works, reachable |
| `ExerciseLibrary` | Client | Workout tab | Workout header > library icon; More > Exercise library | `GET /exercise-catalog/:p` live (401)<br>`GET /exercise-catalog` live (401) |  | Wired in this PR (was unreachable) |
| `ExerciseDetail` | Client | Workout tab | ExerciseLibraryScreen, ActiveWorkoutScreen | `GET /exercise-catalog/:p` live (401)<br>`GET /exercise-catalog` live (401) |  | Works, reachable |
| `MoreIndex` | Client | More tab | More tab root | none (local or static) |  | Works, reachable |
| `ProfileMain` | Client | More tab | MoreScreen | `GET /check-ins` live (401)<br>`GET /community/feed` live (401)<br>`GET /habits/logs` live (401)<br>`GET /habits` live (401)<br>+30 more, none missing |  | Works, reachable |
| `EditProfile` | Client | More tab | HomeScreen, ProfileScreen | `PUT /profile` on backend main |  | Works, reachable |
| `Recipes` | Client | More tab | MoreScreen; deep link | `GET /recipes` live (401)<br>`PUT /profile` on backend main |  | Works, reachable |
| `RecipeDetail` | Client | More tab | RecipesScreen | `GET /recipes/:p` live (401)<br>`DELETE /recipes/:p/save` on backend main<br>`POST /recipes/:p/save` on backend main |  | Works, reachable |
| `GroceryList` | Client | More tab | MoreScreen, PrepGuideScreen | `GET /lists/:p` live (401)<br>`DELETE /lists/items/:p` on backend main<br>`PATCH /lists/items/:p` on backend main<br>`POST /lists/:p/clear-checked` on backend main<br>+1 more, none missing |  | Works, reachable |
| `ShoppingList` | Client | More tab | MoreScreen | `GET /lists/:p` live (401)<br>`DELETE /lists/items/:p` on backend main<br>`PATCH /lists/items/:p` on backend main<br>`POST /lists/:p/clear-checked` on backend main<br>+1 more, none missing |  | Works, reachable |
| `PrepGuide` | Client | More tab | MoreScreen | `GET /prep-guide` live (401)<br>`POST /lists/:p` on backend main |  | Works, reachable |
| `Fast` | Client | More tab | MoreScreen, WidgetsScreen; deep link | `GET /fasting/history` live (401)<br>`POST /fasting/end` on backend main<br>`POST /fasting/start` on backend main |  | Works, reachable |
| `Community` | Client | More tab | MoreScreen | `GET /check-ins` live (401)<br>`GET /community/feed` live (401)<br>`GET /habits/logs` live (401)<br>`GET /habits` live (401)<br>+21 more, none missing |  | Works, reachable |
| `Progress` | Client | More tab | More > Progress | `GET /log/daily` live (401)<br>`GET /me/macros/current` live (401)<br>`GET /weight/history` live (401)<br>`POST /weight` on backend main |  | Wired in this PR (was a retired tab, no menu entry) |
| `Settings` | Client | More tab | MoreScreen, ProfileScreen | `GET /log/daily` live (401)<br>`GET /nutrition/water` live (401)<br>`GET /profile` live (401)<br>`GET /workouts` live (401)<br>+7 more, none missing |  | Works, reachable |
| `Widgets` | Client | More tab | MoreScreen, ProfileScreen | `POST /fasting/start` on backend main |  | Works, reachable |
| `Report` | Client | More tab | MoreScreen, ProfileScreen, ProgressScreen | `GET /log/daily` live (401)<br>`GET /weight/history` live (401) |  | Works, reachable |
| `Learn` | Client | More tab | MoreScreen, ProfileScreen | `GET /lessons` live (401)<br>`POST /lessons/:p/complete` on backend main |  | Works, reachable |
| `Plan` | Client | More tab | More > Meal plan | `GET /me/meal-plan/today` live (401)<br>`GET /meal-plans` live (401) |  | Wired in this PR (was unreachable) |
| `TrustCenter` | Client | More tab | SettingsScreen | `GET /v1/me/data-export/status` live (401)<br>`POST /v1/me/data-export/request` on backend main |  | Works, reachable |
| `DeleteAccount` | Client | More tab | RomanAiConsentScreen, SettingsScreen | `GET /log/daily` live (401)<br>`GET /me/delete-account/status` live (401)<br>`GET /nutrition/water` live (401)<br>`GET /profile` live (401)<br>+11 more, none missing |  | Works, reachable |
| `RomanAiConsent` | Client | More tab | SettingsScreen | `GET /me/ai-consent` live (401)<br>`DELETE /me/ai-consent/roman` on backend main<br>`POST /me/ai-consent/roman` on backend main |  | Works, reachable |
| `Preferences` | Client | More tab | SettingsScreen | `GET /users/me/preferences` live (401)<br>`PATCH /users/me/preferences` on backend main |  | Works, reachable |
| `AIGuide` | Client | More tab | More > Guidance | `GET /ai/structured-context` live (401)<br>`POST /ai/chat` on backend main |  | Works. Consent refusal copy owned by #326; merge #326 before release |
| `Membership` | Client | More tab | MoreScreen; push tap | `GET /ai/structured-context` live (401)<br>`GET /users/me/founding-number` live (401) |  | Works, reachable |
| `Timeline` | Client | More tab | More > Timeline; push tap | `GET /me/timeline` live (401) |  | Wired in this PR (push tap only before) |
| `Leaderboard` | Client | More tab | none | `GET /me/leaderboard` live (401)<br>`POST /me/leaderboard/opt-in` on backend main |  | Works on prod (opt-in, roster-scoped, nightly job) but has no entry. Left unwired: owner decision (peer ranking) |
| `LeaderboardSettings` | Client | More tab | none (from Leaderboard) | `GET /me/leaderboard` live (401)<br>`POST /me/leaderboard/opt-in` on backend main |  | Follows Leaderboard decision |
| `Bloodwork` | Client | More tab | none | none (local or static) | `bloodwork` | Hidden in this PR: registered only behind `bloodwork` (OFF). Personal training only, no lab surfaces |
| `Copilot` | Client | More tab | none | none (local or static) | `clientPathCopilot` | Flag OFF everywhere, no entry while off: gate confirmed |
| `PrivateCommunityHub` | Client | More tab | none | none (local or static) | `privateCommunityHub` | Flag OFF everywhere, no entry while off: gate confirmed |
| `RomanChat` | Client | More tab | More row, Settings row (flag on only) | `GET /roman/sessions/:p/messages` live (401)<br>`DELETE /roman/sessions/:p` on backend main<br>`POST /roman/sessions` on backend main | `romanChat` | Flag OFF everywhere: gate confirmed. Roman chat surfaces owned by #331 |
| `ShareCard` | Client | More tab | ProgressScreen | none (local or static) |  | Works, reachable |
| `NotificationPreferences` | Client | More tab | SettingsScreen; push tap | `PATCH /notifications/preferences` on backend main |  | Works, reachable |
| `SupportInbox` | Client | More tab | MessagesScreen, SettingsScreen, LoginScreen +2 | none (local or static) |  | Works, reachable |
| `ClientMacros` | Client | More tab | More > Macro targets | `GET /me/macros/current` live (401) |  | Wired in this PR (was unreachable) |
| `ClientDailyMealPlan` | Client | More tab | dropRow | `GET /me/meal-plan/today` live (401) |  | Works, reachable |
| `ClientWorkoutViewer` | Client | More tab | Workout tab > assignments (cross-tab navigate) | `GET /assignments/:p` live (401)<br>`GET /assignments/me` live (401)<br>`GET /workout-plans/:p/assignments` live (401)<br>`GET /workout-plans/:p` live (401)<br>+7 more, none missing |  | Works, reachable |
| `WorkoutAssignmentDetail` | Client | More tab | ClientWorkoutViewerScreen, dropRow | `GET /assignments/:p` live (401)<br>`GET /assignments/me` live (401)<br>`GET /workout-plans/:p/assignments` live (401)<br>`GET /workout-plans/:p` live (401)<br>+7 more, none missing |  | Works, reachable |
| `ClientBookingRequest` | Client | More tab | none | `GET /scheduling/coaches/:p/availability` live (401)<br>`GET /scheduling/coaches/:p/session-types` live (401)<br>`GET /scheduling/providers` live (401)<br>`GET /scheduling/sessions/:p` live (401)<br>+12 more, none missing |  | Owned by #325 (calendar): entry lands there; not edited here |
| `ClientUpcomingSessions` | Client | More tab | none | `GET /scheduling/coaches/:p/availability` live (401)<br>`GET /scheduling/coaches/:p/session-types` live (401)<br>`GET /scheduling/providers` live (401)<br>`GET /scheduling/sessions/:p` live (401)<br>+12 more, none missing |  | Owned by #325 (calendar): entry lands there; not edited here |
| `DataExport` | Client | More tab | Settings > Export | `GET /v1/me/data-export/status` live (401)<br>`POST /v1/me/data-export/request` on backend main |  | Works. Owned by #327 (export); not edited here |
| `ClientPackages` | Client | More tab | Membership; checkout return; package prompt | `GET /v1/checkout/entitlement` live (401)<br>`GET /v1/checkout/purchases/:p/drops` live (401)<br>`GET /v1/checkout/sessions/:p/confirm` live (401)<br>`POST /v1/checkout/billing-portal` on backend main<br>+1 more, none missing |  | Works. Owned by #322/#334; not edited here |
| `CheckoutReturn` | Client | More tab | BrandedCheckoutWebViewScreen; deep link | `GET /v1/checkout/entitlement` live (401)<br>`GET /v1/checkout/purchases/:p/drops` live (401)<br>`GET /v1/checkout/sessions/:p/confirm` live (401)<br>`POST /v1/checkout/billing-portal` on backend main<br>+1 more, none missing |  | Works, reachable |
| `Deliverables` | Client | More tab | ClientPackagesScreen, PurchaseUnpackScreen; push tap | `GET /v1/checkout/entitlement` live (401)<br>`GET /v1/checkout/purchases/:p/drops` live (401)<br>`GET /v1/checkout/sessions/:p/confirm` live (401)<br>`POST /v1/checkout/billing-portal` on backend main<br>+1 more, none missing |  | Works, reachable |
| `PurchaseUnpack` | Client | More tab | CheckoutReturnScreen, PurchaseUnpackScreen | `GET /v1/checkout/entitlement` live (401)<br>`GET /v1/checkout/purchases/:p/drops` live (401)<br>`GET /v1/checkout/sessions/:p/confirm` live (401)<br>`POST /v1/checkout/billing-portal` on backend main<br>+1 more, none missing |  | Works, reachable |
| `BrandedCheckoutWebView` | Client | More tab | ClientPackagesScreen, PackageCheckoutScreen | none (local or static) |  | Works, reachable |
| `ContactView` | Client | More tab | MessagesScreen, ClientMessagesScreen | `GET /users/blocks` live (401)<br>`DELETE /users/:p/block` on backend main<br>`POST /messages/report` on backend main<br>`POST /messages` on backend main<br>+1 more, none missing |  | Works, reachable |
| `BlockedUsers` | Client | More tab | SettingsScreen | `GET /users/blocks` live (401)<br>`DELETE /users/:p/block` on backend main<br>`POST /messages/report` on backend main<br>`POST /messages` on backend main<br>+1 more, none missing |  | Works, reachable |
| `Connections` | Client | More tab | MoreScreen, WearablesShell, SleepRecoveryScreen +2 | none (local or static) |  | Works, reachable |
| `Health` | Client | More tab | MoreScreen | `GET /v1/wearables/insights/client` live (401)<br>`GET /v1/wearables/insights/coach` live (401)<br>`POST /v1/wearables/insights/approve` on backend main |  | Works, reachable |
| `WearableMetricDetail` | Client | More tab | HealthFitnessScreen | none (local or static) |  | Works, reachable |
| `PackageCheckout` | Client | More tab | Package join link (deep link) | `GET /v1/packages/public/join/:p` live (handler 404)<br>`POST /v1/checkout/sessions` on backend main |  | Works: deep link only by design |
| `CommunityTab` | Client | Community tab | Community tab root | `GET /community/challenges/:p/comments` live (401)<br>`GET /community/challenges/:p/leaderboard` live (401)<br>`GET /community/challenges/:p` live (401)<br>`GET /community/cohorts` live (401)<br>+19 more, none missing |  | Flag `communityTab` (see tab). Owned by #314 |
| `CommunityToday` | Client | Community tab | none found | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+10 more, none missing |  | Owned by #314 (community IA): record only |
| `CommunitySpace` | Client | Community tab | CommunityTodayScreen | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+10 more, none missing |  | Works behind `communityTab`. Owned by #314 |
| `CommunityThread` | Client | Community tab | CommunitySpaceScreen, CommunityTodayScreen, CommunityFindScreen; deep link | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+10 more, none missing |  | Works behind `communityTab`. Owned by #314 |
| `CommunityEventDetail` | Client | Community tab | Community screens (flag on) | `GET /community/cohorts` live (401)<br>`GET /community/events/:p` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>+17 more, none missing | `communityEvents` | Flag `communityEvents` OFF: gate confirmed |
| `CommunityDmList` | Client | Community tab | Community Today | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+10 more, none missing |  | Flag `communityDm` OFF in clinic: gate confirmed upstream (#314) |
| `CommunityDmThread` | Client | Community tab | CommunityDmListScreen; deep link | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+10 more, none missing |  | Works behind `communityTab`. Owned by #314 |
| `CommunityComposer` | Client | Community tab | CommunitySpaceScreen, CommunityDmListScreen | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+10 more, none missing |  | Works behind `communityTab`. Owned by #314 |
| `CommunityChallenges` | Client | Community tab | none found | `GET /community/challenges/:p/comments` live (401)<br>`GET /community/challenges/:p/leaderboard` live (401)<br>`GET /community/challenges/:p` live (401)<br>`GET /community/cohorts` live (401)<br>+19 more, none missing |  | Owned by #314 (community IA): record only |
| `CommunityChallengeDetail` | Client | Community tab | CommunityTodayScreen, CommunityChallengesScreen | `GET /community/challenges/:p/comments` live (401)<br>`GET /community/challenges/:p/leaderboard` live (401)<br>`GET /community/challenges/:p` live (401)<br>`GET /community/cohorts` live (401)<br>+19 more, none missing |  | Works behind `communityTab`. Owned by #314 |
| `CommunityClassroom` | Client | Community tab | none found | `GET /community/classroom/:p` live (401)<br>`GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>+12 more, none missing |  | Owned by #314 (community IA): record only |
| `CommunityLessonDetail` | Client | Community tab | CommunityClassroomScreen, CommunityFindScreen | `GET /community/classroom/:p` live (401)<br>`GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>+12 more, none missing |  | Works behind `communityTab`. Owned by #314 |
| `CommunityVoiceComposer` | Client | Community tab | none found | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+15 more, none missing |  | Owned by #314 (community IA): record only |
| `CommunityFind` | Client | Community tab | none found | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+12 more, none missing |  | Owned by #314 (community IA): record only |
| `CommunityVoiceNoteDetail` | Client | Community tab | CommunityFindScreen | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+17 more, none missing |  | Works behind `communityTab`. Owned by #314 |

## Coach and sub-coach

| Route | Role | Stack | Entry point | Backend route(s), prod status | Flag | Verdict |
|---|---|---|---|---|---|---|
| `CoachWizardStep1` | New coach | Coach wizard | RootNavigator (new coach) | none (local or static) |  | Works. Owned by #329/#332; not edited here |
| `CoachWizardStep2` | New coach | Coach wizard | navigator (initial or nested route) | none (local or static) |  | Works (wizard step). Owned by #329/#332 |
| `CoachWizardStep3` | New coach | Coach wizard | navigator (initial or nested route) | none (local or static) |  | Works (wizard step). Owned by #329/#332 |
| `CoachWizardStep4` | New coach | Coach wizard | navigator (initial or nested route) | none (local or static) |  | Works (wizard step). Owned by #329/#332 |
| `CoachWizardStep5` | New coach | Coach wizard | navigator (initial or nested route) | none (local or static) |  | Works (wizard step). Owned by #329/#332 |
| `CoachWizardStep6` | New coach | Coach wizard | navigator (initial or nested route) | none (local or static) |  | Works (wizard step). Owned by #329/#332 |
| `CommandCenter` | Coach, sub-coach | Coach tabs | Tab bar (coach home) | none (local or static) |  | Works. Owned by #329/#332; not edited here |
| `ClientsStack` | Coach, sub-coach | Coach tabs | Tab bar | none (local or static) |  | Works, reachable |
| `Templates` | Coach, sub-coach | Coach tabs | Tab bar | `GET /check-ins` live (401)<br>`GET /coach/clients` live (401)<br>`GET /coach/guidelines/:p` live (401)<br>`GET /community/feed` live (401)<br>+24 more, none missing |  | Works. Owned by #328 (programs); not edited here |
| `Messages` | Coach, sub-coach | Coach tabs | Tab bar | `GET /coach/clients` live (401)<br>`GET /coach/messages/unread-count` live (401) |  | Works, reachable |
| `TeamStack` | Coach, sub-coach | Coach tabs | Tab bar (head coach only) | none (local or static) | `showTeamTab` | Gate `showTeamTab` (head coach) confirmed: sub-coaches never see it |
| `CommunityStack` | Coach, sub-coach | Coach tabs | Tab bar (flag on only) | `DELETE /community/coach/cohorts/:p/members/:p` NOT on backend main<br>`GET /community/coach/cohorts` MISSING on prod (404)<br>`GET /community/coach/cohorts/:p` MISSING on prod (404)<br>`GET /community/coach/dashboard` MISSING on prod (404)<br>+38 more, none missing | `coachCommunity` | Flag `coachCommunity` OFF everywhere; backend /community/coach/* missing on prod. Keep OFF: gate confirmed |
| `SettingsStack` | Coach, sub-coach | Coach tabs | Tab bar | none (local or static) |  | Works, reachable |
| `ClientsList` | Coach, sub-coach | Clients tab | Clients tab root | `GET /coach/clients` live (401) |  | Works, reachable |
| `ClientDetail` | Coach, sub-coach | Clients tab | Clients list row | `GET /coach/ai/drafts/:p` live (401)<br>`GET /coach/ai/drafts` live (401)<br>`GET /coach/ai/status` live (401)<br>`GET /coach/clients/:p/consultation` live (401)<br>+19 more, none missing |  | Works. ClientDetailScreen owned by #317; not edited here |
| `ClientMessages` | Coach, sub-coach | Clients tab | MessagesScreen, ClientDetailScreen, ClientInsightScreen | `GET /coach/clients/:p/messages` live (401)<br>`GET /users/blocks` live (401)<br>`DELETE /users/:p/block` on backend main<br>`POST /coach/clients/:p/messages/read` on backend main<br>+4 more, none missing |  | Works, reachable |
| `InviteCodes` | Coach, sub-coach | Clients tab | MessagesScreen, CoachHomeScreen, ClientsListScreen +2 | `GET /coach/invite-codes` live (401)<br>`DELETE /coach/invite-codes/:p` on backend main<br>`POST /coach/invite-codes` on backend main |  | Works, reachable |
| `RiskBoard` | Coach, sub-coach | Clients tab | Clients header > At risk (coach, owner) | `GET /coach/clients/risk-board` live (401) |  | Wired in this PR (only entry was the retired Dashboard) |
| `ClientRiskDetail` | Coach, sub-coach | Clients tab | Risk board row | `GET /coach/clients/risk-board` live (401)<br>`POST /coach/clients/:p/nudges` on backend main |  | Reachable through RiskBoard (this PR) |
| `BloodworkReviewQueue` | Coach, sub-coach | Clients tab | none | none (local or static) | `bloodwork` | Hidden in this PR: registered only behind `bloodwork` (OFF) |
| `Dashboard` | Coach, sub-coach | Clients tab | none (legacy CoachHomeScreen) | `GET /coach/ai/budget` live (401)<br>`GET /coach/alerts` live (401)<br>`GET /coach/clients/risk-board` live (401)<br>`GET /coach/clients` live (401)<br>+9 more, none missing |  | Retired landing, kept so old navigate calls resolve. Unreachable by design |
| `CoachMacrosReview` | Coach, sub-coach | Clients tab | ClientDetailScreen | `GET /coach/clients/:p/macros/current` live (401)<br>`GET /coach/clients/:p/macros` live (401)<br>`GET /me/macros/current` live (401)<br>`DELETE /coach/macros/:p` on backend main<br>+2 more, none missing |  | Works, reachable |
| `ClientConsultation` | Coach, sub-coach | Clients tab | Client detail > Summary > Consultation | `GET /coach/clients/:p/consultation` live (401)<br>`GET /coach/clients` live (401)<br>`GET /log/daily` live (401)<br>`GET /nutrition/water` live (401)<br>+8 more, none missing |  | New in this PR: consultation answers (backend #607) |
| `CoachWorkoutBuilder` | Coach, sub-coach | Clients tab | SettingsScreen, ClientDetailScreen | `GET /assignments/:p` live (401)<br>`GET /assignments/me` live (401)<br>`GET /exercises/:p` live (401)<br>`GET /exercises/search` live (401)<br>+11 more, none missing |  | Works, reachable |
| `CoachMealTemplates` | Coach, sub-coach | Clients tab | SettingsScreen | `GET /coach/daily-meal-plans/:p/assignments` live (401)<br>`GET /coach/daily-meal-plans/:p` live (401)<br>`GET /coach/daily-meal-plans` live (401)<br>`GET /coach/meal-templates/:p` live (401)<br>+9 more, none missing |  | Works, reachable |
| `CoachBulkInvite` | Coach, sub-coach | Clients tab | InviteCodesScreen, SettingsScreen | `POST /coach/invite-codes/bulk/parse` on backend main<br>`POST /coach/invite-codes/bulk` on backend main |  | Works, reachable |
| `BulkInvite` | Coach, sub-coach | Clients tab | Settings; Invites | `GET /coach/invite-codes` live (401)<br>`DELETE /coach/invite-codes/:p` on backend main<br>`POST /coach/invite-codes/:p/send` on backend main<br>`POST /coach/invite-codes/bulk` on backend main |  | Works. `invitesApi.singleInvite` targets a route not on backend main but has no caller (dead code) |
| `CoachInvites` | Coach, sub-coach | Clients tab | Settings | `GET /coach/invite-codes` live (401)<br>`DELETE /coach/invite-codes/:p` on backend main<br>`POST /coach/invite-codes/:p/send` on backend main<br>`POST /coach/invite-codes/bulk` on backend main |  | Works. Same dead `singleInvite` helper, no caller |
| `CoachAvailabilityEditor` | Coach, sub-coach | Clients tab | SettingsScreen | `GET /scheduling/coaches/:p/availability` live (401)<br>`GET /scheduling/coaches/:p/session-types` live (401)<br>`GET /scheduling/providers` live (401)<br>`GET /scheduling/sessions/:p` live (401)<br>+12 more, none missing |  | Works, reachable |
| `CoachBookingInbox` | Coach, sub-coach | Clients tab | SettingsScreen | `GET /scheduling/coaches/:p/availability` live (401)<br>`GET /scheduling/coaches/:p/session-types` live (401)<br>`GET /scheduling/providers` live (401)<br>`GET /scheduling/sessions/:p` live (401)<br>+12 more, none missing |  | Works, reachable |
| `AIWorkoutDraft` | Coach, sub-coach | Clients tab | CoachAiSection | `GET /coach/ai/drafts/:p` live (401)<br>`GET /coach/ai/drafts` live (401)<br>`GET /coach/ai/status` live (401)<br>`POST /coach/ai/client-insight` on backend main<br>+5 more, none missing |  | Works, reachable |
| `AIMealPlanDraft` | Coach, sub-coach | Clients tab | CoachAiSection | `GET /coach/ai/drafts/:p` live (401)<br>`GET /coach/ai/drafts` live (401)<br>`GET /coach/ai/status` live (401)<br>`POST /coach/ai/client-insight` on backend main<br>+5 more, none missing |  | Works, reachable |
| `ClientInsight` | Coach, sub-coach | Clients tab | CoachAiSection | `GET /coach/ai/drafts/:p` live (401)<br>`GET /coach/ai/drafts` live (401)<br>`GET /coach/ai/status` live (401)<br>`POST /coach/ai/client-insight` on backend main<br>+5 more, none missing |  | Works, reachable |
| `PendingAiDrafts` | Coach, sub-coach | Clients tab | ClientDetailScreen | none (local or static) |  | Works, reachable |
| `NotificationCenter` | Coach, sub-coach | Clients tab | HomeHeaderActions; push tap | `GET /notifications/preferences` live (401)<br>`GET /notifications/unread-count` live (401)<br>`GET /notifications` live (401)<br>`PATCH /notifications/preferences` on backend main<br>+2 more, none missing |  | Works, reachable |
| `NotificationPreferences` | Coach, sub-coach | Clients tab | SettingsScreen; push tap | `GET /notifications/preferences` live (401)<br>`GET /notifications/unread-count` live (401)<br>`GET /notifications` live (401)<br>`PATCH /notifications/preferences` on backend main<br>+2 more, none missing |  | Works, reachable |
| `InviteCodeRedeemers` | Coach, sub-coach | Clients tab | InviteCodesScreen | `GET /coach/invite-codes/:p/redeemers` live (401) |  | Works, reachable |
| `ContactView` | Coach, sub-coach | Clients tab | MessagesScreen, ClientMessagesScreen | `GET /users/blocks` live (401)<br>`DELETE /users/:p/block` on backend main<br>`POST /messages/report` on backend main<br>`POST /messages` on backend main<br>+1 more, none missing |  | Works, reachable |
| `SettingsHome` | Coach, sub-coach | Settings tab | Settings tab root | `GET /coach/clients` live (401)<br>`GET /log/daily` live (401)<br>`GET /me/delete-account/status` live (401)<br>`GET /notifications/preferences` live (401)<br>+12 more, none missing |  | Works, reachable |
| `Billing` | Coach, sub-coach | Settings tab | Settings; Stripe setup banner | `GET /coach/billing/status` live (401)<br>`GET /v1/coach/me/billing` live (401)<br>`POST /coach/billing/portal-session` on backend main |  | Works. Owned by #329/#332 (coach money); not edited here |
| `TrustCenter` | Coach, sub-coach | Settings tab | SettingsScreen | `GET /v1/me/data-export/status` live (401)<br>`POST /v1/me/data-export/request` on backend main |  | Works, reachable |
| `CoachBrief` | Coach, sub-coach | Settings tab | none reachable (only the retired Dashboard) | none (local or static) | `coachBrief` | Fake: reads a local stub, not GET /coach/brief/today (live). Flag ON in clinic but unreachable. Keep unreachable; follow-up |
| `AdminControlRoom` | Coach, sub-coach | Settings tab | none | none (local or static) | `adminControlRoom` | Flag `adminControlRoom` (dev builds only): gate confirmed |
| `RomanChat` | Coach, sub-coach | Settings tab | Settings row (flag on only) | `GET /roman/sessions/:p/messages` live (401)<br>`DELETE /roman/sessions/:p` on backend main<br>`POST /roman/sessions` on backend main | `romanChat` | Flag OFF everywhere: gate confirmed. Owned by #331 |
| `SupportInbox` | Coach, sub-coach | Settings tab | MessagesScreen, SettingsScreen, LoginScreen +2 | none (local or static) |  | Works, reachable |
| `BothPillars` | Coach, sub-coach | Settings tab | SettingsScreen | `GET /coach/cross-pillar/analytics` live (401)<br>`GET /coach/cross-pillar/clients/:p` live (401)<br>`GET /coach/cross-pillar/clients` live (401)<br>`GET /coach/cross-pillar/search` live (401)<br>+2 more, none missing |  | Works, reachable |
| `DeleteAccount` | Coach, sub-coach | Settings tab | RomanAiConsentScreen, SettingsScreen | `GET /coach/clients` live (401)<br>`GET /log/daily` live (401)<br>`GET /me/delete-account/status` live (401)<br>`GET /nutrition/water` live (401)<br>+12 more, none missing |  | Works, reachable |
| `DataExport` | Coach, sub-coach | Settings tab | SettingsScreen | `GET /v1/me/data-export/status` live (401)<br>`POST /v1/me/data-export/request` on backend main |  | Works, reachable |
| `ImportData` | Coach, sub-coach | Settings tab | Settings (flag on only) | none (local or static) | `extensionImport` | Flag `extensionImport` OFF: gate confirmed |
| `CoachBusinessMetrics` | Coach, sub-coach | Settings tab | CoachTeamProfileScreen, SettingsScreen | `GET /coach/connect/metrics` live (401)<br>`GET /coach/connect/packages` live (401)<br>`GET /coach/connect/payouts` live (401)<br>`GET /coach/connect/status` live (401)<br>+1 more, none missing |  | Works, reachable |
| `CoachTeamProfile` | Coach, sub-coach | Settings tab | SettingsScreen | `GET /coach/team/members` live (401)<br>`GET /coach/team` live (401)<br>`PUT /coach/team` on backend main |  | Works, reachable |
| `CoachConnect` | Coach, sub-coach | Settings tab | SettingsScreen | `GET /v1/connect/accounts/me` live (401)<br>`POST /v1/connect/accounts/create` on backend main<br>`POST /v1/connect/accounts/dashboard-link` on backend main<br>`POST /v1/connect/accounts/onboarding-link` on backend main |  | Works, reachable |
| `CoachPackagesList` | Coach, sub-coach | Settings tab | SettingsScreen | `GET /v1/coach/packages/:p/subscribers` live (401)<br>`GET /v1/coach/packages/:p` live (401)<br>`GET /v1/coach/packages` live (401)<br>`GET /v1/coach/payments/earnings` live (401)<br>+5 more, none missing |  | Works, reachable |
| `CoachPackageEdit` | Coach, sub-coach | Settings tab | CoachPackageEditScreen, CoachPackagesListScreen | `GET /v1/coach/packages/:p/subscribers` live (401)<br>`GET /v1/coach/packages/:p` live (401)<br>`GET /v1/coach/packages` live (401)<br>`GET /v1/coach/payments/earnings` live (401)<br>+5 more, none missing |  | Works, reachable |
| `CoachPackageSubscribers` | Coach, sub-coach | Settings tab | CoachPackageEditScreen | `GET /v1/coach/packages/:p/subscribers` live (401)<br>`GET /v1/coach/packages/:p` live (401)<br>`GET /v1/coach/packages` live (401)<br>`GET /v1/coach/payments/earnings` live (401)<br>+5 more, none missing |  | Works, reachable |
| `CoachPackageContents` | Coach, sub-coach | Settings tab | CoachPackageEditScreen | none (local or static) |  | Works, reachable |
| `CoachEarnings` | Coach, sub-coach | Settings tab | Settings > Earnings | `GET /v1/coach/earnings` MISSING on prod (404)<br>`GET /v1/coach/payouts` MISSING on prod (404)<br>`GET /v1/coach/payouts/readiness` MISSING on prod (404)<br>`GET /v1/coach/reconciliation` MISSING on prod (404)<br>+7 more, none missing |  | BROKEN on prod: every /v1/coach/* read is missing. Owned by #332 (retires Earnings). Launch blocker if #332 slips |
| `BlockedUsers` | Coach, sub-coach | Settings tab | SettingsScreen | `GET /users/blocks` live (401)<br>`DELETE /users/:p/block` on backend main<br>`POST /messages/report` on backend main<br>`POST /messages` on backend main<br>+1 more, none missing |  | Works, reachable |
| `CreditPackCheckout` | Coach, sub-coach | Settings tab | Push tap; AI budget prompts | `GET /coach/ai/budget` live (401)<br>`POST /coach/ai/credit-packs/checkout` on backend main |  | Works. Owned by #329/#332 (coach money); not edited here |
| `TeamManagement` | Head coach | Team tab | CoachTeamProfileScreen | `GET /auth/me` live (401)<br>`GET /coach/team/members` live (401)<br>`GET /coach/team` live (401)<br>`GET /sub-coaches/:p/analytics` live (401)<br>+6 more, none missing |  | Works, reachable |
| `SubCoachDetail` | Head coach | Team tab | TeamManagementScreen | `GET /sub-coaches/:p/analytics` live (401)<br>`GET /sub-coaches/:p` live (401)<br>`GET /sub-coaches` live (401)<br>`POST /sub-coaches/:p/reassign-client` on backend main<br>+2 more, none missing |  | Works, reachable |
| `ClientReassign` | Head coach | Team tab | SubCoachDetailScreen | `GET /sub-coaches/:p/analytics` live (401)<br>`GET /sub-coaches/:p` live (401)<br>`GET /sub-coaches` live (401)<br>`POST /sub-coaches/:p/reassign-client` on backend main<br>+2 more, none missing |  | Works, reachable |
| `CoachCommunityHome` | Coach | Coach community tab | none found | `DELETE /community/coach/cohorts/:p/members/:p` NOT on backend main<br>`GET /community/coach/cohorts` MISSING on prod (404)<br>`GET /community/coach/cohorts/:p` MISSING on prod (404)<br>`GET /community/coach/dashboard` MISSING on prod (404)<br>+13 more, none missing |  | Behind `coachCommunity` (OFF); backend coach community reads missing on prod. Keep OFF |
| `CoachCommunityInbox` | Coach | Coach community tab | CoachCommunityHomeScreen | `DELETE /community/coach/cohorts/:p/members/:p` NOT on backend main<br>`GET /community/coach/cohorts` MISSING on prod (404)<br>`GET /community/coach/cohorts/:p` MISSING on prod (404)<br>`GET /community/coach/dashboard` MISSING on prod (404)<br>+14 more, none missing |  | Behind `coachCommunity` (OFF); backend coach community reads missing on prod. Keep OFF |
| `CoachCommunityCohorts` | Coach | Coach community tab | CoachCommunityHomeScreen | `DELETE /community/coach/cohorts/:p/members/:p` NOT on backend main<br>`GET /community/coach/cohorts` MISSING on prod (404)<br>`GET /community/coach/cohorts/:p` MISSING on prod (404)<br>`GET /community/coach/dashboard` MISSING on prod (404)<br>+13 more, none missing |  | Behind `coachCommunity` (OFF); backend coach community reads missing on prod. Keep OFF |
| `CoachCommunityCohortDetail` | Coach | Coach community tab | CoachCommunityCohortsScreen | `DELETE /community/coach/cohorts/:p/members/:p` NOT on backend main<br>`GET /community/coach/cohorts` MISSING on prod (404)<br>`GET /community/coach/cohorts/:p` MISSING on prod (404)<br>`GET /community/coach/dashboard` MISSING on prod (404)<br>+13 more, none missing |  | Behind `coachCommunity` (OFF); backend coach community reads missing on prod. Keep OFF |
| `CoachCommunityPostDetail` | Coach | Coach community tab | CoachCommunityModerationScreen | `DELETE /community/coach/cohorts/:p/members/:p` NOT on backend main<br>`GET /community/coach/cohorts` MISSING on prod (404)<br>`GET /community/coach/cohorts/:p` MISSING on prod (404)<br>`GET /community/coach/dashboard` MISSING on prod (404)<br>+13 more, none missing |  | Behind `coachCommunity` (OFF); backend coach community reads missing on prod. Keep OFF |
| `CoachCommunityModeration` | Coach | Coach community tab | CoachCommunityHomeScreen | `DELETE /community/coach/cohorts/:p/members/:p` NOT on backend main<br>`GET /community/coach/cohorts` MISSING on prod (404)<br>`GET /community/coach/cohorts/:p` MISSING on prod (404)<br>`GET /community/coach/dashboard` MISSING on prod (404)<br>+13 more, none missing |  | Behind `coachCommunity` (OFF); backend coach community reads missing on prod. Keep OFF |
| `CoachCommunityEvents` | Coach | Coach community tab | CoachCommunityHomeScreen; push tap | `GET /community/cohorts` live (401)<br>`GET /community/events/:p` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>+17 more, none missing | `communityEvents` | Behind `coachCommunity` (OFF); backend coach community reads missing on prod. Keep OFF |
| `CoachCommunityWearablePrompts` | Coach | Coach community tab | none | `GET /community/cohorts` live (401)<br>`GET /community/me` live (401)<br>`GET /community/posts/:p/comments` live (401)<br>`GET /community/posts/:p` live (401)<br>+15 more, none missing |  | Orphan route. Owned by #317 (wearables): record only |

## Coachless client

A client without a coach reaches the same screens. Screens whose content comes
from a coach (Meal plan, Macro targets, Coach guidelines, Messages, Timeline
coach events, Workout assignments) show an honest empty state rather than
invented content; none dead-ends.

## Sub-coach

Sub-coaches use the coach navigator. Differences: the Team tab is hidden
(`showTeamTab` is head coach only), and the consultation view answers only for
clients the sub-coach has an open assignment with; anyone else gets the same
"no answers on file" state the backend's uniform 404 implies.

## Open items for other lanes (recorded, not edited here)

| Route(s) | Owner | What it needs |
|---|---|---|
| `CoachEarnings` | #332 | Every `/v1/coach/*` earnings and payout read is missing on production (404 Cannot GET) while the row is live in Settings. #332 retires the screen; if it slips, hide the Settings row. |
| `CommunityStack`, coach community screens | coach community lane | `/community/coach/*` and `/community/moderation/*` are missing on production. Keep `coachCommunity` OFF until the backend ships them. |
| `CoachBrief` | follow-up | Reads a local stub (`fetchCoachBrief` in `services/wave11Adapters.ts`) instead of the live `GET /coach/brief/today`. Its only entry is the retired Dashboard, so nobody reaches it today even with the clinic flag on. Wire it to the live route before adding an entry. |
| `Leaderboard`, `LeaderboardSettings` | owner | Backend works (opt-in, roster-scoped). No entry. Recommended default: keep unwired for the clinic launch (peer ranking among clinic clients). |
| `ClientBookingRequest`, `ClientUpcomingSessions` | #325 | No entry yet; the calendar PR adds it. |
| `CommunityToday`, `CommunityChallenges`, `CommunityClassroom`, `CommunityVoiceComposer`, `CommunityFind` | #314 | No direct entry found; the community IA PR owns the tab structure. |
| `CoachCommunityWearablePrompts` | #317 | Orphan route; the wearables PR owns it. |
| `AIGuide` | #326 | Works; the consent refusal copy lands with #326. Merge it before release. |
| `invitesApi.singleInvite` | cleanup | Targets `POST /coach/invite-codes/single`, which is not on backend main. No caller; delete in a cleanup PR. |
| `OnboardingNavigator` (Step1 to Step10, Results) | cleanup | Legacy flow; RootNavigator never mounts it. Delete in a cleanup PR. |

