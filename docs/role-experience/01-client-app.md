# Client App Experience

The client app is the calm, mobile-first surface for a paying member. One thought per screen, the visual weight in typography, offline-first where it has to be. This brief defines the role contract for clients end to end so that the coach and admin briefs can be written against a stable counterpart.

The shipped client surface today is the floor. This brief calls out what is shipped, what is queued in PRs #92 / #93 / #94 / #96, and where the role-split work lands.

## WHY

A client opens this app to do a small set of jobs that recur every day:

- Read what the coach has asked of them today (Home).
- Train (Workout / Train tab + ActiveWorkout).
- Log food, water, weight, fasting (Log + Plan + Progress).
- Talk to coach + AI (Messages + AI Guide).
- Manage membership (Membership / Billing / Trust Center).

The role contract is: *one screen per primary intent*, no sales chrome, no business analytics. A client does not see KPIs about other clients. A client does not see invoice totals. A client does not see the dunning queue. A client sees their own data, their coach's guidance, and the surfaces they paid for.

## WHEN

- Always available (no time-of-day gating).
- Offline-first for food logging (writes queue locally and replay via `services/foodLogQueue` on reconnect).
- Online-required for messaging, AI Guide, plan fetches, and progress sync.

## WHERE

- Mounted as `ClientNavigator` from `RootNavigator` when `user.role === 'student'` (historical wire value; copy says "client").
- Source: `src/navigation/ClientNavigator.tsx`.
- Screens: `src/screens/client/`.

## WHO

- Every paying member of a coach.
- Free / trial users (when entitlements ship per `docs/expansion-wave-2/09-tier-gated-l2-l3.md`) see the same shell with locked rows behind `UpgradePromptRow`.
- A coach who is also enrolled with another coach will need the role-switcher described in `02-coach-app.md` §Role switching.

## WHAT (Information Architecture)

The IA is the shipped 4-tab shell. Wave 2 features extend `MoreStack`; they do not add new tabs.

### Tab bar (4, icons-only)

| Tab | Route | Wraps | One thought |
| --- | --- | --- | --- |
| Home | `Home` | `HomeStack` (`HomeMain / Habits / Notifications / Messages`) | "What does my coach want from me today?" |
| Train | `WorkoutTab` | `WorkoutStack` (`WorkoutMain / ActiveWorkout / RoutineBuilder / CoachGuidelines`) | "Move." |
| Log | `Log` | single screen (`LogScreen`) | "Did I eat? How much?" |
| Profile | `MoreTab` | `MoreStack` (everything else) | "My account, my coach, my AI." |

### MoreStack (everything secondary)

`MoreIndex / ProfileMain / Recipes / RecipeDetail / GroceryList / ShoppingList / PrepGuide / Fast / Community / Progress / Settings / Widgets / Report / Learn / Plan / TrustCenter / Preferences / AIGuide / Membership`.

The two top rows on `MoreScreen` are **Guidance** (`AIGuide`) and **Membership** (`Membership`). The rest sit below.

### Wave 2 / expansion additions (queued, not implemented)

Each lands inside `MoreStack` unless the brief explicitly negotiates a tab change (none currently do):

