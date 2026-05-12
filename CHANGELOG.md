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
