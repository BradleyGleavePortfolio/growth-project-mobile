# src/screens/settings

Settings-area screens for The Growth Project mobile app.

## Screens

### DeleteAccountScreen

`DeleteAccountScreen.tsx` — GDPR right-to-erasure flow (Phase 10).

Look (DES-BB-127): bone page, hairline sections instead of cream cards, Cormorant for the title and the deletion date; flow, re-auth and wording unchanged.

**Purpose**

In-app account deletion for both roles (Apple App Review 5.1.1(v); GDPR Art. 17; Washington My Health My Data Act right to deletion). Deletion can be completed entirely in the app: no email step, no contacting support.

**Flow**

1. On open the screen calls `GET /me/delete-account/status`. If a deletion is already scheduled it shows the **status view** (step 5) instead of the form.
2. The user reads what is permanently deleted and what is retained (lists exported as `PERMANENTLY_DELETED` / `KEPT_RECORDS`; keep them in line with the backend finalizer fan-out in `growth-project-backend/src/account-deletion/account-deletion.fanout.ts`).
3. The user types `DELETE` (case-insensitive) or their account email, then **re-authenticates**:
   - password, or
   - on iOS when available, the native Sign in with Apple sheet (`reauthenticateWithApple()` in `src/utils/appleAuth.ts`; requests no scopes and does NOT create a new session).
4. `POST /auth/recent-auth-token` (`{ password }` or `{ provider: 'apple', provider_token }`) returns a short-lived single-use token; `POST /me/delete-account` with header `X-Recent-Auth-Token` schedules the deletion **in the same request** (the 14-day grace period starts now). Apple users also send `apple_authorization_code` so the server can revoke their Sign in with Apple tokens; the response's `apple_revocation` says whether it did. The request is idempotent on the server.
5. **Status view:** the exact permanent-deletion date (`purge_after`), the deleted-data list, **Keep my account** (`POST /me/delete-account/cancel`, after a confirm alert) while `cancellable`, and Sign out. The user is not signed out automatically; the account stays usable during the grace period.
   - Apple copy: the view says Apple removed the app's access to the Apple Account only when `apple_revocation` is `revoked`. Otherwise anyone who may have signed in with Apple (the account lists Apple, they confirmed with Apple, the server tried to revoke, or the provider lookup could not tell) sees a fallback from `appleFallbackCopy` (B-368-1). Right after confirming it starts "Apple has not confirmed that this app’s access was removed." (`APPLE_FALLBACK`; conditional "If you signed in with Apple, ..." when the lookup could not tell); on a later visit, which has no outcome, it says "If Apple did not confirm ..." (`APPLE_FALLBACK_LATER`). Every fallback ends with `APPLE_REMOVAL_STEPS`: Apple's own steps (Apple Support 102571), Settings > your name > Sign in with Apple on iOS 18 or later, and account.apple.com > Sign-In & Security on earlier iOS versions (the app supports iOS 16.4 and later) or any other device. It matches the backend's `SIGN_IN_WITH_APPLE_DELETION_TEXT`. Apple's current name is "Apple Account", not "Apple ID".

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
- Apple re-auth: identity token proof, authorization code forwarded, silent cancel; "Apple Account" on every view, no first person in the form's Apple note
- `APPLE_FALLBACK`: pinned word for word, iOS 18 qualifier before the iPhone steps, web steps for earlier versions
- Status view: scheduled date, cancel returns to the form, cancel hidden when not cancellable, sign out
- Navigation: back and "Cancel — keep my account"

Also: `src/services/__tests__/deletionApi.test.ts` (wire shapes, header, Apple code), `src/services/__tests__/api.refresh.test.ts` (`skipAuthRefresh`), `src/utils/__tests__/appleAuth.test.ts` (`reauthenticateWithApple`).

### RomanAiConsentScreen: "Roman's memory"

