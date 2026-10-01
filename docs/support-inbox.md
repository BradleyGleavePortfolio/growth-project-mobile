# Support Inbox — Crisp Chat Integration

## Overview

The Growth Project uses [Crisp](https://crisp.chat) as its in-app support channel. Crisp is a separate service from Coach AI and the Client Bot — it connects users directly to a human operator rather than an AI model.

| Channel | Purpose | Backend |
|---|---|---|
| Coach AI | Nutrition and workout guidance | LLM via backend |
| Client Bot | Automated programme nudges | Backend rule engine |
| **Support Inbox** | **Direct human support** | **Crisp operator dashboard** |

---

## User Flow

1. User navigates to **Settings -> Support**.
2. `SupportInboxScreen` mounts and calls `openSupportChat()` (`crisp.service.ts`), which opens the Crisp chat overlay natively with `show()` once the session is known to be safe for the viewer.
3. The user types their message. The conversation appears in the Crisp operator dashboard at [app.crisp.chat](https://app.crisp.chat).
4. The operator replies from the dashboard; the reply is pushed to the user's device via the Crisp native SDK.

---

## Identity Sync

`crisp.service.ts` binds the authenticated user's identity into every Crisp session:

```ts
setUserEmail(user.email);
setUserNickname(user.displayName);
setSessionString('planTier', planTier);
setSessionString('role', role);
setSessionString('tenantId', tenantId);
```

`syncCrispIdentity(user)` is called from `RootNavigator`'s `bootstrapAuth()` on every successful authentication. This means the operator always sees the correct account alongside the chat transcript.

---


### Shared devices: the chat session is reset (#306 fix round 3)

The native Crisp SDK keeps its chat session, and its history, across launches and accounts until `resetSession()` is called. So:

- `signOut()` (`services/authActions.ts`) calls `resetCrispIdentity()`, which resets the session.
- `syncCrispIdentity(user)` resets the session before binding when it belongs to anyone else: another user, an anonymous pre-sign-in session, or an unknown owner. Ownership is the authenticated **server user id** (`uid:<id>` in prefs, `support.crisp_session_owner`), compared exactly, so two people can never be confused (a round-3 email fingerprint could collide; Sol A2-R3). A user without a server id is always reset first.
- **Same user across launches (#306 r5, Sol C-306-4).** The owner is read synchronously at bind time. With a synchronous MMKV backend the stored owner is read and the same user keeps their session across launches. Current builds do not ship `react-native-mmkv`, so `prefsStorage` is the AsyncStorage shim whose synchronous `getString` always returns `undefined`: on every cold start the owner is unknown and the session is reset once before binding. That is the safe direction (never another person's conversation), at the cost of chat continuity across cold starts. Within one app process the owner is held in memory, so later binds for the same user do not reset again.
- **Fail closed (Sol A1-R3).** If `resetSession()` throws, the new user is not bound to the old session, ownership stays unknown, and the binding is retried before the chat opens.
- Every open goes through `openSupportChat({ preSignIn })` (on mount and from the "Open Support Chat" button). It calls `show()` only when the session is known to be safe for the viewer: signed out, only after a reset that succeeded in this process (a persisted "signed out" claim is never trusted); signed in, only after a binding in this process, otherwise after a reset to a fresh session. When a reset fails the chat stays closed and the screen says so and offers "Try again".
- The auth stack registers `SupportInbox` as `PreSignInSupportInbox` (`preSignIn`), so a previous user's conversation is never shown before sign-in. A signed-out visitor who reopens the screen in the same app session keeps their own anonymous session.

Tests: `src/services/support/__tests__/crisp.service.test.ts`, `src/screens/support/__tests__/SupportInboxPreSignIn.test.tsx`, `src/services/__tests__/authActions.test.ts`.

## Environment Variable

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_CRISP_WEBSITE_ID` | yes | Crisp website ID, found in the Crisp dashboard under **Settings -> Website Settings -> Setup instructions**. Ships in the bundle (public). |

Add to `.env`:

```
EXPO_PUBLIC_CRISP_WEBSITE_ID=your-crisp-website-id
```

Add to `eas.json` for production builds:

```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_CRISP_WEBSITE_ID": "your-crisp-website-id"
      }
    }
  }
}
```

---

## Operator Setup (Crisp Dashboard)

1. Create or log in to a Crisp account at [app.crisp.chat](https://app.crisp.chat).
2. Create a website (or select the existing one for The Growth Project).
3. Copy the **Website ID** from **Settings -> Website Settings -> Setup instructions** and set `EXPO_PUBLIC_CRISP_WEBSITE_ID` in EAS build config.
4. Configure routing rules under **Settings -> Routing** to assign incoming conversations to the appropriate team or operator.
5. Set business hours under **Settings -> Availability** to configure the away message shown to users outside office hours.
6. (Optional) Enable the **Crisp MagicBrowse** or **Crisp Campaigns** add-ons for additional context — these are operator-only concerns and require no mobile code changes.

---

## Build Requirements

`crisp-sdk-react-native` bundles native modules for iOS and Android. It cannot run in Expo Go.

- Expo SDK 53 or newer (this project uses SDK 55).
- Development build (`npx expo run:ios` / `npx expo run:android`) or a production EAS build.
- `app.json` must declare `expo-build-properties` with minimum OS targets:
  - iOS deployment target: 15.1
  - Android minSdkVersion: 21

See `app.json` and the mobile `README.md` for build instructions.

---

## Routing Rules

Routing rules live entirely in the Crisp dashboard — no mobile code changes are required. Recommended configuration:

- Route conversations with `role = coach` to the **Coach Support** inbox.
- Route conversations with `role = student` to the **Member Support** inbox.
- Use `planTier` to prioritise paying members.

---

## Files Added / Changed

| File | Change |
|---|---|
| `src/services/support/crisp.service.ts` | Crisp SDK init + identity sync |
| `src/services/support/__tests__/crisp.service.test.ts` | Unit tests |
| `src/screens/support/SupportInboxScreen.tsx` | Support inbox screen |
| `src/navigation/ClientNavigator.tsx` | Added `SupportInbox` to `MoreStackParamList` and `MoreStackNavigator` |
| `src/navigation/CoachNavigator.tsx` | Added `SupportInbox` to `SettingsStackParamList` and `SettingsStackNavigator` |
| `src/screens/client/SettingsScreen.tsx` | Added Support row linking to `SupportInbox` |
| `src/screens/coach/SettingsScreen.tsx` | Added Support row linking to `SupportInbox` |
| `README.md` | Added `EXPO_PUBLIC_CRISP_WEBSITE_ID` to env table and Support Inbox section |
| `docs/support-inbox.md` | This file |
