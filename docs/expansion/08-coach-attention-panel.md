# 08 — Coach dashboard — clients needing attention panel

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app
**Owner:** Mobile (coach-side)

## WHY

`CoachHomeScreen` already raises individual alerts (missed check-in, weight
trend) but the coach has no consolidated triage list — a single "do these
five things first" panel ranked by signal strength. Coaches with 30+
clients lose minutes per morning paging through alerts; minutes per coach
per day compound into a real retention metric. The attention panel turns
discrete alerts into prioritised action items.

This is also the surface that #20 (team mode) extends with assignee
columns, so building it first as a single-coach view simplifies that work.

## WHEN to build

After #06 (latest check-ins widget) is shipped and instrumented. The panel
shares the same fetch boundary and cache; doing them in the wrong order
forces a rewrite. The backend `attention_signals` rollup endpoint must be
ready — without it, the mobile side ends up doing N+1 fetches on the
device, which is slow and tenant-leaky.

## WHERE in the repo

- New screen: `src/screens/coach/AttentionPanelScreen.tsx` (full-screen
  list, reachable from home).
- Compact preview: `src/screens/coach/components/AttentionPreviewCard.tsx`
  on `CoachHomeScreen`, showing top 3 with "See all" → full screen.
- Stack: register `AttentionPanel` in the coach Dashboard tab stack (or
  whatever stack `CoachHomeScreen` lives in).
- API: `coachApi.getAttentionList(limit?, cursor?)` in
  `src/services/api.ts`.
- Types: `src/types/attention.ts` (new) — `AttentionItem`, `AttentionReason`.

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Primary user:** Coach.
- **Future user:** Team-mode head coach (#20) — viewing across assigned
  juniors. The MVP is single-coach; the schema must allow a future
  `assigned_to` column without a breaking change.

## WHAT MVP includes

- Ranked list of clients with at least one active attention reason.
- Reasons (v1): missed-check-in, weight-trend-up, weight-trend-down,
  no-log-7-days, message-unanswered-3-days. Each row shows the dominant
  reason + a count if multiple.
- Tap row → `ClientDetail`. Long-press → quick-action sheet (Send nudge,
  Mark resolved, Snooze 24h). Quick actions hit existing endpoints; new
  ones are out of scope.
- Pull-to-refresh; pagination if > 20 items.
- Empty state: "All clients are tracking — nothing flagged today."

### Out of scope for v1

- Custom rules / thresholds (would be a settings surface; defer).
- Assignment to junior coach (#20 will add).
- Bulk actions across multiple clients.
- Cross-week trend charts on the panel itself (live in `ClientDetail`).

## HOW to implement safely

1. Confirm the backend rollup endpoint exists and returns ranked items.
   The panel must not compute ranking on the device.
2. Add the type and API client. Validate the ranking is stable across
   pulls — a panel that re-shuffles every refresh is worse than no panel.
3. Build the full-screen list first, behind a flag. Add the preview card
   on `CoachHomeScreen` once the list is solid.
4. Quick actions reuse existing endpoints (`coachApi.sendNudge`, etc.) —
   if any required action lacks an endpoint, drop it from the v1 sheet
   rather than inventing one client-side.
5. Snooze is local-only for v1 (per-coach AsyncStorage key, 24h TTL). A
   server-side snooze can come later but is not blocking; flag it clearly
   in the README so the next operator knows.

## Screens / navigation sketch

```
CoachHomeScreen
  ├─ AttentionPreviewCard (top 3)  ──► AttentionPanelScreen
  └─ LatestCheckInsCard (#06)

AttentionPanelScreen
  ├─ Ranked list, paged
  ├─ Tap row     ──► ClientDetail
  └─ Long-press  ──► action sheet (Nudge / Mark resolved / Snooze 24h)
```

## API contract dependency

- `GET /coach/attention?limit=20&cursor=...` →
  `{ items: AttentionItem[], next_cursor: string | null }`
- `AttentionItem = { client_id, name, avatar_url?, reasons: AttentionReason[], rank: number, last_event_at: string }`
- `AttentionReason = { code: 'missed_check_in' | 'weight_trend_up' | ..., severity: 1-3, since: string }`
- `POST /coach/attention/:client_id/resolve` (optional v1; if not ready,
  hide the "Mark resolved" action from the sheet).

## Feature flag / rollout

- Flag: `features.coachAttentionPanel`.
- Phased: dark-launch to founding cohort → expand once ranking quality
  is validated by spot-checks. Bad ranking is worse than no panel.
- Kill switch hides preview card and full screen.

## Testing plan

- Unit: ranking is stable for identical inputs; renderer handles each
  reason code; unknown reason codes render as "Needs attention" without
  crashing.
- Component: empty state, 1 row, 20 rows, paginated load.
- Integration: long-press → snooze → row disappears for 24h
  (AsyncStorage); resurfaces after.
- Manual: walk through with one coach holding 10+ live clients; confirm
  the order matches their intuition.

## Risks

- **Bad ranking erodes trust fast.** If the top item is "wrong" twice in
  a week, coaches stop opening the panel. Validate with at least one
  real coach before flag-on for everyone.
- **Snooze drift.** Local snooze persists per-device; a coach using two
  devices sees a snoozed item on the other. Document this; don't fix it
  in v1.
- **Action sheet dead-ends.** Every quick action must complete or fail
  loudly. No silent no-ops.

## Dependencies

- Backend: rollup endpoint + (optional) resolve endpoint.
- Mobile: relies on the same `coachApi` patterns as the dashboard.
- Coordinates with #20 (team mode) on schema fields for future
  `assigned_to`.

## Acceptance criteria

- [ ] Flag off → no preview card, no screen registered for nav.
- [ ] Flag on, no items → honest empty state on both surfaces.
- [ ] Tap → ClientDetail; long-press → action sheet; sheet actions
      complete or fail loudly.
- [ ] Snooze persists for 24h on the same device.
- [ ] No hardcoded hex; theme tokens only.
- [ ] `src/screens/coach/README.md` updated.
