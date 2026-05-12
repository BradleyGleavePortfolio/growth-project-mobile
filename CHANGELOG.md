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

