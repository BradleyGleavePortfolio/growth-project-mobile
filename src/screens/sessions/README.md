# Sessions — Coaching Call Surfaces

This module gives clients and coaches a surface for managing one-to-one coaching calls inside The Growth Project mobile app. It is the mobile side of a scheduling stack that does not yet have a live backend. All feature flags default to OFF; screens show a calm "preview mode" banner when the flags are ON but the HTTP adapter is still backed by mock data.

The design posture is **private coaching access**, not a generic booking app. Banned vocabulary throughout: "book now", "available slots", "marketplace", "instant booking", "appointment". The module tests enforce this.

---

## Screens

| Screen | File | Role | State machine |
|---|---|---|---|
| Sessions — Upcoming | `src/screens/client/SessionsUpcomingScreen.tsx` | Client | idle → loading → ready / empty_no_sessions / empty_no_coach / feature_disabled / error |
| Session Request | `src/screens/client/SessionRequestScreen.tsx` | Client | idle → submitting → submitted / error; renders disabled placeholder when `SESSIONS_CLIENT_REQUESTS_ENABLED` is OFF |
| Session Prepare | `src/screens/client/SessionPrepareScreen.tsx` | Client | disabled / prompt absent → prompt present → acknowledged |
| Coach Availability | `src/screens/coach/CoachAvailabilityScreen.tsx` | Coach | disabled / windows empty → windows loaded; calendar connection state displayed |
| Coach Session Requests | `src/screens/coach/CoachSessionRequestsScreen.tsx` | Coach | disabled / loading → empty / list of requests with approve+decline actions |
| Coach Upcoming Calls | `src/screens/coach/CoachUpcomingCallsScreen.tsx` | Coach | disabled / loading → empty / list with mark-complete + no-show actions |
| Coach Session Brief | `src/screens/coach/CoachSessionBriefScreen.tsx` | Coach | disabled / loading → not-ready / ready (only renders when `isReady === true`) |

### Navigator entry points

**Client screens** — registered in `src/navigation/ClientNavigator.tsx` inside the `MoreStack`. Entry point is `MoreIndex` (the "More" tab). Navigate with:

```ts
navigation.navigate('SessionsUpcoming', { clientId: user.id });
navigation.navigate('SessionRequest', { clientId: user.id, coachId: coach.id });
navigation.navigate('SessionPrepare', { sessionId: session.id });
```

**Coach screens** — registered in `src/navigation/CoachNavigator.tsx` inside the `ClientsStack`. Entry points are `CoachHomeScreen` or `ClientDetail`. Navigate with:

```ts
navigation.navigate('CoachSessionRequests', { coachId: coach.id });
navigation.navigate('CoachUpcomingCalls', { coachId: coach.id });
navigation.navigate('CoachAvailability', { coachId: coach.id });
navigation.navigate('CoachSessionBrief', { sessionId: session.id });
```

---

## Supporting modules

| File | Purpose |
|---|---|
| `src/types/sessions.ts` | All typed contracts: `CoachingSession`, `SessionBrief`, `SessionPrepPrompt`, discriminated `SessionsLoadState`, type-guards |
| `src/config/sessionsFlags.ts` | Feature flags (all default OFF). Master switch `SESSIONS_ENABLED` gates every sub-flag. |
| `src/services/sessions/sessionsClient.ts` | `SessionsAdapter` interface + `MockSessionsAdapter` (realistic data) + `StubSessionsAdapter` (empty state) + `HttpSessionsAdapter` (delegates to mock until backend ships) |
| `src/constants/sessionsCopy.ts` | All user-facing copy. Per-actor status labels. Banned-vocabulary enforcement. |
| `src/lib/sessionsStatusDisplay.ts` | Pure functions: `statusTone`, `canCancel`, `canMarkComplete`, `joinDisplay` (single source of truth for URL vs placeholder), `joinWindowOpen` |
| `src/components/sessions/MockDataBanner.tsx` | Preview mode banner — shown on all screens when `SESSIONS_ENABLED` is ON but the HTTP adapter is still backed by mock data |

---

## API endpoints required

All endpoints are `MOCKED` — the `HttpSessionsAdapter` returns mock data until these routes ship on the backend.

