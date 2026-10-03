# Notifications — Phase 9

The global system-notification center for The Growth Project mobile app. This is distinct from the Phase 8 coach command-center inbox (`/coach/command-center/inbox`) — that surface covers direct coach–client messages. This center covers every other notification kind the platform can emit: coach notes, milestones, build-week gate approvals, system alerts, reminders, and coaching tips, for both client and coach roles.

---

## Purpose

Give every user a single, reliable place to see what has happened in their programme — with read/unread state, deep-link routing to the relevant screen, and per-kind channel control so they can tune the volume of each category. The bell icon in the app header shows the unread count at a glance.

---

## Screens

### NotificationCenterScreen

| Property | Value |
| --- | --- |
| Route name | `NotificationCenter` |
| Path label (analytics) | `/notifications` |
| Role | Client and Coach |
| Entry points | Header bell icon (both navigators), deep link |

#### State machine

```
idle
  ↓ mount
loadingFirst
  ↓ fetchNotifications(cursor=null) + fetchUnreadCount() resolve
loaded
  ─ pull-to-refresh → refreshing → loaded (new data)
  ─ scroll past 70% → loadingMore → loaded (appended)
  ─ tap row → markNotificationRead (optimistic) → navigate to actionScreen
  ─ tap "Mark all read" → markAllNotificationsRead (optimistic) → unreadCount=0
  ↓ fetchNotifications rejects
error (message shown in empty state)
```

#### Behaviour

- Infinite scroll, cursor-based, 25 items per page.
- Pull-to-refresh resets cursor and replaces the list.
- Empty state copy: "You're all caught up." — no emoji.
- Unread rows have a 3 px forest-green left border.
- Tapping an unread row marks it read (optimistic, then API), then routes to `actionScreen`.
- Tapping a read row routes without any API call.
- "Mark all read" fires `markAllNotificationsRead` and zeroes the badge immediately.

---

### NotificationPreferencesScreen

| Property | Value |
| --- | --- |
| Route name | `NotificationPreferences` |
| Role | Client and Coach |
| Entry point | `NotificationCenterScreen` settings icon, or `MoreStack → Settings` |

#### State machine

```
loading (fetchNotificationPreferences)
  ↓ resolves
idle
  ─ any toggle / time change → saving (saveNotificationPreferences) → idle
  ─ save failure → revert to previous prefs
```

#### Controls

| Control | What it does |
| --- | --- |
| Mute all | Suppresses all push and in-app notifications. Email continues unless also toggled off. |
| Quiet hours | Read-only (B-NOTIF-6): 9:00 PM to 8:00 AM in the user's own zone, the window the backend applies to everyone (OR-113-5). Overnight notifications wait until 8:00 AM; a reminder for a session starting within the hour still comes through. Nothing is sent for it. |
| Per-kind × per-channel | The kinds with a backend switch (`KIND_PREFS_PREFIX`: messages, milestones, check-in reminders, build week) × 3 channels. Each has a 1-sentence description. A failed save puts the switch back and says the change did not save. |

---

## API endpoints

| Endpoint | Status | Description |
| --- | --- | --- |
| `GET /notifications?cursor=&limit=` | MOCKED | Paginated notification list, newest first |
| `PATCH /notifications/:id/read` | MOCKED | Mark a single notification read |
| `PATCH /notifications/read-all` | MOCKED | Mark all notifications read |
| `GET /notifications/preferences` | LIVE | Flat columns (`muted`, `<prefix>_push/_inapp/_email`), mapped by `preferencesFromBackend` |
| `PATCH /notifications/preferences` | LIVE | Only the changed columns (`preferencesToBackend`); never quiet hours |
| `PUT /notifications/timezone` | LIVE | Device zone (`source: 'device'`) on sign-in and foreground (`timezoneSync.ts`); falls back to the preferences PATCH on a backend without the route |
| `GET /notifications/unread-count` | MOCKED | Lightweight badge count polling |

All calls go through `src/services/notificationsApi.ts`. The mock flag is `NOTIFICATIONS_MOCK_ENABLED` in `src/config/featureFlags.ts`. Flip to `false` and add the real axios calls once the backend Phase 9 PR merges.

---

## Deep-link routing table

| `notification.actionScreen` | Navigator screen | Notes |
| --- | --- | --- |
| `Timeline` | `MoreStack → Timeline` | Milestone notifications |
| `Messages` | `HomeStack → Messages` (client) or `CoachNavigator → Messages` (coach) | Direct messages |
| `NotificationCenter` | `HomeStack → NotificationCenter` | Informational — stays on this screen |
| `MoreIndex` | `MoreStack → MoreIndex` | Build-week gate approvals |
| `undefined` | No navigation | Informational only |

