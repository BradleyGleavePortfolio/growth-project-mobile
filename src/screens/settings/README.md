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

### RomanConversationsScreen and RomanConversationScreen

`RomanConversationsScreen.tsx` ("Your conversations with Roman") and `RomanConversationScreen.tsx` (one past conversation, read only).

**Why:** owner decision 2026-10-01 20:32 and ruling OR-110-1. Roman chats are kept until the client deletes them or their account, and the box-2 consent copy (`client-ai-v4`) says exactly that, so every chat must be findable and deletable. Roman chats are never visible to coaches.

**Flow**

1. The list (`useRomanChats.ts`) loads `GET /roman/sessions` (30 per page, newest first, keyset `cursor`), shows each chat's local date and message count (coach-tool chats are labelled), and pages with "Show older conversations".
2. Open: `RomanConversationScreen` reads `GET /roman/sessions/:id/messages` (oldest first on screen, "Show earlier messages" pages back). Read only.
3. Delete one: confirm sheet ("permanently deletes ... cannot be undone"), the row leaves at once, comes back in place if the server does not confirm. A 404 `ROMAN_SESSION_NOT_FOUND` on delete is the requested outcome (already gone). A repeat delete is a quiet 204 on the server.
4. Delete all: confirm sheet plus typing `DELETE` (case-insensitive). The list empties at once; on failure the previous list comes back, and after a partial or unknown failure the list is re-read to show what is left.
5. The transcript screen tells the list a chat is gone through `romanChatsEvents.ts` (in memory, carries the owner id).

**Account binding:** every request remembers the account that made it. Sign-out (`authEvents` `logout`) clears the list and transcript at once; sign-in re-reads for whoever is signed in; answers for the previous account are dropped; a delete is not sent unless the account that loaded the list is still signed in. Nothing is stored on the device; the server sends `no-store`. Both screens carry `ph-no-capture`.

**Errors** (`romanChatsCopy.ts` `failureView`, from status and machine `code`): offline, 401 signed out, 403 not allowed (reference + support), 404 `ROMAN_SESSION_NOT_FOUND`, uncoded 404 (backend without #635, or Roman chat reading switched off for the transcript, where Delete is still offered), 400 `ROMAN_CURSOR_INVALID` (list re-read from the top), 400 `ROMAN_SESSIONS_QUERY_INVALID` (#635 fix round: an outdated app; update copy, reference, reported), 503 `ROMAN_ERASE_INCOMPLETE` (one / all copy; the one-chat copy never says "not changed", because #635's fix round also uses this code when an erase cannot be confirmed), 429, and anything else as a short reference + Contact support (mailto with the reference only) + a Sentry report with status, code and request id only. Delete copy never claims a result the server did not confirm.

**Entry points:** Settings > Privacy > Roman and AI (`RomanAiConsentScreen`, row "Your conversations with Roman"), the Roman chat header (`RomanConversationsButton`), and coach Settings > Privacy. The routes `RomanConversations` / `RomanConversation` are registered in the client More stack and the coach Settings stack without the Roman chat flag, because the backend list and delete routes are outside the chat switch.

**API surface** (`src/api/romanChatsApi.ts`, backend #635 `docs/roman-chat-deletion.md`)

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/roman/sessions?limit=&cursor=` | metadata only, newest first |
| `DELETE` | `/roman/sessions/:id` | 204, idempotent |
| `DELETE` | `/roman/sessions` | 204, every chat, both surfaces |
| `GET` | `/roman/sessions/:id/messages?limit=&cursor=` | behind the Roman chat switch |

**Tests:** `src/api/__tests__/romanChatsApi.test.ts`, `src/screens/settings/__tests__/RomanConversationsScreen.test.tsx`, `src/screens/settings/__tests__/RomanConversationScreen.test.tsx`, `src/components/roman/__tests__/RomanConversationsButton.test.tsx`, `src/navigation/__tests__/romanConversationsReachable.test.ts`.
