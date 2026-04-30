# 05 — Mobile client UI for weekly check-ins

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Client app
**Owner:** Mobile (client-side)

## WHY

Coaches already see check-in data on `ClientDetailScreen` via
`coachApi.getClientCheckIns`, but clients have no in-app way to *submit* a
weekly check-in. They send screenshots, DMs, or nothing — and the coach feed
fills with stale or partial data. A first-class client check-in surface closes
that loop: the coach sees structured weekly answers, the client sees their own
history, and the data becomes the substrate for the recap (#10) and the
attention panel (#8).

Without this, every later coach-side feature that consumes check-in data is
operating on a hand-typed corpus.

## WHEN to build

After the backend `check_ins` table and `POST /clients/me/check-ins` endpoint
are merged, and after the coach widget brief (#06) is ready to consume the
same payload. Build #05 → #06 → #08 → #10 in that order; reversing it produces
empty widgets and a recap with no source data.

Do not start while #14 (intake templates) is in flight if both want to share
the same template editor — agree on ownership first.

## WHERE in the repo

- New screen: `src/screens/client/CheckInScreen.tsx`.
- Entry point: a "Weekly check-in" row on `MoreScreen.tsx` (Profile tab → More
  stack), and a Home-tab nudge card when the current week's check-in is
  outstanding.
- Stack registration: add `CheckIn` to the `MoreStack` in
  `src/navigation/ClientNavigator.tsx`. Do **not** add a fifth bottom tab.
- API client: extend `src/services/api.ts` with `clientApi.submitCheckIn`,
  `getMyCheckIns`, `getCurrentCheckInTemplate`.
- Types: `src/types/checkIn.ts` (new) — share the response shape with the
  coach widget (#06) by importing the same type.

## WHO owns and uses it

- **Builder:** Mobile client team.
- **Primary user:** Client (signed-in `role: 'client'`).
- **Secondary consumer:** Coach (read-only via #06, #08, #10).

## WHAT MVP includes

- Single screen, scrolling form, with the question set defined by the active
  template (defaults to the system template until #14 ships custom ones).
- Question types for v1: short text, long text, 1–10 scale, weight (kg/lb),
  optional photo (1 image, optional for v1 — gated by a separate flag if photo
  upload isn't ready).
- "Submit" creates the check-in for the current ISO week (Mon–Sun in the
  client's local TZ; server normalises). Resubmitting the same week updates
  the existing row (idempotent on `client_id + iso_week`).
- History list — read-only, last 12 weeks, no edits.
- Honest empty state when the template returns 404 (backend not shipped):
  "Your coach hasn't set up check-ins yet" — not a spinner, not a fake form.

### Out of scope for v1

- Custom per-client templates (covered by #14).
- Voice-note answers.
- Coach commenting on a specific check-in (use existing messages thread).
- Push reminders (a follow-on; add only after the form ships and we have data
  on completion rates).

## HOW to implement safely

1. Land the type and the API client first. No screen yet — get the contract
   compiling against the backend OpenAPI.
2. Add the screen behind a feature flag (`features.weeklyCheckIns` in Zustand
   settings store) defaulting to `false`. Hide both the More row and the
   Home nudge when the flag is off.
3. Reuse existing form primitives from `src/components/`. Do not introduce a
   new form library.
4. Validate locally before submit; surface inline errors. Never block submit
   on a network race — optimistic queue via `foodLogQueue.ts`'s pattern if
   offline support is needed (defer if not).
5. Submit returns the created/updated row; persist into a Zustand slice keyed
   by ISO week so the Home nudge disappears immediately.
6. Test the wrong-week edge: a check-in submitted at 23:59 local on Sunday
   must be filed for *that* week, not the next one. Use the client's TZ; the
   server is the tiebreaker.

## Screens / navigation sketch

```
Home tab
  └─ HomeScreen
       └─ "Weekly check-in due" card  ──► More stack → CheckInScreen

Profile tab (More stack)
  └─ MoreScreen
       └─ Row: "Weekly check-in"      ──► CheckInScreen
                                        ├─ form (current week, prefilled if exists)
                                        └─ "History" link  ──► CheckInHistoryScreen (read-only list)
```

## API contract dependency

- `GET /clients/me/check-in-templates/active` → `{ template_id, questions: Question[] }`
- `GET /clients/me/check-ins?limit=12` → `CheckIn[]` (most recent first)
- `POST /clients/me/check-ins` body `{ iso_week: 'YYYY-Www', answers: Answer[] }`
  → `CheckIn` (idempotent on `client_id + iso_week`)
- `GET /clients/me/check-ins/current` → `CheckIn | null` (returns the row for
  this week if one exists)

If any of these 404, the screen renders the honest empty state and the Home
nudge stays hidden.

## Feature flag / rollout

- Flag: `features.weeklyCheckIns` (Zustand `settingsStore`). Default `false`.
- Rollout: enable in dev → enable for the founding-coach test cohort via
  remote-config flip → general availability.
- Kill switch: flipping the flag off must hide the More row, the Home nudge,
  and any unsubmitted draft. No orphaned UI.

## Testing plan

- Unit: ISO-week boundary tests (Sun 23:59 local, Mon 00:01 local across DST
  transitions).
- Unit: form validation per question type.
- Component: snapshot of empty state, in-progress state, submitted state.
- Integration: submit → history appears → resubmit same week updates row.
- Manual: TestFlight build with flag on for one coach + two clients.

## Risks

- **Template drift.** If #14 lands custom templates after #05 ships, the
  client must handle unknown question types gracefully. Render an "unknown
  question — update the app" placeholder rather than crashing.
- **Time zones.** The most likely production bug. Add a regression test the
  day you write the screen.
- **Photo uploads.** Easy to scope-creep. Defer if the backend signed-URL
  flow isn't ready.

## Dependencies

- Backend: `check_ins`, `check_in_templates` tables and the four endpoints
  above.
- Mobile: types shared with #06 (`src/types/checkIn.ts`).
- No new npm dependencies.

## Acceptance criteria

- [ ] Flag off → no UI surface anywhere in the app.
- [ ] Flag on, no template → honest empty state, no spinner, no fake form.
- [ ] Flag on, template present → can submit, see in history, resubmit
      updates the same row.
- [ ] ISO week is computed in the client's local TZ; server is tiebreaker.
- [ ] Type-check passes; new screen has a per-module README entry under
      `src/screens/client/README.md`.
- [ ] No hardcoded hex; theme tokens only.
