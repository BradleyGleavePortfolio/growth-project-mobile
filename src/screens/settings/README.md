# src/screens/settings

Settings-area screens for The Growth Project mobile app.

## Screens

### DeleteAccountScreen

`DeleteAccountScreen.tsx` — GDPR right-to-erasure flow (Phase 10).

**Purpose**

In-app account deletion for both roles (Apple App Review 5.1.1(v); GDPR Art. 17; Washington My Health My Data Act right to deletion). Deletion can be completed entirely in the app: no email step, no contacting support.

**Flow**

1. On open the screen calls `GET /me/delete-account/status`. If a deletion is already scheduled it shows the **status view** (step 5) instead of the form.
2. The user reads what is permanently deleted and what is retained (lists exported as `PERMANENTLY_DELETED` / `KEPT_RECORDS`; keep them in line with the backend finalizer fan-out in `growth-project-backend/src/account-deletion/account-deletion.fanout.ts`).
3. The user types `DELETE` (case-insensitive) or their account email, then **re-authenticates**:
   - password, or
   - on iOS when available, the native Sign in with Apple sheet (`reauthenticateWithApple()` in `src/utils/appleAuth.ts`; requests no scopes and does NOT create a new session).
4. `POST /auth/recent-auth-token` (`{ password }` or `{ provider: 'apple', provider_token }`) returns a short-lived single-use token; `POST /me/delete-account` with header `X-Recent-Auth-Token` schedules the deletion **in the same request** (the 14-day grace period starts now). Apple users also send `apple_authorization_code` so the server revokes their Sign in with Apple tokens. The request is idempotent on the server.
5. **Status view:** the exact permanent-deletion date (`purge_after`), the deleted-data list, **Keep my account** (`POST /me/delete-account/cancel`, after a confirm alert) while `cancellable`, and Sign out. The user is not signed out automatically; the account stays usable during the grace period.

Errors: 401 on re-auth shows "That password is not correct" / "Apple could not confirm it is you"; 429 shows a wait-a-minute message; other failures show the server message. The re-auth request is sent with `skipAuthRefresh` so a wrong password is not replayed by the 401 refresh interceptor against the 5/min throttle.

The coach Settings danger zone and the Trust Center read/cancel the same canonical status (`deletionApi`) and open this screen; neither schedules deletion inline. The legacy `usersApi.deleteAccount` (`DELETE /users/me/account`) is not used by any deletion UI.

**API surface** (`src/services/api.ts`, `deletionApi`)

| Method | Endpoint | Auth |
|--------|----------|------|
| `POST` | `/auth/recent-auth-token` | JWT bearer + password or fresh Apple identity token |
| `POST` | `/me/delete-account` | JWT bearer + `X-Recent-Auth-Token` |
| `GET` | `/me/delete-account/status` | JWT bearer |
| `POST` | `/me/delete-account/cancel` | JWT bearer |

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
- Request form: lists and grace copy, no email/support promises, doctrine tokens, DELETE/email gate plus password requirement, Apple option hidden when unavailable
- Password re-auth: token minted then deletion scheduled with it, date shown, no auto sign-out; 401 wrong password, 429, scheduling failure stays on form
- Apple re-auth: identity token proof, authorization code forwarded, silent cancel
- Status view: scheduled date, cancel returns to the form, cancel hidden when not cancellable, sign out
- Navigation: back and "Cancel — keep my account"

Also: `src/services/__tests__/deletionApi.test.ts` (wire shapes, header, Apple code), `src/services/__tests__/api.refresh.test.ts` (`skipAuthRefresh`), `src/utils/__tests__/appleAuth.test.ts` (`reauthenticateWithApple`).

### DataExportScreen

`DataExportScreen.tsx` — GDPR Article 20 data portability. The user requests a JSON archive of their data; the backend builds it in the background and keeps it for 7 days in private storage. **Download file** asks `POST /v1/me/data-export/download-link` for a fresh link (5 minutes, bound to the signed-in user) and opens it with `Linking.openURL`; the browser saves `tgp-data-export-YYYY-MM-DD.json`. Nothing is stored inside the app.

**State machine**

```
         mount
           │
           ▼
        loading  ──loadStatus── ─── 404 ──► idle
           │                          ├── PENDING/RUNNING ──► polling
           │                          ├── READY + download_available ──► ready
           │                          ├── READY, no stored file ──► unavailable
           │                          ├── FAILED ──────────► failed (Request my data)
           │                          ├── EXPIRED ─────────► expired
           │                          └── error ───────────► failed (Check again)
           │
        idle ──press "Request"──► requesting ──success──► polling
                                              ├── 409 IN_PROGRESS ──► reload (polling)
                                              ├── 409 RATE_LIMITED ──► reload (ready + notice)
                                              └── other error ──► failed (Request my data)

        polling ──poll every 5s── ─── READY ──► ready / unavailable
                                       ├── FAILED ──► failed
                                       ├── EXPIRED ──► expired
                                       └── 3 errors in a row ──► failed (Check again)

        ready ──press "Download"──► POST /download-link (fresh 5-minute link)
                                     ├── ok ──► Linking.openURL (browser saves the file)
                                     ├── 410 EXPIRED ──► expired
                                     ├── 410 FILE_MISSING ──► unavailable
                                     ├── 409 NOT_READY / 404 ──► reload
                                     └── other error ──► ready + notice (Download stays)
              ──press "Request new"──► requesting (hidden until next_request_at)

        unavailable ──press "Request a new export"──► requesting
        failed ──press "Request my data" / "Check again"──► requesting / loading
               ──press "Cancel"──► idle
        expired ──press "Request new"──► requesting
```

Every failure names what happened and the next step that works. Unknown
failures show a visible "Reference: ..." (server `request_id`, else the
`X-Request-Id` this app sent, else a fresh id) with `SUPPORT_EMAIL` from
`src/constants/support.ts`, and the same reference is sent to Sentry;
offline, ended session, storage down and throttling each have their own copy.

Fix round 1 (#327) guarantees:

- Every 2xx body is validated in `dataExportApi.ts` (`parseDataExportRecord`,
  `parseDownloadLink`); a malformed answer is a `DataExportResponseError`
  (`DATA_EXPORT_BAD_RESPONSE`) and nothing is opened.
- Every async step is bound to the signed-in user and this screen instance;
  logout, login, auth change, user change or unmount retire it, so a late
  link for account A never opens in account B's session.
- Status polling is single-flight (`setTimeout` chain with a generation
  fence); a vanished export (`null`) ends polling with "We could not find
  your export".
- The "Request a new export" action re-renders when `next_request_at`
  passes (timer plus app-foreground check).
- Sentry never receives the archive link or token: the screen reports a
  sanitized `DataExportFailure`, and `src/services/sentryScrub.ts` scrubs
  every event and breadcrumb in `beforeSend`/`beforeBreadcrumb`.

---

**API surface** (`src/services/dataExportApi.ts`)

| Method | Path | Status |
|--------|------|--------|
| `POST` | `/v1/me/data-export/request` | LIVE |
| `GET` | `/v1/me/data-export/status` | LIVE |
| `POST` | `/v1/me/data-export/download-link` | LIVE with backend B-EXPORT (fresh 5-minute link per tap) |
| `GET` | `/v1/me/data-export/download?token=<jwt>` | Opened via `Linking.openURL` (browser); streamed from the private bucket |

Reached from the "Data export" row in the client and coach Settings screens.
