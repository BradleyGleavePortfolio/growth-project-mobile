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

`selectBriefActions` (`brief/briefActions.ts`) is the only source of the brief's action rows; `actionTarget` (where each item
opens) lives in the same file and `CoachBriefScreen` re-exports it, so nothing under `brief/` imports a screen.

| Items of one kind | Row |
|---|---|
| 0 | none |
| 1 client, with a first name | "Reply to {first name}", "Review {first name}'s weight change", "Check on {first name}": opens what `actionTarget` opens |
| 2 or more clients, or 1 with no usable name | one row, "See messages", "See weight logs" or "See check-ins": opens `SettingsStack > CoachBriefList` |
| Head coach: failed payments or team revenue | one row, "See payments": opens Money (`SettingsStack > CoachMoney`; the Money tab with `coachTabsV2`) |
| Head coach: team items | one row, "See your team": opens Team, only while Team Mode is on (otherwise no row) |

Kinds are taken in a fixed order (messages, weight, check-ins, Money, Team) and only the first two with a row are kept;
"Thank you, Roman" follows them. Clients are counted by distinct `client_id`; items with no `client_id`, unknown kinds and the
retired `workout_approval` are dropped. A missing, blank or "Client" name never shows: that client gets the list row. One total
order (`compareEntries`: a usable name first, then name, priority, detail, id, link) picks the entry kept for a repeated client
and sorts every list A to Z, so the same items in any order give exactly the same rows. Team Mode is an argument
(`selectBriefActions(items, { teamMode })`, default `featureFlags.teamMode`).

Screen (`brief/CoachBriefLightScreen.tsx`, `BriefField.tsx`): with the gate on, `CoachBrief` shows Concept A, "Roman in the
light": Roman's face and the date, the greeting, his words, up to two rows, then "Thank you, Roman" (closes onto the coach's
landing tab, `coachLandingTab`). The tab bar steps aside while it is open (`EntryTabBar` passes the open route's `tabBarStyle`).
States: preparing (checks every 5 s for 60 s), could not load, could not be prepared, prepared too often; each has "Continue".
Marked read once. Motion: 1.3 s reveal (a tap completes it), 6 s glow; Reduce Motion and screen readers get everything at once.
Haptics: `softImpact` on every row; one `error` when a retry fails again. A "See ..." list row keeps the brief; other rows close it.

`CoachBriefList` (`brief/CoachBriefListScreen.tsx`) lists exactly the items the row counted (passed as route params, never
stored), each opening that client like the single-client row; Back returns to the brief.

### Folded rows (ROMAN-EXTRAS-M, owner pick "RXM - Style A")

When the brief carries `brief_context.checkins_to_review` (servers with b#1118), every kind gets a row (messages, weight,
check-ins, then new clients: `client_joined` -> "Say hello to {first name}" / "See new clients", opening the chat) and a
check-in waiting on review (`checkin_review`) joins the check-ins kind. A list row shows its count (the length of the list it
opens) and folds open in place, one at a time (200 ms; Reduce Motion fades), to the newest three and "See all {n}". Lists
sort by `occurred_at`, newest first, when the server sends it (reviews before missed check-ins), else by `compareEntries`;
a client both waiting on a review and missing today counts in each. `CoachBriefList` shows check-ins and new clients under
their detail ("Check-in needs review", "Joined today") with the group's count, ten rows a group, then "Show more". A brief
without `brief_context` (an older server) keeps the rows above unchanged: two kinds, no counts, list rows open the list.

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
| `src/screens/coach/brief/__tests__/briefActions.test.ts` | Action rows: messages {0,1,2,6} x weight {0,1,2,6} x check-ins {0,1,5}, whole result equal when reversed and shuffled; every order of tricky sets; repeats, names, ids, unknown kinds; head coach rows with Team Mode off and on. |
| `src/screens/coach/brief/__tests__/CoachBriefListScreen.test.tsx` | Every counted client listed and opened; no "Client"; Back; empty list. |
| `src/screens/coach/brief/__tests__/CoachBriefLightScreen.test.tsx` | Every state, every row's destination, haptics, mark read once, announce once, reveal never takes a hidden tap. |
| `src/navigation/__tests__/coachBriefGateFlagOff.test.ts` | Gate defaults off, no profile sets it; gate off keeps `CoachBriefScreen`, the tab bar and no list route. |
