# TGP Session Scheduling — Mobile Handoff

This scaffolds the mobile UX surfaces for client / coach call scheduling.
All feature flags ship OFF. The mobile shells render `feature_disabled`
placeholders until the backend deploys the endpoints listed below and the
EXPO_PUBLIC_* flags are flipped per-environment.

## Doctrine reminders

- This is **private coaching access**, not a generic booking app.
- Banned vocabulary in any sessions copy: "book now", "available slots",
  "marketplace", "instant booking", "appointment". Tests in
  `src/__tests__/sessionsCopy.test.ts` enforce this.
- The mobile side **never fabricates** join URLs, brief highlights, prep
  prompts, or availability windows. Every visible piece of state must come
  from the backend or be replaced with a calm "your coach will share this"
  placeholder.

## What ships in this PR (mobile)

- Typed contracts: `src/types/sessions.ts`
- Feature flags: `src/config/sessionsFlags.ts`
- Adapter (stub + HTTP placeholder): `src/services/sessions/sessionsClient.ts`
- Copy: `src/constants/sessionsCopy.ts`
- Status display logic: `src/lib/sessionsStatusDisplay.ts`
- Client screens:
  - `src/screens/client/SessionsUpcomingScreen.tsx`
  - `src/screens/client/SessionRequestScreen.tsx`
  - `src/screens/client/SessionPrepareScreen.tsx`
- Coach screens:
  - `src/screens/coach/CoachAvailabilityScreen.tsx`
  - `src/screens/coach/CoachSessionRequestsScreen.tsx`
  - `src/screens/coach/CoachUpcomingCallsScreen.tsx`
  - `src/screens/coach/CoachSessionBriefScreen.tsx`
- Tests:
  - `src/__tests__/sessionsCopy.test.ts`
  - `src/__tests__/sessionsStatusDisplay.test.ts`
  - `src/__tests__/sessionsFlags.test.ts`
  - `src/__tests__/sessionsAdapter.test.ts`

Navigation wiring is intentionally deferred to avoid conflicts with PRs
#100 and #103, which both touch `src/navigation/*Navigator.tsx`. A follow-up
will register these screens once those merge.

## Backend dependencies (real, not stubbed)

The HTTP adapter currently delegates to the stub. To switch it on, the
backend team must deliver the following:

### 1. Availability endpoints

- `GET  /api/sessions/availability?coach_id=…` → `CoachAvailability[]`
- `POST /api/sessions/availability` (coach only) — create/replace windows
- `DELETE /api/sessions/availability/:id` (coach only)

### 2. Coaching session endpoints

- `GET  /api/sessions/upcoming?actor=client|coach&user_id=…`
  → `CoachingSession[]` (or `UpcomingSessionView[]` aggregate)
- `POST /api/sessions/request` (client) — body matches
  `requestSession` adapter input; returns `CoachingSession`
- `POST /api/sessions/:id/cancel` (either actor — server enforces)
- `POST /api/sessions/:id/approve` (coach)
- `POST /api/sessions/:id/decline` (coach)
- `POST /api/sessions/:id/complete` (coach)
- `POST /api/sessions/:id/no-show` body `{ party: 'client' | 'coach' }`

### 3. Provider OAuth + adapters

- Google Meet: OAuth scope `https://www.googleapis.com/auth/calendar.events`
  to mint Meet URLs at session-confirm time.
- Zoom: OAuth + `meeting:write` scope, server-side meeting creation.
- The mobile side accepts only `videoJoinUrl` returned by the server. It
  refuses to render placeholder / `example.com` / non-https values — see
  `isLikelyJoinUrl` and the no-fake-providers tests.
- Per-coach OAuth state is exposed via `GET /api/sessions/calendar` →
  `CalendarConnectionStatus`. The mobile shell already handles `expired`
  and `revoked` with reconnection copy.

### 4. Reminder notifications

- T-24h, T-1h, T-10m client push (and email on opt-in) reminders.
- Coach-side: a single T-30m brief-ready notification.
- Mobile uses `expo-notifications`; backend should send standard
  `data: { sessionId, kind: 'reminder' | 'brief_ready' }` payloads so the
  app can deep-link to the right screen. Deep-link routes to add when
  navigation lands: `tgp://sessions/upcoming` and
  `tgp://sessions/:id/prepare`.

### 5. Brief generation

- Server-authored only. The mobile shell never composes its own highlights.
- Backend should set `isReady: false` until enough recent activity has been
  summarized; the screen renders the calm "Brief is preparing" state.
- If AI is involved, route through the AI gateway (see #102) so the
  same trust posture applies (no fake claims, source labeling).

### 6. Audit logs

- Every status transition (`requested → confirmed`, `confirmed →
  cancelled_by_coach`, `confirmed → completed`, `confirmed →
  no_show_*`) needs a server-side audit row with actor and timestamp.
  Mobile does not own this — but cancel / no-show screens expect the
  backend to record provenance.

## Switching flags on (rollout order)

Recommended sequence once the above lands:

1. `EXPO_PUBLIC_SESSIONS_ENABLED` (master, internal builds first)
2. `EXPO_PUBLIC_SESSIONS_COACH_AVAILABILITY_ENABLED` — coaches set windows
3. `EXPO_PUBLIC_SESSIONS_CLIENT_REQUESTS_ENABLED` — clients can request
4. `EXPO_PUBLIC_SESSIONS_VIDEO_PROVIDER_ENABLED` — only AFTER OAuth ships
5. `EXPO_PUBLIC_SESSIONS_PREP_ENABLED`
6. `EXPO_PUBLIC_SESSIONS_BRIEF_ENABLED`

Each step can ship to a fraction of coaches/clients first; the screens
fall back to placeholders for everyone else.

## Known gaps / follow-ups

- No date/time picker yet in `SessionRequestScreen` — the shell defaults
  to "24 hours from now" so the wiring is exercised end-to-end. Real
  picker lands once availability windows are populated and we know the
  display constraints.
- Reschedule-by-client flow surfaces only as copy
  (`SESSION_RESCHEDULE_CANCEL`) — the actual screen is a follow-up.
- Coach "propose another time" action is rendered as a placeholder.
- Recap surface is typed (`SessionRecap`) but not yet a screen — the
  recap flow is owned by the coach Brief work in #100.
- Navigation registration is deferred (see above).