| Method | Path | Auth | Request | Response | Status |
|---|---|---|---|---|---|
| `GET` | `/api/sessions/upcoming` | JWT (client or coach) | `?actor=client\|coach&user_id=…` | `UpcomingSessionView[]` or `CoachingSession[]` | **MOCKED** |
| `POST` | `/api/sessions/request` | JWT (client) | `{ coachId, type, preferredStart, preferredEnd, note? }` | `CoachingSession` | **MOCKED** |
| `POST` | `/api/sessions/:id/cancel` | JWT (client or coach) | — | `CoachingSession` | **MOCKED** |
| `GET` | `/api/sessions/:id/prep-prompt` | JWT (client) | — | `SessionPrepPrompt \| null` | **MOCKED** |
| `POST` | `/api/sessions/:id/prep-prompt/acknowledge` | JWT (client) | — | `void` | **MOCKED** |
| `GET` | `/api/sessions/:id/recap` | JWT (client or coach) | — | `SessionRecap \| null` | **MOCKED** |
| `GET` | `/api/sessions/requests` | JWT (coach) | `?coach_id=…` | `SessionRequestSummary[]` | **MOCKED** |
| `POST` | `/api/sessions/:id/approve` | JWT (coach) | — | `CoachingSession` | **MOCKED** |
| `POST` | `/api/sessions/:id/decline` | JWT (coach) | `{ reason? }` | `CoachingSession` | **MOCKED** |
| `POST` | `/api/sessions/:id/complete` | JWT (coach) | — | `CoachingSession` | **MOCKED** |
| `POST` | `/api/sessions/:id/no-show` | JWT (coach) | `{ party: 'client'\|'coach' }` | `CoachingSession` | **MOCKED** |
| `GET` | `/api/sessions/:id/brief` | JWT (coach) | — | `SessionBrief \| null` | **MOCKED** |
| `GET` | `/api/sessions/availability` | JWT (client or coach) | `?coach_id=…` | `CoachAvailability[]` | **MOCKED** |
| `POST` | `/api/sessions/availability` | JWT (coach) | `CoachAvailability` body | `CoachAvailability` | **MOCKED** |
| `DELETE` | `/api/sessions/availability/:id` | JWT (coach) | — | `void` | **MOCKED** |
| `GET` | `/api/sessions/calendar-connection` | JWT (coach) | `?coach_id=…` | `CalendarConnectionStatus` | **MOCKED** |

---

## Environment variables and flags

| Variable | Default | Meaning |
|---|---|---|
| `EXPO_PUBLIC_SESSIONS_ENABLED` | `false` | Master switch — all screens show disabled placeholder when OFF |
| `EXPO_PUBLIC_SESSIONS_CLIENT_REQUESTS_ENABLED` | `false` | Enables the request form in `SessionRequestScreen` |
| `EXPO_PUBLIC_SESSIONS_COACH_AVAILABILITY_ENABLED` | `false` | Enables the availability editor in `CoachAvailabilityScreen` |
| `EXPO_PUBLIC_SESSIONS_VIDEO_PROVIDER_ENABLED` | `false` | Shows real join URLs when present; OFF means "link coming from your coach" copy |
| `EXPO_PUBLIC_SESSIONS_PREP_ENABLED` | `false` | Enables `SessionPrepareScreen` prompt loading |
| `EXPO_PUBLIC_SESSIONS_BRIEF_ENABLED` | `false` | Enables `CoachSessionBriefScreen` brief loading |

All flags accept `"true"` or `"1"`. Sub-flags are gated by the master switch regardless of their own value — see `isSessionsFeatureEnabled()` in `src/config/sessionsFlags.ts`.

---

## Tests

| File | What it asserts |
|---|---|
| `src/__tests__/sessionsScreens.test.tsx` | Render test per screen (7): disabled-placeholder path with flag OFF; ready/empty path with mock adapter; error state for `SessionsUpcomingScreen` |
| `src/__tests__/sessionsNavigation.test.tsx` | All 7 screens are imported and registered in `ClientNavigator` and `CoachNavigator`; all screen files exist; `MockDataBanner` and `README.md` exist |
| `src/__tests__/sessionsCopy.test.ts` | Every status has per-actor labels; banned vocabulary absent; concierge framing in request flow |
| `src/__tests__/sessionsStatusDisplay.test.ts` | Status tones; cancel/complete action gating; join URL truthfulness; join window timing |
| `src/__tests__/sessionsFlags.test.ts` | All flags default OFF; master switch gates sub-flags |
| `src/__tests__/sessionsAdapter.test.ts` | Stub returns empty state; destructive ops refuse without backend |

---

## Future work

### Backend endpoints to build (in priority order)

1. **Session CRUD** — `POST /api/sessions/request`, `GET /api/sessions/upcoming`, `POST /api/sessions/:id/approve`, `POST /api/sessions/:id/decline`, `POST /api/sessions/:id/cancel`. These unblock the client request flow and the coach request queue.

2. **Calendar connection and availability** — `GET/POST/DELETE /api/sessions/availability` and `GET /api/sessions/calendar-connection`. Needed before `CoachAvailabilityScreen` shows real windows.

3. **Provider OAuth** — Google Meet and Zoom OAuth flows so confirmed sessions can include a real join URL. Until these exist, `SESSIONS_VIDEO_PROVIDER_ENABLED` must stay OFF and the "link coming from your coach" copy is correct.

4. **Pre-session prep prompts** — `GET /api/sessions/:id/prep-prompt` and `POST /api/sessions/:id/prep-prompt/acknowledge`. Needed before `SessionPrepareScreen` shows real prompts.

5. **Coach brief generation** — `GET /api/sessions/:id/brief`. The brief is generated server-side from recent client signals (check-in streaks, weight logs, prep notes). No client-side AI fabrication.

6. **Reminder notifications** — push payloads at T-24h, T-1h, T-10m. Deep-link routes to `SessionsUpcoming` and `SessionPrepare`.

7. **Recap lifecycle** — `GET /api/sessions/:id/recap`. Coach writes, then shares with client once `state === 'shared_with_client'`.

### Known limits

- `SessionRequestScreen` defaults to a 24-hour-ahead preferred start time. A real date/time picker is needed once availability endpoints exist and clients can see real windows.
- Reschedule-by-client ("request a different time") is copy-only. The action flow requires a `POST /api/sessions/:id/reschedule` endpoint and a coach-side confirmation step.
- `CoachAvailabilityScreen` shows a read-only list. The create/edit/delete window editor is a follow-up once the availability endpoints ship.
