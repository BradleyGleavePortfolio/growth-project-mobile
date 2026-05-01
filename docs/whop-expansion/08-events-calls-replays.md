# 08 — Events, live calls, and replays

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app (RSVP + join + replay) + coach app
(authoring + recording library)
**Owner:** Mobile client team (member side) + mobile coach team
(authoring side)

## WHY

Live calls are the single highest-value retention tool a coach has —
a weekly group call drops churn far more than any async content. Today
TGP has no in-app event surface; coaches schedule calls in Zoom and
share links in DMs. Without an in-app event:

- Calendar fragmentation kills attendance.
- Replays are lost in chat threads.
- Coaches can't sell event-only offers ("Q&A pass", "live cohort
  start").

The events feature wraps three things into one primitive:

1. A scheduled item with RSVP.
2. A "join now" CTA at start time, deep-linking into the
   conferencing tool of choice.
3. A replay attached to the event after it ends.

## WHEN to build

After:
- Backend #122 (spaces / events service) exposes event schema,
  RSVP, recordings.
- `docs/expansion-wave-2/01` challenges shipped (the RSVP +
  reminder primitives are the same shape).
- Conferencing rail decision is made (likely a hosted
  Zoom/Whereby/Daily integration; the choice is owned by
  backend, not mobile).

## WHERE in the repo

- New screens (member side):
  - `src/screens/client/events/EventsListScreen.tsx` — upcoming
    + past events the user has access to.
  - `src/screens/client/events/EventDetailScreen.tsx` —
    description, RSVP, "Join" CTA, replay.
  - `src/screens/client/events/ReplayPlayerScreen.tsx` — plays
    back the recording (uses the existing video primitive if
    present, or `expo-av` per platform-readiness 01).
- New screens (coach side):
  - `src/screens/coach/events/EventEditorScreen.tsx` — create /
    edit event.
  - `src/screens/coach/events/EventsListScreen.tsx` — coach view
    of own events.
  - `src/screens/coach/events/RecordingsLibraryScreen.tsx` — all
    replays across events.
- Entry: client side — Home tile "Upcoming" if ≥1 event in next
  7 days; More-stack row "Events". Coach side — Settings →
  "Events" or sibling stack to Templates.
- API: `eventsApi.list`, `getEvent`, `rsvp`, `joinUrl`,
  `getReplay`, `coachApi.createEvent`, `updateEvent`,
  `cancelEvent`, `listMyEvents`, `listRecordings`.
- Type: `src/types/events.ts`.

## WHO owns and uses it

- **Builder:** Mobile client + coach teams.
- **Author:** Coach.
- **Audience:** Members with the right entitlement (event-attached
  to an offer, a space, a program, or sold standalone).

## WHAT MVP includes

### Member side

- **EventsListScreen** — sectioned by Upcoming / Past. Each card:
  title, coach, start time (in user TZ), duration, RSVP state,
  "Join" or "Watch replay" CTA depending on time.
- **EventDetailScreen** — hero, description, schedule, RSVP
  button (Going / Not going / Maybe — finalise vocabulary in
  doctrine; "Maybe" may be cut), "Add to calendar" (system
  calendar via native share/export, no permission required),
  Join CTA active in the live window, replay below after
  end + processing window.
- **ReplayPlayerScreen** — replay video player with chapter
  markers if the backend exposes them.

### Coach side

- **EventEditorScreen** — title, description, start (date+time),
  duration, attendance type (open to entitlement / RSVP-required
  / capped seats), capacity (if capped), recording opt-in.
- **EventsListScreen (coach)** — own events, with attendance
  count and RSVP roster on tap.
- **RecordingsLibraryScreen** — list of all this coach's
  recordings, searchable, attachable to a program (per
  `docs/expansion-wave-2/05` regimens).

### Out of scope for v1

