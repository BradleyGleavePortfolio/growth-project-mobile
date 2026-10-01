# Changelog

All notable changes to the Growth Project mobile app are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added — Consultation onboarding (consult-v1), behind a flag

- Config-driven consultation engine (`src/lib/consultation/`): screens as data with chapters, templates, validation and conditions; chapter progress, back, resume and per-chapter save via `PUT /me/onboarding/consultation`.
- `src/screens/consultation/`: W1, then P0 "Before we start" with two boxes (D2: box 1 required, training waiver and coaching use, recorded by the intake as `consult-consent-v2` with the copy hash; box 2 optional and unticked, Roman and AI processed by Anthropic, recorded non-blocking through `POST /me/ai-consent/roman` as `client-ai-v3`) before any question, G1 to C1, P1 to P7 screening with the conditional P8 message, summary, preparing, macro and plan reveals from `POST /me/onboarding/complete` with 409 handling.
- `featureFlags.consultationOnboarding` (`EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING`), off by default, on in the new `clinic` EAS profile. Flag off keeps the lean flow unchanged.
- Settings > Privacy > Roman and AI (`RomanAiConsentScreen`): shows the box 2 choice from `GET /me/ai-consent`, allow and withdraw with a confirmation, a calm "unavailable right now" while the endpoint returns 404 / 503, and a pointer to Settings > Account > Delete account for stopping all collection. The client Settings section "Data & Privacy" is renamed "Privacy" and the deletion row is now "Delete account" in the Account section, matching the approved consent copy. P0 links the Privacy Policy below the two boxes.
- Second fix round (Opus audit): finishing the consultation goes straight to the app with the flag on (no Day-1 flow or Day-1 win); cleared notes and deselected details are sent as `null`; one record per P0 Continue; accurate copy for `completion_in_progress` and `invalid_answers`; simple macro mode; keyboard insets; drafts from an earlier install are deleted.
- Privacy and correctness (PR #310 fix round): the flow is excluded from PostHog touch autocapture; nothing is uploaded before the agreement is recorded, and the first save is P0 alone (consent-first); the stored agreement must match the displayed copy version, and stale or rejected (`409 consent_missing`) records go back to P0 unticked; the local draft is encrypted in SecureStore, expires after 30 days, and is purged on sign-out, account deletion and finish with late writes fenced; saves are serialized and coalesced; resume reconciles with the server by revision and timestamp; the frame respects safe-area insets.

### Added — Phase 10 — GDPR right to erasure

- **DeleteAccountScreen** (`src/screens/settings/DeleteAccountScreen.tsx`): new screen
  implementing the GDPR Article 17 right-to-erasure user flow.
  - User must type `DELETE` (case-insensitive) or their registered email address
    to enable the confirm button, preventing accidental taps.
  - On confirm, calls `POST /me/delete-account` which emails a single-use
    confirmation link (24-hour TTL) to the user's registered address.
  - Success alert explains the 14-day grace period and cancellation option before
    signing the user out via `signOut()`.
  - Error state displays the API error message inline without blocking retry.
  - Fully accessible: every interactive element carries `accessibilityRole` and
    `accessibilityLabel`; confirm button exposes `accessibilityState.disabled`.
  - Doctrine-clean: no emoji, no forbidden tokens, theme tokens only,
    Cormorant Garamond display heading, Inter body copy.

- **`src/services/api.ts`**: `deletionApi` object and `DeletionStatus` interface.
  - `deletionApi.requestDeletion()` — `POST /me/delete-account`
  - `deletionApi.getDeletionStatus()` — `GET /me/delete-account/status`
  - `deletionApi.cancelDeletion()` — `POST /me/delete-account/cancel`

- **Client SettingsScreen** (`src/screens/client/SettingsScreen.tsx`): added
  "Delete account" navigation row in the Data & Privacy section, navigating to
  `DeleteAccountScreen`.

- **Coach SettingsScreen** (`src/screens/coach/SettingsScreen.tsx`): updated
  existing deletion row to navigate to `DeleteAccountScreen` instead of calling
  the legacy inline alert.

- **ClientNavigator** (`src/navigation/ClientNavigator.tsx`): registered
  `DeleteAccountScreen` in `MoreStack`.

- **CoachNavigator** (`src/navigation/CoachNavigator.tsx`): registered
  `DeleteAccountScreen` in `SettingsStack`.

- **Tests** (`src/screens/settings/__tests__/DeleteAccountScreen.test.tsx`): 16
  unit tests covering render, confirmation gate, success flow, error flow,
  navigation, and doctrine compliance.

- **README** (`src/screens/settings/README.md`): documents the screen, its API
  surface, navigation wiring, accessibility, theming, doctrine compliance, test
  coverage, and related files.

## Phase 9 — Notification Center + Preferences (2026-05)

### Added

- **`src/screens/notifications/NotificationCenterScreen.tsx`** — Global in-app notification center. Paginated list (cursor-based, 25/page), pull-to-refresh, infinite scroll, read/unread state, mark-as-read, mark-all-read, deep-link routing from notification to destination screen, empty state "You're all caught up."
- **`src/screens/notifications/NotificationPreferencesScreen.tsx`** — Per-kind, per-channel toggle matrix (8 kinds × 3 channels: push, in-app, email). Mute-all toggle. Quiet hours with 24-hour time pickers (30-minute step). Every toggle has a label and a 1-sentence description.
- **`src/components/NotificationBadge.tsx`** — Unread count badge for the bell icon. Count capped at "99+". Theme accent (forest) background. Renders nothing at count = 0.
- **`src/components/NotificationRow.tsx`** — Single notification list row. Kind-based Ionicons icon, read/unread left-border, title, body preview, relative timestamp.
- **`src/components/ForegroundNotificationBanner.tsx`** — In-app banner for foreground push notifications. Animates in from the top, auto-dismisses after 4 s, swipe-up to dismiss, tap to route.
- **`src/services/notificationsApi.ts`** — API wrapper for all notification endpoints. Runs in mock mode (`NOTIFICATIONS_MOCK_ENABLED=true`) until the backend Phase 9 PR merges.
- **`src/services/pushNotifications.ts`** — Extended to add `installForegroundHandler()` (suppresses system alert, writes to `foregroundBannerStore`) and `installNotificationResponseHandler()`.
- **`src/store/foregroundBannerStore.ts`** — Zustand store for foreground push banner state.
- **`src/config/featureFlags.ts`** — Centralised feature flag file. `NOTIFICATIONS_MOCK_ENABLED` flag.
- **Bell icon entry point** — Added to both `ClientNavigator` and `CoachNavigator` headers. Shows `NotificationBadge` with live unread count. Navigates to `NotificationCenter` screen on press.
- **`NotificationCenter` screen** added to `HomeStackParamList` (client) and `CoachStackParamList` (coach), replacing the legacy `Notifications` stub.
- **`NotificationPreferences` screen** added to `MoreStackParamList` (client) and `CoachStackParamList` (coach).
- **`src/screens/notifications/README.md`** — Full doctrine README: purpose, screens + state machines, API endpoints, deep-link routing table, env vars/flags, tests, future work.
- **`src/__tests__/notificationCenter.test.tsx`** — 10 assertions: render, mark-as-read interaction, badge update after mark-read, prefs toggle persistence, empty state.

### Changed

- **`src/navigation/ClientNavigator.tsx`** — `HomeStackParamList` updated to include `NotificationCenter` and `NotificationPreferences`. Bell icon added to `HomeStackNavigator` header. Old stub `Notifications` entry preserved as alias.
- **`src/navigation/CoachNavigator.tsx`** — `CoachStackParamList` extended with `NotificationCenter` and `NotificationPreferences`. Bell icon added to `ClientsStackNavigator` header.
- **`src/navigation/README.md`** — Updated to document the bell icon entry points in both navigators.

---

## [Phase 8] — 2025-05 — Coach Command Center

### Added

- **Coach Command Center** (`src/screens/coach/command-center/`) — new top-level coach landing screen replacing `CoachHomeScreen` as the home tab.
  - 5 tabs: Overview (KPI tiles), At-Risk (clients with amber/red PTM bucket), Win Streaks (clients with active streaks), Inbox (coach message threads), Action Queue (pending coach alerts).
  - All screens: loading / empty / error states with pull-to-refresh.
  - Optimistic dismiss on Action Queue items with rollback on error.
  - Accessible: `accessibilityLabel` + `accessibilityRole` on every interactive element.
  - `testID` attributes on every key element for future E2E targeting.
- **`commandCenterApi.ts`** (`src/services/commandCenterApi.ts`) — typed wrappers for 6 backend endpoints. Ships with `__USING_MOCK_DATA = true` (preview mode) until the Phase 8 backend PR is deployed.
- **Shared components** (`src/components/command-center/`):
  - `KpiTile` — single numeric KPI tile.
  - `AlertRow` — client alert row with bucket colour accent.
  - `MessagePreviewRow` — inbox thread row with unread badge.
  - `MockDataBanner` — preview mode banner.
- **Tests**:
  - `src/__tests__/commandCenterScreens.test.tsx` — render tests for all 5 screens + 3 components.
  - `src/__tests__/commandCenterNavigation.test.tsx` — file existence + navigator registration + non-regression.
- **READMEs**:
  - `src/screens/coach/command-center/README.md` — full feature documentation.
  - `src/navigation/README.md` — updated to document the new coach landing tab.

### Changed

- **`CoachNavigator.tsx`** — `CommandCenter` tab added as the first tab (home). Old `Dashboard` tab moved into `ClientsStack` as a sub-screen under the route name `Dashboard` to preserve backwards compatibility with any existing `navigate('Dashboard')` calls.

### No breaking changes

The old `CoachHomeScreen` is preserved and reachable via `navigation.navigate('Dashboard')` inside the `ClientsStack`. Sessions screens (PR #104), bloodwork review (PR #103), risk board (PR #106), and wave 11 brief (PR #100) are all unchanged.

---

*Earlier phases will be back-filled as their PRs are reviewed and merged.*

---

## Phase 10 — Data Export (2026-05-08)

### Added

- **DataExportScreen** (`src/screens/settings/DataExportScreen.tsx`) — GDPR Article 20 right to data portability.
  - "Request my data" button with plain-English explanation of what is included.
  - Status display: pending / in-progress (auto-polls every 5 s) / ready / failed / expired.
  - "Download file" button when ready — opens signed URL in the external browser (no files stored in app).
  - Legal note reminding users to download before deleting their account.
  - Wired into both Client and Coach Settings screens under the "Data & Privacy" section.

- **dataExportApi** (`src/services/dataExportApi.ts`) — typed API client for the data export endpoints.

### Navigation

- `ClientNavigator`: `DataExport` route added to `MoreStack`.
- `CoachNavigator`: `DataExport` route added to `SettingsStack`.
