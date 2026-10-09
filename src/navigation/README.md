# Navigation

React Navigation v7 is the routing layer. `RootNavigator` decides which sub-navigator is mounted based on auth + onboarding state, and owns the deep-link configuration that all `tgp://` and `https://app.trygrowthproject.com` URLs flow through.

## Purpose

- Centralise the auth gate. There is exactly one place where "is this user signed in, and which experience do they get?" is decided: `RootNavigator.bootstrapAuth`.
- Map deep links to a single screen (`CreateAccount`) so an invite-code URL always lands in the right place, regardless of which navigator is currently active.
- Keep the per-role navigators (auth, lean onboarding, client, coach) self-contained. Adding a screen to one role does not require touching the others.
- Handle the offline → online transition by flushing the food-log queue when the network returns.

## Key files

| File | What it does |
| --- | --- |
| `RootNavigator.tsx` | Decides between `unauthenticated`, `onboarding`, `coach`, `student`. Owns the `LinkingOptions`, the `NavigationContainer` theme, and the offline banner. There is no global floating chat widget — it was deleted in #63 along with the `hideWidget` predicate; the dedicated AI surface is `AIGuideScreen` under the client `MoreStack`. |
| `AuthNavigator.tsx` | Stack: `Welcome`, `Login`, `CreateAccount`, `ForgotPassword`, `RoleSelection`, `AcceptInvite`, `AuthCallback`, `SupportInbox` (the in-app support screen, so a signup notice that says "contact support" can open it before Settings is reachable; registered as `PreSignInSupportInbox`, which resets a previous user's chat session before opening it, #306 fix round 3). The only navigator that's reachable from a deep link. `RoleSelection` params: `{ inviteAttachError?: string; inviteCode?: string; signupNotice?: SignupRoleNoticeKind } \| undefined`. `inviteAttachError` puts the screen in retry mode after signup reported `invite_attached:false`, and `inviteCode` prefills the field. `signupNotice` (C13) names a role-request fact to show once; the persisted copy in `lib/signupRoleNotice` is the fallback, so a remount cannot lose it. |
| `CoachWizardNavigator.tsx` | The coach gate (`RootNavigator` shows it while `GET /coach/onboarding` reads incomplete, and also when that read fails or stalls past the 8 s startup limit while this coach's own phone draft `coach_consult_v1:<id>` holds an unfinished consultation; that draft read is bounded to 2 s, and with no draft the start still fails open to the dashboard. ONB-SWEEP-SOL-135 B2, `src/__tests__/rootNavigatorCoachResumeOffline135.test.tsx`). Default export: the coach consultation (`src/screens/coach/consultation/CoachConsultationFlow`, K0-K8, see `src/screens/coach/README.md`), the only onboarding for every new coach; no money step comes before it (B02). Completion (`POST /coach/consultation/complete`, or the wizard step 6 + complete on a backend without it) writes the local complete flag and emits `authEvents`, so the coach app opens on Clients; Get paid, first package and invite stay as optional next steps on the Overview checklist. Paused screen offers Sign out (confirmed). COACH-CONSULT-M-134, agent 134. The earlier five-step setup is the named export `CoachSetupWizard`, not routed, kept for its tests (safe-area insets, 44 pt Back, cold-resume Back by replace, COACH-EDGES-132). |
| `LeanOnboardingNavigator.tsx` | Stack: `LeanQ1`–`LeanQ6`. Optional Q4 sex/body metrics and explicit Q5 birth year feed the existing target calculation. Q6 finishes; local completion does not trigger another Day-1 onboarding flow while profile sync is pending. |
| `ConsultationOnboardingNavigator.tsx` | Used when the consultation flag is on and `/me/onboarding` does not report `consultation_available: false`. Otherwise clients use lean onboarding. Completed consultation clients enter the app without Day-1 onboarding or the first-win prompt; lean clients retain the separate first-win action. See `src/screens/consultation/README.md`. |
| `Day1OnboardingNavigator.tsx` | Retained legacy stack, not mounted after completed onboarding. Notifications advance directly to Ready; the ineffective check-in-time step is not registered, and an old CheckInTime checkpoint maps to Ready. |
| `OnboardingNavigator.tsx` | The legacy 10-step flow. Preserved but not routed to from a fresh signup today. |
| `ClientNavigator.tsx` | 4-tab bottom bar, icons-only. Route names: `Home`, `WorkoutTab`, `Log`, `MoreTab`. Accessibility labels: `Home`, `Train`, `Log food`, `Profile and more`. `Home`, `WorkoutTab`, and `MoreTab` are nested native stacks; `Log` is a single screen (`LogScreen` — food/macro logging). The Profile tab (`MoreTab`) houses every secondary screen, including `AIGuide` and `Membership`. `RecipeDetail` accepts a single serialisable `{ recipeId: string }` param — never the whole recipe object. Paid screens are wrapped with `withProtectedScreen`; `Messages` is deliberately not (basic DM with the coach is free server-side, and it is the action the iOS coach-managed gate offers). |
| `CoachNavigator.tsx` | 5-tab bottom bar (Clients / Dashboard / Templates / Messages / Settings). The Clients tab is a nested stack (`ClientsList`, `ClientDetail`, `ClientMessages`, `InviteCodes`). The Settings tab is a nested stack (`SettingsHome → Billing → TrustCenter`) so child screens are reachable from a single tab. `CreditPackCheckout` is registered through `withNonP2PPurchaseGate(…, creditPacksHidden)`, so on iOS the route (including direct and notification navigation) renders the neutral hidden state, except on a US-link build (`EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK`, clinic profile), where it opens and hands checkout to the system browser. Tab bar look (REDO-COACH-133): bone bar with a hairline top, outline icons (Team uses `briefcase-outline` so it no longer matches Community), 11 pt Inter labels (500 focused, 400 at rest), a forest unread badge and a selection haptic on every tab press. Tabs, order, routes and badge counts are unchanged; the Coach row of `__tests__/tabBarPolish125.test.ts` reads `bgPrimary`. |
| `CommunityNavigator.tsx` | The client Community tab stack (`featureFlags.communityTab`), behind the one-time `CommunityTermsGate`. A client with no coach sees `CoachOnlyGate` ("Community comes with a coach", one forest "Join a coach" that opens the coach-code path) in front of the terms and the stack (owner 10-09 00:0x, B-ROMANLOCK-135). |

## Data flow

`CoachMealTemplates` is intentionally unregistered: it had no navigation caller or deep-link entry. The meal-template API and hooks remain; daily meal plans, client Meal plan, workout builder and invites keep their existing routes (MEAL-TEMPLATES-ROUTE-132).

`ClientsStack.ClientDetail` accepts optional `initialTab: 'workouts' | 'mealplan'`. Omission opens Summary; AI meal-plan approval requests `mealplan`, and route updates also select that tab on an already-mounted screen.

```
App.tsx mounts RootNavigator
   │
   ├─► bootstrapAuth()
   │     │
   │     ├─ secureStorage.getItem('supabase_token')      // migrates legacy AsyncStorage on first read
   │     ├─ AsyncStorage.getItem('user_data')
   │     ├─ AsyncStorage.getItem('needs_role_selection') // gate after Google / codeless signup
   │     ├─ AsyncStorage.getItem('onboarding_complete')  // student-only
   │     │
   │     └─► setAuthState('unauthenticated' | 'onboarding' | 'coach' | 'student')
   │
   ├─► authEvents.onAuthChange ─► bootstrapAuth        // re-runs on logout / login emit
   │
   └─► useNetworkStatus ─► flushFoodLogQueue() on offline → online
```

Deep links are parsed by `linking` in `RootNavigator`:

```
prefixes: ['tgp://', 'https://app.trygrowthproject.com']
config:
  Welcome:        'welcome'
  Login:          'login'
  CreateAccount:  'join/:invite_code?'   // both /join and /join/<code> map here
```

This means:

- `tgp://join` and `tgp://join/AB12CD` both resolve to `CreateAccount`. The optional param is parsed straight through.
- `https://app.trygrowthproject.com/join/AB12CD` resolves the same way **after** Android App Links / iOS Universal Links verify silently. Until the hosted association files are live, the URL opens a chooser (Android) or Safari (iOS) — at which point the user can paste the code into the welcome screen manually.
- Signed-in users are not routed by deep links because the matching screen is not mounted under their navigator. This is intentional: a signed-in client tapping an invite URL is a no-op.

## App-store / deep-link dependencies

- Android intent filters are declared in `app.json → expo.android.intentFilters` and must match the linking prefixes here. The two declared shapes are `tgp://join` and `https://app.trygrowthproject.com/join`.
- `autoVerify: true` on the Android filter requires `https://app.trygrowthproject.com/.well-known/assetlinks.json` to be hosted with the SHA-256 of the Play App Signing key.
- iOS `expo.ios.associatedDomains: ['applinks:app.trygrowthproject.com']` requires `https://app.trygrowthproject.com/.well-known/apple-app-site-association` with the bundle id `com.growthproject.app` and the matching team id.
- The custom scheme `tgp://` is also used for Supabase OAuth return (`tgp://auth/callback`). It is not registered as a screen here because the OAuth WebBrowser closes the auth session itself; control returns to whichever screen kicked off the sign-in. Don't repurpose this path without checking `utils/googleAuth.ts`.

See `docs/well-known/README.md` for hosting and verification commands.

## Security and tenancy

- The auth gate is the only path to a signed-in navigator. There is no escape hatch from `AuthNavigator` to a tab.
- `RoleSelectionScreen` is reachable from the email-signup verify step and from Apple/Google signup completion. It only ever selects the client role, so there is no client-side path to a coach role.
  - C13 (backend #597): a user whose **server-returned** `user.role` is `'coach'` never reaches RoleSelection. CreateAccount clears `needs_role_selection` and emits `authEvents`; `bootstrapAuth` reads `role === 'coach'` from the user cache and mounts `CoachNavigator` (or the coach wizard). `intended_role` is a request the app sends only when the live signup policy has `role_choice: true` and no invite code is involved; it is never a grant.
  - With a code, `POST /auth/attach-invite-code` is the single redemption. It resolves permanent CoachProfile `GP-` codes and InviteCode rows. The screen then calls `selectRole('student', undefined)`; it never calls `selectRole(code)` (audit #303 A2).
  - In retry mode (`inviteAttachError`), a code is required. The screen offers "Keep my current coach" when the user already has one, or "Continue without a coach for now" when the policy is codeless. It never skips automatically (B4).
  - Signup policy comes from the shared `lib/signupPolicy.loadSignupPolicy`: live, then last-known this session, then unknown. On unknown, the code is optional and Google is hidden, so a policy outage never blocks codeless signup (A1).
- `secureStorage` migrates any legacy AsyncStorage token into Keychain / Keystore on first read. After migration the AsyncStorage copy is deleted.
- The role read from `user_data` is treated as advisory only. The backend re-derives role from the JWT on every request, so a tampered local copy cannot grant access.

## Environment variables

`RootNavigator` does not read env directly. The navigators it mounts do, transitively, through `services/api`, `services/realtime`, and `lib/analytics`.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Splash never resolves | `src/config/env.ts` threw because Supabase env is missing | Fix the env in `.env` (dev) or EAS build config (prod) — this is a deliberate loud-fail. |
| `tgp://join/<code>` opens app but lands on Home instead of CreateAccount | User is already signed in, so the matching screen isn't mounted | Sign out first, or have the client tap the invite URL on a fresh install. |
| Universal link opens a browser instead of the app | `assetlinks.json` / `apple-app-site-association` not hosted, or fingerprint mismatch | Verify with `adb shell pm get-app-links com.growthproject.app` (Android) and Apple's AASA validator (iOS). |
| User stuck in `onboarding` forever | `LeanQ3` never wrote `onboarding_complete=true` (e.g. AsyncStorage full) | Clear app data; `RootNavigator` re-bootstraps fresh. |
| Logout from a deeply-nested screen leaves the screen visible briefly | `signOut` clears storage before the listener fires | Acceptable — `authEvents.emit('logout')` triggers the re-bootstrap; the unauthenticated navigator replaces the tree synchronously. |

## Tests

```bash
npm run typecheck
npm test
```

There are no navigation-level jest tests; the structure is exercised end-to-end by the smoke matrix and by every screen test that imports a navigator type.

## Release notes

- The 4-tab bar (Home / Train / Log / Profile) was consolidated from an earlier 9-tab layout. The old screen names are preserved inside the `MoreStack` so any external `navigate()` calls (analytics, push payloads) keep working.
- The `MoreStack` registers `AIGuide` and `Membership` (sale-readiness, #67). Both are static targets of `MoreScreen` rows; neither is a deep-link target and neither requires backend changes (`Membership` reads only `usersApi.getFoundingNumber` and `aiApi.getStructuredContext`).
- `RecipeDetail` is a serialisable-only route. The list passes `{ recipeId }`, the detail screen reads from the React Query cache for synchronous paint and falls back to `recipesApi.getById`. The shape is asserted in `src/navigation/__tests__/clientNavigator.test.ts`. Do not add screens that pass full domain objects through navigation params.
- There is no global floating chat widget. The `FloatingChatWidget` and the `RootNavigator.hideWidget` predicate it lived behind were deleted in #63. If a future feature wants a shared AI surface, it must be a real screen registered under the relevant navigator — the doctrine (`docs/QUIET_LUXURY_DOCTRINE.md` §6) forbids reintroducing a global FAB.
- The `TrophyShare` route was removed from `ClientNavigator` in #63 alongside the `TrophyShareScreen` and `FirstWinCelebration`. Do not reintroduce it; the doctrine test (`src/__tests__/quietLuxuryDoctrine.test.ts`) will fail the build.
- The `linking` config covers only the unauthenticated path. If a future feature needs to be addressable by a deep link to a signed-in screen, that route must be added under both `ClientNavigator` and `CoachNavigator` configs and the Android intent filter / `applinks:` entry extended in `app.json`.

## Phase 9 — Bell icon entry point (Notification Center)

Both `ClientNavigator` and `CoachNavigator` now inject a bell icon into the header of their respective primary stack navigators.

### ClientNavigator
- Clinic tutorial (featureFlags.clientTutorial, default OFF): the tab navigator is wrapped in `TutorialHost`, and `screenListeners` is now a function. It reports the focused route path (`state` event, via `src/tutorial/navigationFocus.ts`) to the tutorial step machine and captures the tab navigation object so the overlay's "Take me there" can open `Home/Messages`, `MoreTab/Connections` and `MoreTab/Health`. Tab list and routes are unchanged. With the flag OFF the host is a pass-through. See `src/tutorial/README.md`.

Home renders the bell in `HomeHeaderActions` (not `headerRight`), alongside the coach-message entry with its unread count (clients with a coach only; a coachless client sees "Ask Roman" or nothing there, B25). The bell's `NotificationBadge` shows the live unread count (polled every 30 s, refreshed on foreground); tapping opens `HomeStack → NotificationCenter`. When `featureFlags.romanChat` is on, a 32 pt neutral Roman avatar in a 44 pt target opens the existing `MoreTab → RomanChat` destination with `initial: false`, preserving `MoreIndex` underneath on first entry. Roman chat has its own labelled 44 pt Back control in every load state for both client and coach stacks. The More entry, Messages and tab list remain unchanged.

New screen names added to `HomeStackParamList`:

| Name | Screen | Purpose |
| --- | --- | --- |
| `NotificationCenter` | `NotificationCenterScreen` | Global notification list |
| `NotificationPreferences` | `NotificationPreferencesScreen` | Per-kind channel toggles + the fixed quiet hours (read-only) |

The legacy `Notifications` screen name (pointing to the old `NotificationsScreen`) is preserved for backward-compat.

### CoachNavigator

The bell is rendered as `headerRight` on every screen inside `ClientsStackNavigator`. Same badge, same 30-second polling via a separate `useCoachNotificationUnreadCount` hook (so it does not interfere with the existing `useCoachUnreadPolling` that powers the message tab badge).

New screen names added to `ClientsStackParamList`:

| Name | Screen | Purpose |
| --- | --- | --- |
| `NotificationCenter` | `NotificationCenterScreen` | Global notification list |
| `NotificationPreferences` | `NotificationPreferencesScreen` | Per-kind channel toggles + the fixed quiet hours (read-only) |
| `ClientPayments` | `ClientPaymentsScreen` | `{ clientId, clientName? }`. A client's payments with refund, pause, resume and cancel (COACH-PAY-M-130). Registered unflagged; its only entry, Summary > Payments on `ClientDetail`, shows while the server flag `coach_payment_actions` is on. Draws its own Back. |

### Unread count polling

Both navigators use `fetchUnreadCount()` from `src/services/notificationsApi.ts`. While `NOTIFICATIONS_MOCK_ENABLED=true` the count is served from the in-memory mock store. When the backend ships, flip the flag to false — the polling hook needs no other change.

### Deep-link routing from notification taps

`NotificationCenterScreen` calls `routeNotification()` which calls `navigation.navigate(actionScreen, actionParams)` using the value from `notification.actionScreen`. The routing table is documented in `src/screens/notifications/README.md`.
## Phase 8 — Coach Command Center (new coach landing)

As of Phase 8, `CoachNavigator` mounts `CommandCenterScreen` as the first tab (`CommandCenter`), replacing the old `Dashboard` (`CoachHomeScreen`) as the coach home tab.

**Before Phase 8:**
```
CoachNavigator tabs: ClientsStack | Dashboard | Templates | Messages | Settings
```

**After Phase 8:**
```
CoachNavigator tabs: CommandCenter | ClientsStack | Templates | Messages | Settings
```

The `CoachHomeScreen` (`Dashboard`) is preserved as a sub-screen inside `ClientsStack` under the route name `Dashboard`, so any existing `navigate('Dashboard')` calls in analytics payloads, push notification handlers, or deep links keep resolving without a crash.

`CommandCenterScreen` lives at `src/screens/coach/command-center/CommandCenterScreen.tsx` and hosts an internal top-tab bar with 5 views:

| Tab key | View | Navigates to |
| --- | --- | --- |
| `overview` | KPI tile grid | Internal (switches tabs) |
| `at-risk` | At-risk client list | `ClientDetail` via `onSelectClient` |
| `win-streaks` | Active streak list | `ClientDetail` via `onSelectClient` |
| `inbox` | Message thread list | `ClientMessages` via `onOpenThread` |
| `action-queue` | Pending alerts | `ClientDetail` via `onSelectClient` |

See `src/screens/coach/command-center/README.md` for full documentation.

## Day-1 onboarding navigator (final first-run experience)

`Day1OnboardingNavigator` (`src/navigation/Day1OnboardingNavigator.tsx`) is the
new authenticated-but-not-yet-onboarded surface for fresh accounts. It runs in
front of `ClientNavigator` until `profile.day_one_completed === true` is
returned from the backend.

Stack order:

```
Welcome → CoachPairing → Goals → Notifications → CheckInTime → Ready
```

| Screen | Purpose | Persistence | Skip allowed |
| --- | --- | --- | --- |
| `Welcome` | 300 ms reduced-motion-aware brand reveal, greet by first name; shared StepHeader shows “Step n of 6” above a progress hairline | none (cover) | n/a |
| `CoachPairing` | Pair via invite code (manual or deep-link prefill); sharing notice stays above the forest action; spinner while submitting, no premature pairing claim | `POST /auth/attach-invite-code` | Yes — unless arrived via deep link |
| `Goals` | Multi-select coaching goals as Inter hairline rows, with all six choices retained | on device only (Day-1 draft); the backend has no goals field | Yes |
| `Notifications` | Permission ask with value-prop context | `PATCH /users/me/preferences { notif_permission_state }` | Yes — denial does NOT block |
| `CheckInTime` | Pick daily check-in (default 9:00 AM local), 44 pt time controls and tabular values; content scrolls on smaller screens | time on device only; device zone via `PUT /notifications/timezone` (fallback `PATCH /notifications/preferences { timezone }`) | Yes |
| `Ready` | Neutral welcome without premature completion claims, calls `completeDayOne()` + `authEvents.emit()`; offline finish retained | `PUT /profile { onboarding_completed: true }` | n/a |

All step persistence runs through `src/screens/day-one/api.ts`, which applies
exponential-backoff retry with jitter for transient failures and classifies
4xx errors into a `DayOneError` discriminated union so the UI surfaces
structured copy instead of axios strings (Rule 9 — no raw error codes).

This navigator is wired into `RootNavigator` as the `day1onboarding` auth
state. The gate checks `profile.day_one_completed`, the legacy
`profile.onboarding_completed` flag (so existing users aren't re-prompted),
and an AsyncStorage `day_one_completed` fallback so a user who finished the
flow once is never asked again — even if the backend hasn't propagated the
flag yet.

In-flight resume + offline save: the flow writes a checkpoint per advance to
AsyncStorage (`day_one_onboarding_state_v1`). Force-close or "Continue
offline" both serialise the current step + draft + pending sync queue; the
navigator picks the saved step as `initialRouteName` on the next launch, and
ReadyScreen's `flushPendingSync()` drains the queue before flipping the
terminal flag. See `src/screens/day-one/resume.ts`.

Backend follow-ups: `profile.day_one_completed` (boolean) and
`profile.day_one_completed_at` (ISO timestamp) need to be returned by
`GET /profile` and persisted by `PUT /profile`. Until the API returns them,
the client falls back to the local AsyncStorage flag (fail-open).
  - After a successful attach, the server-confirmed `{role, coach_id}` is kept in screen state. If saving on the device then fails (user cache or `needs_role_selection`), the screen shows "Connected, finishing sign-up" and a "Finish sign-up" button. That button retries only the local save and role completion and never redeems the code again (re-audit R3).

### Roman chat history routes (backend #635)

`RomanConversations` (no params) and `RomanConversation` (`{ id, ownerId, startedAt, surface, messageCount }`) are registered in the client More stack (`ClientNavigator.tsx`) and the coach Settings stack (`CoachNavigator.tsx`), next to `RomanChat`, but NOT behind `featureFlags.romanChat`: finding and deleting Roman chats must never depend on the chat flag. See `src/screens/settings/README.md`. Pinned by `src/navigation/__tests__/romanConversationsReachable.test.ts`.

## Payment lockout (S-DUNNING)

Both client branches of `RootNavigator` wrap `ClientNavigator` in `DunningLockoutProvider` (see `src/entitlements/dunning/README.md`). The provider uses the module-level `navigationRef` to read the focused route and to open `MoreTab > DataExport`, `MoreTab > DeleteAccount` and `Home > Messages` from the lockout screen.

## Client tab labels (B26)

The six labelled tabs keep their names; the label uses `typography.tabLabel` / `tabLabelActive` (Inter 11 pt, -0.2 tracking), one line with shrink-to-fit, and `tabBarItemStyle` drops the item's side padding, so "Community" (58.5 pt) fits the 60 pt each tab gets on a 360 pt wide Android phone.
