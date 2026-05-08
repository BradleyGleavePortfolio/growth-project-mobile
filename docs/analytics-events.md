# Analytics Events Catalog

Phase 11 / PostHog event taxonomy for The Growth Project mobile app.

## Implementation

- SDK: `posthog-react-native`
- Provider: `<PostHogProvider>` in `App.tsx` with `autocapture` enabled
- Typed constants: `src/analytics/events.ts` (`AnalyticsEvents`)
- Service wrapper: `src/analytics/posthog.service.ts` (`track`, `identify`, `useFeatureFlag`)
- Low-level client: `src/lib/analytics.ts` (PII stripper, lazy init)

## Environment variable

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_POSTHOG_API_KEY` | PostHog project API key (public — ships in bundle). |
| `EXPO_PUBLIC_POSTHOG_HOST` | PostHog host (default: `https://app.posthog.com`). |

The SDK is a no-op when `EXPO_PUBLIC_POSTHOG_API_KEY` is absent (CI, dev without secrets).

## PII policy

The following keys are **automatically stripped** from all event properties before sending:
`email`, `password`, `name`, `full_name`, `first_name`, `last_name`, `phone`, `address`, `street`, `city`, `zip`, `postcode`.

---

## Event catalog

### App lifecycle

| Event | Constant | Properties |
|---|---|---|
| `app_opened` | `APP_OPENED` | `cold_start: boolean` |
| `app_backgrounded` | `APP_BACKGROUNDED` | — |

### Onboarding

| Event | Constant | Properties |
|---|---|---|
| `onboarding_started` | `ONBOARDING_STARTED` | — |
| `onboarding_step_completed` | `ONBOARDING_STEP_COMPLETED` | `step: number` |
| `onboarding_completed` | `ONBOARDING_COMPLETED` | — |
| `onboarding_skipped` | `ONBOARDING_SKIPPED` | — |

### Auth

| Event | Constant | Properties |
|---|---|---|
| `login_completed` | `LOGIN_COMPLETED` | `method: email\|google\|apple` |
| `login_failed` | `LOGIN_FAILED` | `method: string` |
| `logout_completed` | `LOGOUT_COMPLETED` | — |
| `signup_completed` | `SIGNUP_COMPLETED` | — |
| `password_changed` | `PASSWORD_CHANGED` | — |

### Coach

| Event | Constant | Properties |
|---|---|---|
| `coach_session_viewed` | `COACH_SESSION_VIEWED` | `session_id: string` |
| `coach_session_booked` | `COACH_SESSION_BOOKED` | `coach_id: string` |
| `coach_message_sent` | `COACH_MESSAGE_SENT` | — |
| `coach_brief_viewed` | `COACH_BRIEF_VIEWED` | — |
| `coach_alert_viewed` | `COACH_ALERT_VIEWED` | `alert_type: string` |
| `coach_client_invited` | `COACH_CLIENT_INVITED` | — |

### Client — workouts

| Event | Constant | Properties |
|---|---|---|
| `workout_started` | `WORKOUT_STARTED` | `routine_id?: string` |
| `workout_completed` | `WORKOUT_COMPLETED` | `session_id, sets_completed, exercise_count, duration_minutes?` |
| `workout_abandoned` | `WORKOUT_ABANDONED` | `sets_completed: number` |
| `exercise_set_logged` | `EXERCISE_SET_LOGGED` | `exercise: string, reps: number, weight: number` |
| `routine_created` | `ROUTINE_CREATED` | — |
| `routine_edited` | `ROUTINE_EDITED` | `routine_id: string` |

### Client — check-ins / logging

| Event | Constant | Properties |
|---|---|---|
| `checkin_submitted` | `CHECKIN_SUBMITTED` | `checkin_type: weight\|meal\|custom` |
| `meal_logged` | `MEAL_LOGGED` | `meal_type: string, source: search\|manual` |
| `weight_logged` | `WEIGHT_LOGGED` | `unit: lbs\|kg` |
| `water_logged` | `WATER_LOGGED` | `amount_oz: number` |
| `fasting_started` | `FASTING_STARTED` | `target_hours: number` |
| `fasting_ended` | `FASTING_ENDED` | `actual_hours: number` |

### Client — milestones / streaks

| Event | Constant | Properties |
|---|---|---|
| `milestone_reached` | `MILESTONE_REACHED` | `milestone_slug, milestone_label, milestone_category` |
| `streak_extended` | `STREAK_EXTENDED` | `days: number` |
| `streak_broken` | `STREAK_BROKEN` | `previous_days: number` |
| `personal_record_set` | `PERSONAL_RECORD_SET` | `exercise: string, value: number, unit: string` |

### Growth — referral / share

| Event | Constant | Properties |
|---|---|---|
| `referral_share_initiated` | `REFERRAL_SHARE_INITIATED` | `source: string` |
| `referral_share_card_shared` | `REFERRAL_SHARE_CARD_SHARED` | `card_type: streak\|pr\|transformation, coach_tenant_id?, destination?` |
| `referral_link_copied` | `REFERRAL_LINK_COPIED` | — |
| `invite_code_used` | `INVITE_CODE_USED` | — |

### Retention

| Event | Constant | Properties |
|---|---|---|
| `preferences_opened` | `PREFERENCES_OPENED` | — |
| `preference_changed` | `PREFERENCE_CHANGED` | `key: string` |
| `notification_preference_changed` | `NOTIFICATION_PREFERENCE_CHANGED` | `category: coach_direct\|client_bot\|milestones\|system, enabled: boolean` |
| `biometric_unlock_enabled` | `BIOMETRIC_UNLOCK_ENABLED` | — |
| `biometric_unlock_disabled` | `BIOMETRIC_UNLOCK_DISABLED` | — |
| `leaderboard_viewed` | `LEADERBOARD_VIEWED` | — |
| `community_viewed` | `COMMUNITY_VIEWED` | — |
| `timeline_viewed` | `TIMELINE_VIEWED` | — |
| `progress_viewed` | `PROGRESS_VIEWED` | — |

---

## Wired call sites (Phase 11)

| Event | File |
|---|---|
| `APP_OPENED` | `App.tsx` — initApp() |
| `LOGIN_COMPLETED` | `src/screens/auth/LoginScreen.tsx` |
| `WORKOUT_COMPLETED` | `src/screens/client/ActiveWorkoutScreen.tsx` |
| `MEAL_LOGGED` | `src/screens/client/LogScreen.tsx` |
| `REFERRAL_SHARE_INITIATED` | `src/screens/client/ProgressScreen.tsx` — streak share button |
| `REFERRAL_SHARE_CARD_SHARED` | `src/screens/share/ShareCardScreen.tsx` — after share sheet |
| `NOTIFICATION_PREFERENCE_CHANGED` | `src/screens/settings/NotificationPreferencesScreen.tsx` |