The last row of Settings > Privacy > Roman and AI is a "Roman's memory" switch (R11-C2B). It is ON for a live
client-ai-v5 grant. Off asks once, then grants client-ai-v4: Roman stays allowed and stops using his notes. On asks
with the server's v5 text and grants it with the server sha256. Roman's notes are deleted only when the account is
deleted (owner 2026-10-07 11:46, backend #845); there is no control that deletes them, and the off copy says neither
"deleted" nor "kept", so it stays true while production still runs a backend that deletes them on memory off.

### RomanConversationsScreen and RomanConversationScreen

`RomanConversationsScreen.tsx` ("Your conversations with Roman") and `RomanConversationScreen.tsx` (one past conversation, read only). Theme-colored hairline rows retain real dates, times and counts; the list API supplies no first-line text, so no preview is invented. Transcripts use ROMAN / YOU labels, Inter body text and Roman's existing face, with interrupted-reply notes preserved. Navigation, paging, confirmations, retry/support and account-binding behavior are unchanged.

**Why:** owner decision 2026-10-01 20:32 and ruling OR-110-1. Roman chats are kept until the client deletes them or their account, and the box-2 consent copy (`client-ai-v4`) says exactly that, so every chat must be findable and deletable. Roman chats are never visible to coaches.

**Flow**

1. The list (`useRomanChats.ts`) loads `GET /roman/sessions` (30 per page, newest first, keyset `cursor`), shows each chat's local start date and time and message count (coach-tool chats are labelled). Two chats can start on the same local date (the backend keeps one chat per UTC day), so the start time is on every row, the transcript title and the permanent-delete confirm (B-331-1); the confirm also names the message count and, for coach tools, where it happened (`chatIdentity`), and pages with "Show older conversations".
2. Open: `RomanConversationScreen` reads `GET /roman/sessions/:id/messages` (oldest first on screen, "Show earlier messages" pages back). Read only.
3. Delete one: confirm sheet ("permanently deletes ... cannot be undone"), the row leaves at once, comes back in place if the server does not confirm. A 404 `ROMAN_SESSION_NOT_FOUND` on delete is the requested outcome (already gone). A repeat delete is a quiet 204 on the server.
4. Delete all: confirm sheet plus typing `DELETE` (case-insensitive). The list empties at once; on failure the previous list comes back, and after a partial or unknown failure the list is re-read to show what is left.
5. The transcript screen tells the list a chat is gone through `romanChatsEvents.ts` (in memory, carries the owner id and the sign-in epoch).
6. The live Roman chat (`useRomanChat`) stays mounted under these screens when its header opens them. A confirmed Delete (row or transcript) of the chat it holds, or Delete all, reaches it through `romanChatsEvents.ts` (`onGone`, `onErased`): it drops that chat (no erased text stays on screen) and opens a fresh one, and a send waits for the fresh chat, so nothing is sent to an erased chat (B-376-1).

**Account binding (Sol A-331-4, B-331-6):** the list is loaded under an `AccountBinding` (`src/services/accountBinding.ts`: the token subject plus the auth epoch). Every Roman request, read or delete, carries it, and the API client (`services/api.ts`) sends it only with a credential of that same account and sign-in, checked after the SecureStore read, immediately before transport, and again before a 401 replay; otherwise the request is cancelled and never sent. Any `authEvents` emit (sign-out, sign-in, even the same account signing in again) bumps the epoch: reads in flight are aborted, every answer for the old sign-in is dropped (`account_changed`), the list and transcript clear at once, confirm sheets close (the typed DELETE resets; sheets are keyed by sign-in), and stale confirm or retry closures do nothing (`deleteOne(chat, binding)` / `deleteAll(binding)` run only for the list's current binding). The transcript checks the binding before every state change, list event, navigation and report after its delete settles. A refresh overtaken by a sign-out or sign-in never writes its tokens over the new session and never signs the new session out. This is ordered by one fence (`src/services/sessionFence.ts`, A-331-7 / B-331-8): every write of the session keys moves a session generation at call time; the refresh publishes its tokens, and a failed refresh signs out, only while holding the fence for the generation it started in, taken with no await after the check; a sign-in or sign-out that starts meanwhile waits and lands last. A request is replayed after a refresh only in the session it was first sent in; an unbound request whose session ended under it keeps its original 401 (C-331-8). Nothing is stored on the device; the server sends `no-store`. Both screens carry `ph-no-capture`.

**Erased stays erased (Sol B-331-5):** chats the server confirmed erased (or already gone) are remembered for the binding and never re-added by an older page; Delete all fences every page read before it started or settled; reloads asked for during Delete all wait for it; and every list read first waits for this account's erases still in flight (`romanEraseTracker.ts`, also across a same-account sign-out and sign-in), so a read can never be answered from before an erase. An erase that may have left the phone is not aborted (that would not undo it, only hide when it finished).

**Errors** (`romanChatsCopy.ts` `failureView`, from status and machine `code`): offline, 401 signed out, 403 not allowed (reference + support), 404 `ROMAN_SESSION_NOT_FOUND`, uncoded 404 (backend without #635, or Roman chat reading switched off for the transcript, where Delete is still offered), 400 `ROMAN_CURSOR_INVALID` (list re-read from the top), 400 `ROMAN_SESSIONS_QUERY_INVALID` (#635 fix round: an outdated app; update copy, reference, reported), 503 `ROMAN_ERASE_INCOMPLETE` (one / all copy; the one-chat copy never says "not changed", because #635's fix round also uses this code when an erase cannot be confirmed), 429, a changed account (`account_changed`, normally never shown because the screen clears itself), and anything else as a short reference + Contact support (`RomanChatsSupportAction`: the shared `useSupportEmail` + `SupportEmailFallback`, subject with the reference only, a visible fallback with the address when no email app opens) + a Sentry report with status, code and request id only. Delete copy never claims a result the server did not confirm.

**Entry points:** Settings > Privacy > Roman and AI (`RomanAiConsentScreen`, row "Your conversations with Roman"), the Roman chat header (`RomanConversationsButton`), and coach Settings > Privacy (hidden for a sub-coach, C-331-3: the backend Roman routes allow student, coach and owner only). The routes `RomanConversations` / `RomanConversation` are registered in the client More stack and the coach Settings stack without the Roman chat flag, because the backend list and delete routes are outside the chat switch.

**API surface** (`src/api/romanChatsApi.ts`, backend #635 `docs/roman-chat-deletion.md`)

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/roman/sessions?limit=&cursor=` | metadata only, newest first |
| `DELETE` | `/roman/sessions/:id` | 204, idempotent |
| `DELETE` | `/roman/sessions` | 204, every chat, both surfaces |
| `GET` | `/roman/sessions/:id/messages?limit=&cursor=` | behind the Roman chat switch |

**Tests:** `src/services/__tests__/accountBinding.transport.test.ts` (real axios client and interceptors, paused credential read, logout/login, 401 refresh and replay), `src/services/__tests__/sessionFence.refresh.test.ts` (real secureStorage over a pausable SecureStore: a sign-in or sign-out at each awaited refresh, receipt and sign-out boundary), `src/services/__tests__/authActions.signOut.fence.test.ts`, `src/api/__tests__/romanChatsApi.test.ts`, `src/screens/settings/__tests__/RomanConversationsScreen.test.tsx`, `src/screens/settings/__tests__/RomanConversationScreen.test.tsx`, `src/components/roman/__tests__/RomanConversationsButton.test.tsx`, `src/navigation/__tests__/romanConversationsReachable.test.ts`.

### CoachSharingScreen

`CoachSharingScreen.tsx` (Settings > Privacy > Coach sharing): four switches (Workouts, Food logs, Weigh-ins, Check-ins and
habits), each saved at once via `POST /consent/grant | revoke`. Under them one line says connected devices (Apple Health,
Health Connect) are not covered by the switches: the coach reads that data through the coach link only (backend
`wearable-samples.service.ts`), and data already shared stays after a disconnect (FW-BODY B2). The **Connected devices** row
opens `Connections` on the same More stack and shows where the More screen shows that row (iPhone, Health Connect builds,
tutorial). Copy: `src/components/coachSharing/coachSharingCopy.ts`.

## Notification categories (`NotificationPreferencesScreen.tsx`)

Client Settings > Notifications shows per-category switches (coach messages,
workout reminders, milestones, system). Unfilled hairline rows use semantic-theme colours, 13 pt descriptions and 44 pt controls under a quiet category overline. Each switch PATCHes
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
server value on mount, as do all other category switches. Descriptions match each mapped field (messages, recorded milestones and summary email through `digest_email`); no billing/security delivery promise is made. Back, retry and support actions remain. The device timezone is synced to the backend by
`src/services/timezoneSync.ts` (called from `App.tsx` after sign-in and each
time the app returns to the foreground, sent only when the zone or account
changed). Workout reminders go to clients only, so the switch is hidden for
coach and owner accounts.

Removed surface (SMALL-M-COPY-131): the `client_bot` Reminders row. Backend `eat_enabled` is stored but no sender consumes it, so the row offered no delivery control. Existing local `client_bot` values are preserved harmlessly when another preference is saved; the UI no longer maps or PATCHes `eat_enabled`. Rendered tests cover both saved values and the four retained category actions. ([Backend preference persistence](https://github.com/BradleyGleavePortfolio/growth-project-backend/blob/652b07a856fd807462da244c80f529eef39123c9/src/notifications/notifications.service.ts))

### DataExportScreen

`DataExportScreen.tsx` — GDPR Article 20 data portability. The user requests a JSON archive of their data; the backend builds it in the background and keeps it for 7 days in private storage. **Download file** asks `POST /v1/me/data-export/download-link` for a fresh link (5 minutes, bound to the signed-in user) and opens it with `Linking.openURL`; the browser saves `tgp-data-export-YYYY-MM-DD.json`. Nothing is stored inside the app.

Look (DES-BB-127): hairline status sections instead of boxes, one forest primary button, Cormorant <= 500; states and copy unchanged. `BlockedUsersScreen.tsx` uses the same hairline rows; its error states say "tap Retry" (there is no pull-to-refresh).

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
