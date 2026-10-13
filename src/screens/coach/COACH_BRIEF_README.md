# Coach Brief

## Purpose

The Coach Brief is the coach's once-a-day read: Roman turns the day's scattered activity (money since midnight, unread messages, check-ins, workouts waiting for approval, weight trends) into a short highlights paragraph, then lists the items that need the coach. Each item opens the screen that resolves it. The brief is for the coach only; nothing is sent to clients.

## Entry points

- Coach Home (Command Center Overview): `BriefHomeCard` in `CoachHomeCards`, behind `featureFlags.coachBrief`.
- Daily push (backend `coach-brief.scheduler`, `actionScreen: 'CoachBrief'`) via `pushTapRouter` `CoachBrief`.
- Route: `SettingsStack > CoachBrief`, always opened with `initial: false` so the Settings root stays underneath.

## State machine

```
mount
  └─ featureFlags.coachBrief === false → "Coach Brief is preview-only" (terminal)
  └─ GET /coach/brief/today
       └─ status generated → header (Roman card when romanChat, else plain card) + "Needs you" list; POST :id/read once
       └─ status pending/generating → "still being prepared", polls every 2.5 s (12 tries)
       └─ status failed → "could not be prepared" + Prepare again (POST /coach/brief/regenerate, 3/hour)
       └─ request error → "could not load" + Try again
  └─ pull-to-refresh → GET again (cheap; the brief is prepared once a day)
```

Action rows: unread message opens the client thread; weight or check-in opens Client Detail; a workout item (older servers only; the
backend no longer sends one) opens Client Detail on Workouts and reads "Completed a workout", never an approval; dunning and revenue
open Money; team items open Team.

## Action rows (Concept A, `coachBriefGate`)

Behind `EXPO_PUBLIC_FF_COACH_BRIEF_GATE` (off in every profile; needs `coachBrief` too). Off: everything above is unchanged.

`selectBriefActions` (`brief/briefActions.ts`) is the only source of the brief's action rows:

| Clients of one kind | Row |
|---|---|
| 0 | none |
| 1, with a first name | "Reply to {first name}", "Review {first name}'s weight change", "Check on {first name}": opens what `actionTarget` opens |
| 2 or more, or 1 with no usable name | one row, "See messages", "See weight logs" or "See check-ins": opens `SettingsStack > CoachBriefList` |

Kinds are taken in a fixed order (messages, weight, check-ins, then the head coach's Money and Team) and only the first two
with a row are kept; "Thank you, Roman" follows them. Clients are counted by distinct `client_id`; items with no
`client_id`, unknown kinds and the retired `workout_approval` are dropped. A missing, blank or "Client" name never shows:
that client gets the list row. Head coach: failed payments and team revenue give one "See Money" row; Team rows ("See your
team") only with Team Mode on. A row with no destination is never shown.

Screen (`brief/CoachBriefLightScreen.tsx`, `BriefField.tsx`): with the gate on, the `CoachBrief` route shows Concept A,
"Roman in the light": a dark forest field with a cream and gold glow (SVG), Roman's face and the date, the greeting, Roman's
words, "Where would you like to start?" when there is an action, the rows, then "Thank you, Roman" (closes onto Home, the
coach app's first tab). The tab bar steps aside while it is open. States: still being prepared (checks every 5 s for 60 s,
then offers Try again), could not load (Try again), could not be prepared (Prepare again), prepared too often (Try again);
each has "Continue". Marked read once when the words show; "Today's brief is ready." is announced once after a wait.
Motion: 1.3 s reveal, a tap anywhere completes it, rows take no tap while hidden; 6 s breathing glow that stops in the
background. Reduce Motion and screen readers: everything at once, 150 ms fade, still glow. Haptics: `softImpact` on every
row; one `error` when Try again or Prepare again fails again; nothing on open or on a failure the coach did not cause.
A single-client row closes the brief and opens its screen with the Clients list beneath.

`CoachBriefList` (`brief/CoachBriefListScreen.tsx`) lists exactly the items the row counted (passed as route params, never
stored), each opening that client like the single-client row; Back returns to the brief.

## API

| Endpoint | Notes |
|---|---|
| `GET /coach/brief/today` | First call of the day prepares the brief (up to ~30 s); 40 s client timeout. Zod-validated. |
| `POST /coach/brief/regenerate` | Only offered when today's brief failed. 429 shows the throttled card. |
| `POST /coach/brief/:id/read` | Fire-and-forget; feeds the dormancy guard. |

## Tests

| File | What it asserts |
|---|---|
| `src/screens/coach/__tests__/CoachBriefScreenRoman.test.tsx` | Ready / no clients / load error / failed / polling states, tap routing, mark read. |
| `src/components/roman/__tests__/romanP3FlagOff.test.tsx` | romanChat off: plain header, no Roman surfaces. |
| `src/__tests__/wave11Screens.test.tsx` | Flag-off preview lock; source guards (live route, no approve-to-send copy). |
| `src/services/__tests__/pushTapRouter.test.ts` | `CoachBrief` push tap opens the brief with Settings underneath. |
| `src/screens/coach/brief/__tests__/briefActions.test.ts` | Action rows: messages {0,1,2,6} x weight {0,1,2,6} x check-ins {0,1,5}, shuffled; repeats, names, ids, unknown and head coach kinds. |
| `src/screens/coach/brief/__tests__/CoachBriefListScreen.test.tsx` | Every counted client listed and opened; no "Client"; Back; empty list. |
| `src/screens/coach/brief/__tests__/CoachBriefLightScreen.test.tsx` | Every state, every row's destination, haptics, mark read once, announce once, reveal never takes a hidden tap. |
| `src/navigation/__tests__/coachBriefGateFlagOff.test.ts` | Gate defaults off, no profile sets it; gate off keeps `CoachBriefScreen`, the tab bar and no list route. |