---

## Components

| Component | Location | Purpose |
| --- | --- | --- |
| `NotificationBadge` | `src/components/NotificationBadge.tsx` | Bell icon badge; count capped at "99+"; theme accent background |
| `NotificationRow` | `src/components/NotificationRow.tsx` | Single row in the list; read/unread state, icon, title, body, time |
| `ForegroundNotificationBanner` | `src/components/ForegroundNotificationBanner.tsx` | In-app banner for foreground pushes; auto-dismisses after 4 s; swipe-up to dismiss |

---

## Push notification handler

`src/services/pushNotifications.ts` (extended in Phase 9):

- `installForegroundHandler()` — call once from `App.tsx` after the navigation tree mounts. Suppresses the native system alert and writes the payload to `foregroundBannerStore` instead. `ForegroundNotificationBanner` renders from that store.
- `installNotificationResponseHandler()` — handles taps on background/killed-state notifications; routes via `onResponse` callback.

The Zustand store is `src/store/foregroundBannerStore.ts`.

---

## Env vars / feature flags

| Name | File | Default | Purpose |
| --- | --- | --- | --- |
| `NOTIFICATIONS_MOCK_ENABLED` | `src/config/featureFlags.ts` | `true` | `true` = in-memory mock; `false` = live backend |

No additional env vars are required while mocked. When live, the standard `EXPO_PUBLIC_API_URL` used by `src/services/api.ts` is sufficient.

---

## Tests

| File | Asserts |
| --- | --- |
| `src/__tests__/notificationCenter.test.tsx` | Renders list after load |
| | Shows unread banner when count > 0 |
| | Calls `markNotificationRead` on unread row tap |
| | Badge count decreases after mark-read interaction |
| | Calls `markAllNotificationsRead` on "Mark all read" tap |
| | Shows empty state "You're all caught up." when list is empty |
| | Preferences screen renders all 8 kind sections |
| | Preferences screen calls `saveNotificationPreferences` on mute-all toggle |
| | Badge renders "99+" for count > 99 |
| | Badge renders nothing for count = 0 |

---

## Future work

- Replace mock with live backend calls once the backend Phase 9 PR merges. Flip `NOTIFICATIONS_MOCK_ENABLED = false` in `featureFlags.ts` and implement the axios calls in `notificationsApi.ts`.
- Add swipe-to-delete on individual rows (backend needs a `DELETE /notifications/:id` endpoint).
- Notification grouping by kind (collapsible sections) once the list grows beyond 50 items.
- Rich push payloads (image, action buttons) — requires Expo Notifications v3 + backend change.
- Per-schedule quiet hours (different windows per day of week).

## Push tap routing (clinic launch)

- `installNotificationResponseHandler(routePushTap)` is installed once in `App.tsx` (skipped in screenshot mode). It handles live taps and the cold-start tap from `getLastNotificationResponseAsync`, de-duplicated by notification id.
- `src/services/pushTapRouter.ts` delivers a tap only when RootNavigator reports an explicit app session (`setPushSession(pushSessionFor(authState, userId))`): `student`/`package_prompt` mount the client navigator, `coach` the coach navigator. Bootstrap and every onboarding root (lean questions, Day-1, Day-1 win, coach wizard) hold the tap. Sign-out drops it, a tap that arrives while signed out is dropped, and a session for a different user id drops it.
- Destinations are a role-aware allow-list of real nested routes. Client: `Messages`, `NotificationCenter`, `Habits` -> `Home`; `Timeline`, `MoreIndex`, `Membership`, `Deliverables` -> `MoreTab`; `WorkoutMain` -> `WorkoutTab`; `CommunityEventDetail` -> `CommunityTab` (community + events flags). Coach: `Messages` (root tab); `NotificationCenter`, `NotificationPreferences` -> `ClientsStack`; `CreditPackCheckout` -> `SettingsStack` (gated wrapper, neutral copy on hidden iOS); `CommunityEventDetail` -> `CommunityStack/CoachCommunityEvents` (coach community + events flags). Unknown or unavailable names land on the role's notification center.
- Push params are decoded to at most 8 string values (200 chars each); the delivered-id dedupe set keeps the last 200 ids.
- The OS permission prompt is no longer shown at sign-in. `registerForPushNotifications({ requestPermission: false })` only registers the token when permission is already granted. The prompt comes from `components/home/PushPermissionCard.tsx` on Home, and only when the user taps "Turn on".