- In-app conferencing UI (we deep-link into the rail's app).
- Recurring events (single events only; coach duplicates as a
  workaround until v1.1).
- Per-attendee mute / kick controls (the rail handles).
- Live chat parallel to the event (use the space's feed).
- Custom recording editing (server-side optional trim only).
- Notifications more granular than "starting in 15 min" +
  "started" (defer richer cadences).
- Captions / transcripts (defer to v1.1).
- Paid one-off seats outside a `space` or `event` offer (defer).

## HOW to implement safely

1. **Conferencing is a deep-link.** The Join CTA opens the
   rail's app or its in-app browser fallback. Mobile never
   embeds the rail's WebView — Apple's review history makes
   embedded conferencing fragile.
2. **Calendar export is a file, not a permission.** Use the
   native share sheet to export an `.ics`. Do not request
   calendar permission — out of scope and a permissions
   regression would block release.
3. **Time zones honestly.** Show the event in the user's local
   zone, with a tooltip / subtitle showing the source zone if
   different. Never silently convert without indication.
4. **Live window is server-driven.** The "Join" CTA active
   period comes from a server-computed boolean, not a local
   timer, so the user's clock can't desync the experience.
5. **Replay availability is server-driven.** A "processing"
   state shows between event end and replay availability; the
   honest state is "Replay will be available shortly".
6. **No recording without consent.** The coach must opt-in to
   record at create-time; member-side notice that the event is
   recorded must be visible on RSVP.

## Screens / navigation sketch

```
Member
──────
Home → "Upcoming" tile (if any)  ──► EventDetailScreen
More-stack → "Events"           ──► EventsListScreen
                                       ├─ Upcoming section
                                       └─ Past section (replays)

EventDetailScreen
  ├─ RSVP buttons (Going / Not going)
  ├─ "Add to calendar" (export .ics)
  ├─ Join CTA (active in live window) → opens rail
  └─ Replay (after processing) → ReplayPlayerScreen

Coach
─────
Coach app → Events stack → "+" → EventEditorScreen
                                    ├─ Title / description / time / duration
                                    ├─ Attendance type
                                    ├─ Capacity
                                    └─ Record: on/off

Recordings Library  ──► attach to program / share to space
```

## API contract dependency

- `GET /me/events` → `Event[]`
- `GET /events/:id` → `Event`
- `POST /events/:id/rsvp` body `{ state: 'going' | 'not_going' }`
  → `Event`
- `GET /events/:id/join` → `{ url: string, expiresAt: string }`
  (active only in the live window)
- `GET /events/:id/replay` → `Replay | null`
- `POST /coach/events` body `DraftEvent` → `Event`
- `PUT /coach/events/:id` body `DraftEvent` → `Event`
- `POST /coach/events/:id/cancel` → `Event`
- `GET /coach/events/:id/rsvps` → `{ items: RsvpRow[] }`
- `GET /coach/recordings` → `Replay[]`

```ts
type Event = {
  id: string;
  coachSlug: string;
  title: string;
  description: string;
  startsAt: string;       // ISO
  endsAt: string;
  timezoneSource: string; // IANA, the coach's zone for display tip
  attendanceKind: 'entitlement' | 'rsvp' | 'capped';
  capacity: number | null;
  rsvpCounts: { going: number; notGoing: number };
  myRsvp: 'going' | 'not_going' | null;
  liveWindowOpen: boolean;
  recording: { willRecord: boolean; consentNotice: string };
  replayId: string | null;
  status: 'scheduled' | 'live' | 'ended' | 'processing' |
          'cancelled';
};

type Replay = {
  id: string;
  eventId: string;
  durationSeconds: number;
  posterUrl: string | null;
  videoUrl: string;
  chapters: { atSeconds: number; label: string }[];
};
```

## Stripe / TGP-balance abstraction

Events are accessed via entitlement. A standalone paid event
(an `event` offer kind) flows through checkout
([03](./03-checkout-deposits-subscriptions.md)) and grants the
event entitlement on success. Replays inherit the same
entitlement — buying the event includes the replay; coaches
cannot sell the replay separately in v1.

## Loading / error / empty states

- **EventsListScreen empty (no upcoming or past):** "No
  events yet."
- **EventDetailScreen pre-live:** RSVP CTA + countdown subtitle.
- **EventDetailScreen live:** Join CTA prominent; "Started X min
  ago" subtitle.
- **EventDetailScreen post + processing:** "Replay will be
  available shortly" surface; refresh on backgroundForeground.
- **EventDetailScreen post + replay ready:** Replay player
  thumbnail + Play CTA.
- **Cancelled:** banner "This event was cancelled" replacing the
  Join CTA.
- **Network error:** keep cached state; toast.

## Accessibility

- Time announcements use full date + time + zone, not just
  "tomorrow".
- Replay player respects system caption settings if captions
  exist.
- RSVP buttons are individually labelled with current state.
- Join CTA in the live window announces "Join live, button" to
  distinguish from generic "Join".

## Analytics

- `event_viewed` — `{ eventId, status }`
- `event_rsvp` — `{ eventId, state }`
- `event_join_tapped` — `{ eventId, secondsFromStart }`
- `replay_viewed` — `{ eventId, replayId, atSeconds }`
- `replay_progress_50pct` — `{ eventId, replayId }`
- `replay_completed` — `{ eventId, replayId }`
- `coach_event_created` — `{ eventId, attendanceKind, willRecord }`
- `coach_event_cancelled` — `{ eventId }`

No PII; coachSlug + eventId are sufficient context.

## Feature flags / entitlements

- Flag: `features.events`. Off by default.
- Entitlement: `entitlements.events.create` (coach side,
  Pro/Studio).
- Per-event entitlement: `entitlements.event:<eventId>` (purchase
  or coach grant). Spaces and programs may bundle event
  entitlements; that bundling is server-side.
- Team Mode: `roles.create_events` controls who in the team
  authors.

## Privacy / moderation

- Recording consent: any event marked recorded must show the
  consent notice to attendees on RSVP and again on Join. Notice
  copy is server-driven so legal can update without a build.
- Replay videos are private to entitlement holders; the URL is
  signed and short-lived.
- An attendee can leave the rail at any time; mobile does not
  monitor attendance beyond RSVP.

## Rollout

1. Internal — one team event, recording on, single entitlement
   group. Verify Join + replay end-to-end.
2. Add a `event` offer kind purchase path; verify entitlement
   granting and live-window behaviour.
3. Flip on for the storefront ring.
4. GA after replay processing latency is measured in real
   conditions and the "processing" copy reflects expected
   duration.

## Tests

- Unit: live-window helper (server-driven; mobile only renders).
- Unit: time-zone display logic.
- Component: EventDetailScreen across each `status` value;
  RSVP toggle persistence.
- Component: ReplayPlayerScreen seeking with chapter markers.
- Integration: purchase event → entitlement → RSVP → Join CTA
  active at start time → replay appears after processing.
- Manual: cancellation flow mid-live; recording-on consent
  notice visible.

## Risks

- **Rail outage.** If the conferencing rail has an outage at
  start time, Join 404s. Show an honest "The conferencing
  service is unavailable" surface; do not retry blindly.
- **Time-zone confusion.** The single most common support issue.
  Render zone in subtitle aggressively; document in HOW.
- **Replay piracy.** Signed URLs help but aren't perfect.
  Acceptable v1 risk; the audience is small and entitlement-gated.
- **Capacity races.** When a capped event hits capacity, the
  RSVP API must return 409; mobile renders "This event is
  full" — never silently allow.
- **Native calendar permissions.** Out of scope for v1; do not
  add `NSCalendarsUsageDescription` to `app.json` — export
  `.ics` only.

## Dependencies

- Backend #122 spaces / events service.
- `docs/expansion-wave-2/01` challenges (RSVP + reminder shape).
- `docs/expansion-wave-2/05` regimens / programs (replay
  attachment to program).
- `docs/platform-readiness/01` mobile release/EAS for any video
  permissions or background-mode adjustments.
- [02-offer-builder](./02-offer-builder.md) (`event` offer kind).
- [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md)
  (purchase path).

## Acceptance criteria

- [ ] Flag off → no events surface; deep-links to events render
      "not available".
- [ ] Flag on → member can RSVP, export to calendar (`.ics`),
      see live-window CTA, watch replay after processing.
- [ ] Coach can create, edit, cancel events; manage RSVPs;
      access recordings.
- [ ] Recording consent notice shown on RSVP and on Join.
- [ ] Time-zone subtitle visible whenever the source zone
      differs from device.
- [ ] Capped events return 409 honestly; no silent oversell.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The replay processing window is the most user-visible
  latency in the feature. Coordinate with backend to give a
  realistic expected-duration string ("usually within 1 hour")
  rather than a misleading "shortly".
- The first cancelled event with paid attendees needs a refund
  path. The refund itself flows through the payments engine
  (see [03](./03-checkout-deposits-subscriptions.md)) — but the
  trigger ("coach cancels event with paid RSVPs") must produce
  refunds automatically. Verify before flipping the flag.
- Recurring events are explicitly out of scope. The first time
  a coach asks for them, the answer is "we'll add it after we
  see how single events perform" — not "soon".
