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

## Notification categories (`NotificationPreferencesScreen.tsx`)

Client Settings > Notifications shows per-category switches (coach messages,
reminders, workout reminders, milestones, system). Each switch PATCHes
`/notifications/preferences` with the mapped backend fields and rolls back on
failure. A failed save shows an inline notice that names the setting and says
what to do next, by status (`notificationPreferenceErrors.ts`): no response =
check the connection; 401 = signed out, sign in again; 429 = wait a minute;
anything else = try again, with the support address and a short reference, and
a Sentry report (status, machine code, reference only).

**Workout reminders** (C05 item 7) map to `workout_reminder_push` and
`workout_reminder_inapp` (default on). The backend sends a short note from
Roman at the client's preferred training time (consultation S2) on their first
session day and every plan day, in the client's local timezone, at most once a
day, and not when that day's session is already logged. The switch reads the
server value on mount. The device timezone is synced to the backend by
`src/services/timezoneSync.ts` (called from `App.tsx` after sign-in and each
time the app returns to the foreground, sent only when the zone or account
changed). Workout reminders go to clients only, so the switch is hidden for
coach and owner accounts.
