# src/screens/settings

Settings-area screens for The Growth Project mobile app.

## Screens

### DeleteAccountScreen

`DeleteAccountScreen.tsx` — GDPR right-to-erasure flow (Phase 10).

**Purpose**

Allows a user to initiate permanent deletion of their account from within the app. The flow follows the two-phase model specified by GDPR Article 17 ("right to erasure"):

1. User reads a clear summary of what will be permanently deleted and what must be retained for legal compliance.
2. User types `DELETE` (case-insensitive) or their registered email address to demonstrate deliberate intent. The confirm button is disabled until this gate passes.
3. On submit, `POST /me/delete-account` sends a single-use confirmation link to the user's registered email (24-hour TTL).
4. On API success, an `Alert.alert` explains the 14-day grace period and that the user can cancel from Settings. Pressing OK calls `signOut()`.

The 14-day grace period and cancellation flow are handled on the server side. The mobile client does not need to implement the cancel flow here because the user's active session ends on sign-out. The cancel endpoint (`POST /me/delete-account/cancel`) remains accessible during the grace window; the user would need to sign back in and navigate to Settings to invoke it.

**API surface**

| Method | Endpoint | Auth required |
|--------|----------|---------------|
| `POST` | `/me/delete-account` | JWT bearer |

See `src/services/api.ts` — `deletionApi.requestDeletion()`.

**Navigation**

- Coach flow: `SettingsStack` in `src/navigation/CoachNavigator.tsx`
- Client flow: `MoreStack` in `src/navigation/ClientNavigator.tsx`

Both navigators register `DeleteAccountScreen` without a header tab entry; it is reached from the "Delete account" row in the respective SettingsScreen.

**Accessibility**

Every interactive element carries both `accessibilityRole` and `accessibilityLabel`. The confirm button exposes `accessibilityState={{ disabled: true }}` when the gate has not been passed so VoiceOver and TalkBack communicate the state correctly.

**Theming**

All colours are consumed via `useTheme().colors`. No hardcoded colour values. Display heading uses Cormorant Garamond; body copy uses Inter — both in line with the quiet-luxury doctrine.

**Doctrine compliance**

The screen is scanned by `src/__tests__/quietLuxuryDoctrine.test.ts`. It contains:
- No emoji or pictograph characters
- No forbidden tokens (`income`, `finance`, `netWorth`, `confetti`, `trophy`, `BadgeCabinet`, `Leaderboard`)
- No `fontWeight: '700'` or `'800'`
- No `TODO`, `FIXME`, or `XXX` markers
- No `Ionicons name="flame"` or `name="trophy"` references

**Tests**

`src/screens/settings/__tests__/DeleteAccountScreen.test.tsx`

Coverage:
- Render: title, 14-day grace copy, permanently-deleted list, kept-for-legal list, confirmation input, initial disabled state
- Confirmation gate: disabled on empty/wrong input, enabled on "DELETE" (case-insensitive), enabled on matching email (case-insensitive)
- Success: calls `deletionApi.requestDeletion`, shows success Alert with grace message, calls `signOut` after Alert OK
- Error: shows error text on API failure, does not call signOut, clears error when input changes
- Navigation: back button calls `navigation.goBack`, cancel button calls `navigation.goBack`
- Doctrine: rendered JSON contains no forbidden tokens

**Related files**

| File | Role |
|------|------|
| `src/services/api.ts` | `deletionApi` — HTTP client wrappers |
| `src/screens/client/SettingsScreen.tsx` | "Delete account" navigation row (client) |
| `src/screens/coach/SettingsScreen.tsx` | "Delete account" navigation row (coach) |
| `src/navigation/ClientNavigator.tsx` | Route registration (`MoreStack`) |
| `src/navigation/CoachNavigator.tsx` | Route registration (`SettingsStack`) |
| Backend: `src/account-deletion/` | State machine, cascade, finalize |
---
# Data Export Screen — `src/screens/settings/`

This screen implements GDPR Article 20 (right to data portability) for the mobile app. It lets any user (coach or client) request a complete copy of their personal data, check the status of an in-progress export, and download the finished file when it is ready.

> **GDPR dependency note:** This screen is closely linked to the account deletion flow. If a user intends to delete their account, they should download their data here first. Once deletion is confirmed, the data cannot be recovered. The screen surfaces this warning at the bottom of the page.

---

## Screens

| Screen | File | Purpose |
|--------|------|---------|
| `DataExportScreen` | `DataExportScreen.tsx` | Main screen: explanation, request button, status display, download button. |

---

## State machine

```
         mount
           │
           ▼
        loading  ──loadStatus── ─── 404 ──► idle
           │                          ├── PENDING/RUNNING ──► polling
           │                          ├── READY ──────────► ready
           │                          ├── FAILED ──────────► failed
           │                          └── EXPIRED ─────────► expired
           │
        idle ──press "Request"──► requesting ──success──► polling
                                              └──error───► failed

        polling ──poll every 5s── ─── READY ──► ready
                                       ├── FAILED ──► failed
                                       └── EXPIRED ──► expired

        ready ──press "Download"──► Linking.openURL (external browser)
              ──press "Request new"──► requesting

        failed ──press "Try again"──► requesting
               ──press "Cancel"──► idle

        expired ──press "Request new"──► requesting
```

---

## API endpoints consumed

| Method | Path | Status |
|--------|------|--------|
| `POST` | `/v1/me/data-export/request` | LIVE |
| `GET` | `/v1/me/data-export/status` | LIVE |
| `GET` | `/v1/me/data-export/download?token=<jwt>` | Opened via `Linking.openURL` (browser) |

---

## Where it is wired

- **Client Settings screen:** `src/screens/settings/ClientSettingsScreen.tsx` — "Data export" row under "Account" section.
- **Coach Settings screen:** `src/screens/settings/CoachSettingsScreen.tsx` — same placement.

---

## Env vars / feature flags

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_BASE_URL` | Base URL for the download redirect. Defaults to `https://api.thegrowthproject.app`. |

---

## Tests

| File | What it asserts |
|------|----------------|
| `src/screens/settings/__tests__/DataExportScreen.test.tsx` | Render, request flow, status polling, expired state, accessibility. |

Specific test cases:
- Heading and included-data list render
- Request button shown in idle state
- Moves to polling state after requesting
- 409 Conflict shows "already in progress" error
- Generic network error shows error state
- Polling transitions to READY state
- File size and expiry date shown when ready
- Download button present when READY
- Polling transitions to FAILED state
- Initial EXPIRED status renders expired state
- Request new export from expired state works
- All interactive elements have `accessibilityLabel` + `accessibilityRole`

---

## Future work

- **Push notification on ready:** Rather than polling, the app could receive a push notification when the export completes.
- **Progress bar:** Show a rough completion percentage during RUNNING state (requires a backend progress field on the export record).
