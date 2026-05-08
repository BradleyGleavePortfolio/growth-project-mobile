# Push Notification Taxonomy

Phase 11 / four-tier push notification channel and category system.

## Implementation

- Mobile: `src/notifications/push-channels.ts` — `registerPushChannels()`
- Called from: `App.tsx` — `initApp()`, before `requestNotificationPermissions()`
- Backend: `src/notifications/notification-category.enum.ts` — `NotificationCategory` enum

## Four-tier taxonomy

| Tier | Channel ID | iOS Category | Android Importance | Use case |
|---|---|---|---|---|
| 1 | `coach-messages` | `coach_direct` | HIGH | Direct coach DMs and session reminders |
| 2 | `client-bot` | `client_bot` | LOW | Automated meal, water, check-in reminders |
| 3 | `milestones` | `milestone` | DEFAULT | Streak extensions, personal records |
| 4 | `system` | `system` | DEFAULT | Billing, app updates, critical alerts |

## Android channel details

| Channel | Importance | Vibration | Lights | Badge | Lock screen |
|---|---|---|---|---|---|
| `coach-messages` | HIGH | [0, 250, 250, 250] | Yes | Yes | PRIVATE |
| `client-bot` | LOW | [0, 100] | No | No | PUBLIC |
| `milestones` | DEFAULT | [0, 200, 100, 200] | Yes | Yes | PUBLIC |
| `system` | DEFAULT | [0, 250] | No | Yes | PRIVATE |

## iOS category actions

| Category | Action IDs |
|---|---|
| `coach_direct` | `REPLY` (opens app), `OPEN_MESSAGES` (opens app) |
| `client_bot` | `LOG_NOW` (opens app), `DISMISS` |
| `milestone` | `SHARE` (opens app), `VIEW` (opens app) |
| `system` | `VIEW` (opens app) |

## Backend enum

```typescript
enum NotificationCategory {
  COACH_DIRECT = 'COACH_DIRECT',
  CLIENT_BOT   = 'CLIENT_BOT',
  MILESTONE    = 'MILESTONE',
  SYSTEM       = 'SYSTEM',
}
```

Every outgoing Expo push payload must include a `category` field.
Default: `SYSTEM` when no category is specified.

## When to use each tier

### Tier 1: coach-messages / COACH_DIRECT
- Coach sends a DM to a client
- Session reminder (coach-initiated)
- Client risk alert surfaced to coach

### Tier 2: client-bot / CLIENT_BOT
- Scheduled meal reminders
- Water hydration reminders
- Daily check-in prompts
- Fasting completion alerts

### Tier 3: milestones / MILESTONE
- Streak extension (3-day, 7-day, 14-day, 30-day)
- Personal record set
- Workout count milestones (10, 30, 50)

### Tier 4: system / SYSTEM
- Billing events (subscription renewal, payment failure)
- App update available
- Invite code accepted
- Security / account alerts
