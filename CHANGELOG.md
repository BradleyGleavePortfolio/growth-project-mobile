<<<<<<< HEAD
# Changelog

All notable changes to the Growth Project mobile app are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

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
