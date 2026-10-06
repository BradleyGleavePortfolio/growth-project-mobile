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