- **Weekly check-ins (#92/05)** — `MoreStack → CheckIn` form + history. Reads the coach's intake template.
- **Challenges (#94/01)** + **Leaderboards (#94/02)** — `MoreStack → Challenges → ChallengeDetail`. Visibility scopes per #94/02.
- **Profile images / avatars (#94/03)** — extends `EditProfileScreen` and `ProfileScreen`. Initials fallback.
- **Coach content boards (#94/04)** — `MoreStack → ContentBoard → ContentItem`.
- **Public coach profile (#92/16)** — deep-link target only on the client side; the public page itself is web.
- **Whop-style Storefront / Marketplace / Communities / Events / Calls / Replays / Rewards (#96)** — *client-visible* portions land in `MoreStack` under a new **Discover** entry. Coach-side authoring lives in the coach app.

A client never sees the Programs / Offers / Storefront *authoring* screens, the affiliate dashboard, the AI business copilot, the revenue dashboard, the application-funnel inbox, or the moderation queues. Those are coach-side and deliberately not exposed in `ClientNavigator`.

## HOW (navigation, role entry, role switching)

- **Role entry**: `RootNavigator.bootstrapAuth()` resolves to `student` when the JWT user has `role === 'student'` and onboarding is complete. The lean 3-question onboarding (`LeanOnboardingNavigator`) precedes the first paint of the client tabs.
- **No global FAB**: the AI surface is `AIGuideScreen`, reached from the Guidance row. There is no floating chat widget. (The doctrine forbids it; its removal is locked in.)
- **Deep links**: `tgp://join/<code>` and `https://app.trygrowthproject.com/join/<code>` route to `CreateAccount` (signed-out) or are no-ops (signed-in). New deep-link routes follow `docs/platform-readiness/11-deep-links-readiness.md`.
- **Role switching** (future): a user with both roles toggles via the **Profile → Switch to coach view** row described in `02-coach-app.md`. Not implemented today.

## Onboarding

- New clients run `LeanOnboardingNavigator` (3 questions, < 60 s to first win).
- Legacy users with `onboarding_complete=true` skip onboarding entirely.
- Sync drift between server (`profile.onboarding_completed`) and `AsyncStorage` (`onboarding_complete`) is reconciled in `RootNavigator.bootstrapAuth`.
- A profile-completion gate (#83) nudges a partially filled profile from the Home screen.
- New onboarding fields (intake templates per #92/14) are inserted into the lean flow, not as a separate screen.

## Permissions

Native permissions used by the client app today:

| Permission | Read by | Why |
| --- | --- | --- |
| Camera (`NSCameraUsageDescription`) | barcode scanning in Log | Optional. App degrades to manual search. |
| Notifications | `expo-notifications` plugin | Coach nudges, reminder schedule. Disabled-by-default per the doctrine; opt-in. |
| Location | none | Client app does not request location. Wave 2 events / calls (#96/08) keeps location off-device. |
| Photos | image picker (future avatars per #94/03) | Read-only access; processed client-side and uploaded. |

The client app never requests `RECEIVE_BOOT_COMPLETED`, never enables background fetch beyond what Expo defaults, and never requests contact-book access.

## Design differences vs coach

This is the hinge of the role split. The client app is:

- **Calm**: typography-led, `bone` background, single forest accent, ample whitespace.
- **One thought per screen**: Home is a date headline + one CTA + a 2×2 grid. The Log screen is the only screen with day-selector chrome.
- **Icons-only tab bar** with accessibility labels. Four tabs, fixed.
- **No KPIs**: the client never sees a "logging rate" or "client count". Their numbers are macros, weight, streak — and "streak" no longer ships per PR #70 (vocabulary excised).
- **Slow motion**: `motion.duration.base = 400ms` with `decel` easing. No springs.

The coach app is the inverse: dense, KPI-led, multi-column where the device permits, modal-heavy authoring. See `02-coach-app.md` §Design differences.

## Shared components vs separate surfaces

The role split is not a code fork. Both roles share:

- The theme (`src/theme/`).
- The API client (`src/services/api.ts`).
- The Supabase auth state machine.
- The chat / messaging primitives (`src/components/Chat*`, `services/realtime.ts`).
- The `TrustCenterScreen` (lives outside both `screens/{client,coach}/` folders).
- All of `src/components/` that is genuinely role-agnostic (e.g. `OfflineBanner`, `HapticPressable`, `AsyncBoundary`).
- The notification primitives (`src/utils/notifications.ts`, the push token registration).

What is **separate**:

- `src/screens/client/` and `src/screens/coach/` are sibling folders. Neither imports from the other.
- The two `MessagesScreen.tsx` files (one per folder) intentionally diverge — the client thread is one-on-one with the assigned coach; the coach inbox spans every client.
- `SettingsScreen.tsx` is duplicated per role because the rows differ (client: reset onboarding, link to Trust Center; coach: business profile, billing portal, deletion-status row, invite codes entry).

## Notification strategy

- **Push notifications** through `expo-notifications`. Tokens registered server-side and addressed by user id.
- **Coach nudges** land in `NotificationsScreen` (`nudgesApi`). The push payload deep-links into `Notifications`.
- **Message broadcasts** ping the client in-app via Supabase Realtime; a 60 s safety poll covers WebSocket drops.
- **Quiet hours** are honoured server-side; the mobile app does not schedule local notifications other than the fasting timer reminders.
- The client never receives a *coach-targeted* notification (e.g. "You have 12 clients flagged"). Notification channel routing is server-enforced, not client-enforced.

## Dashboard widgets (Home + Progress)

The client "dashboard" is `HomeScreen` and `ProgressScreen`. There is no coach-style alerts feed.

- **HomeScreen**: editorial date headline, single "CONTINUE" CTA, 2×2 number grid (calories, protein, water, ~~streak~~ — the fourth tile is being reworked away from streak per PR #70).
- **ProgressScreen**: weight chart + macro adherence (`weightApi`, `logApi.getWeekly`).
- **Widgets (iOS / Android)**: setup walkthrough in `WidgetsScreen`. Native widgets themselves are an optional Wave 2 follow-up (queued in `docs/expansion-map`).

Widgets the client app **does not** render: client list, alerts, dunning queue, revenue, attention panel, intake-funnel inbox, copilot suggestions. Those are coach-only.

## Offline / loading / error states

- **AsyncBoundary** (`docs/platform-readiness/07-loading-error-empty-states.md`) wraps every query-backed screen with `loading` / `error` / `empty` states. No raw spinners. No "Something went wrong" without a retry CTA.
- **OfflineBanner** sits at the top of every authed state via `RootNavigator`. It wraps both navigators.
- **Food log queue**: writes go through `services/foodLogQueue`; reads paint immediately from local SQLite + React Query persisted cache. Queue flushes on `online` transition (handled in `RootNavigator`).
- **Realtime drops**: chat falls back to a 60 s poll.
- **Plan / recipes / lessons**: cached in expo-sqlite for offline read.
- **Errors**: surface backend errors verbatim — never a generic "Something went wrong." Per the doctrine.

## Test plan (per implementation PR)

Each role-split implementation PR carries the following test budget. This brief is docs-only, so the budget below is the contract for the *next* PR that touches `ClientNavigator`:

- Unit: navigator shape (`__tests__/clientNavigation.test.ts`), AsyncBoundary contract, food-log queue replay.
- Integration: smoke walk through Home → Log → Add Food → Save → Background → Foreground → confirm persisted.
- Manual smoke: `docs/RELEASE_SMOKE.md` real-device-proof checklist (Android 13+ APK install, iOS TestFlight build).
- Doctrine: no `fontWeight: '700' | '800'`, no "Coming Soon", no emoji, no TODO/FIXME (enforced by lint + grep in CI).

## Analytics

- **PostHog event registry** (`docs/platform-readiness/08-crash-and-analytics-readiness.md`) scopes every client event with `role: 'client'`.
- Required events on this surface (target — to be implemented per platform-readiness/08):
  - `client_home_viewed`, `client_log_food_added`, `client_log_food_saved_offline`, `client_progress_viewed`, `client_message_sent`, `client_ai_guide_message_sent`.
  - Property hygiene: never log meal contents in event properties; the `food_id` is enough. PII redaction per platform-readiness/08.
- **Sentry** wraps the navigator via `services/sentry.ts`. Tags include `role: 'client'` so coach-side and client-side issues are filterable.

## Feature flags

- `useFlag('client_v2_home')` — gates a future redesign without forking the navigator.
- `useFlag('client_check_ins')` — gates the #92/05 weekly check-ins flow on `MoreStack`.
- `useFlag('client_challenges')` — gates the #94/01 challenges entry.
- `useFlag('client_storefront_discovery')` — gates the #96/01 storefront browse on the client side.

The contract is `useFlag()` from `docs/platform-readiness/02-feature-flag-consumption.md` (PostHog-backed). Flags are role-scoped — a `client_*` flag does not affect coach surfaces.

## Acceptance criteria

A client-app implementation PR is *done* when:

- The shipped 4-tab shell still mounts on first paint after auth.
- New surfaces land in `MoreStack` (or extend an existing tab) without altering the four-tab shape.
- Per-module READMEs (`src/screens/client/README.md`, `src/navigation/README.md`) are updated to describe the change.
- AsyncBoundary, OfflineBanner, and `useFlag()` are reused — no inline alternatives.
- The build types-check (`npm run typecheck`) and tests pass (`npm test`).
- The doctrine grep passes (no `'700' | '800'` weights, no `Coming Soon`, no emoji in `src/**`, no TODO/FIXME).
- A real device exercises the new path; the QA matrix (`docs/platform-readiness/10-mobile-qa-matrix.md`) is signed off.
- A coach who logs into the same build does **not** see the new client surface (role gating is verified, not assumed).

## Operator handoff

- **Owning surfaces**: `src/navigation/ClientNavigator.tsx`, `src/screens/client/**`, `src/screens/client/README.md`.
- **Out-of-band**: PostHog flags must exist before a release that consumes them; Sentry release must upload sourcemaps (per `services/sentry.ts`).
- **Done means**: a paying member opens the app, sees their day, logs food in under five seconds, and never wonders whether they are looking at "the coach version."
