# 06 — Coach dashboard widget — latest check-ins

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app
**Owner:** Mobile (coach-side)

## WHY

Once clients can submit check-ins (#05), the coach needs a "what's new this
week" surface that doesn't require opening every client. The current coach
home (`CoachHomeScreen.tsx`) shows weight-trend / missed-check-in *alerts*
but not the actual answers. A latest-check-ins widget answers the question
"who has checked in this week, and what did they say?" in one glance.

## WHEN to build

Strictly after #05 (Mobile client UI for weekly check-ins) is in production
*for at least one cohort*. Before that, the widget would be empty for every
coach in production. After #05 there is real data to render.

Build before #08 (attention panel) so the coach gains read access to
check-in payloads first; the attention panel reuses the same type.

## WHERE in the repo

- New component: `src/screens/coach/components/LatestCheckInsCard.tsx`.
  Coach screens currently keep components inline; create the
  `coach/components/` directory if it doesn't exist and add a README.
- Mounted in: `CoachHomeScreen.tsx`, above the existing alerts list.
- API: `coachApi.getRecentCheckIns(limit)` added to `src/services/api.ts`.
- Type: imports `CheckIn` from `src/types/checkIn.ts` (created by #05).

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Primary user:** Coach.
- **Secondary user:** None — read-only widget.

## WHAT MVP includes

- A card showing up to 5 most recent check-ins across the coach's clients.
- Each row: client name + avatar, ISO week, weight delta vs prior week
  (if computable), one-line preview of the first long-text answer.
- Tap a row → `ClientDetailScreen` deep-link with the check-in pre-scrolled
  into view.
- Pull-to-refresh on `CoachHomeScreen` refetches the widget alongside
  existing dashboard calls.
- Honest empty state: "No check-ins this week yet" — not a placeholder grid.

### Out of scope for v1

- Inline reply / comment from the widget (defer to messages thread).
- Filtering by tag, plan, or status (defer to #08's panel).
- Aggregation across weeks (defer to #19's revenue dashboard pattern if
  needed).

## HOW to implement safely

1. Add `coachApi.getRecentCheckIns(limit = 5)` returning `CheckIn[]` already
   joined with the client's display name. Do not fetch each client
   separately on the device — the backend is the join boundary.
2. Render via React Query hook to share cache with `ClientDetailScreen`.
   Stale-while-revalidate keeps the home dashboard snappy.
3. The deep-link target on tap should be a `navigate('ClientDetail', { clientId, focusCheckInId })`.
   The detail screen scrolls to that check-in or no-ops if focusCheckInId
   is unknown — never crashes.
4. Skeleton loader for first paint; subsequent loads use the cached value
   silently.
5. Tenant safety is implicit via JWT — do *not* accept a `coach_id`
   parameter in `getRecentCheckIns`. Backend filters; mobile asks for
   "mine".

## Screens / navigation sketch

```
CoachNavigator
  └─ Dashboard tab
       └─ CoachHomeScreen
            ├─ LatestCheckInsCard      (new)  ──► ClientDetail (focusCheckInId)
            ├─ Existing alerts list
            └─ Existing dashboard tiles
```

## API contract dependency

- `GET /coach/check-ins/recent?limit=5` → `CheckInWithClient[]`
  - `CheckInWithClient = CheckIn & { client: { id, name, avatar_url? } }`
- Reuses `CheckIn` from #05.
- No new write endpoints.

## Feature flag / rollout

- Flag: `features.coachCheckInsWidget` (settings store, default `false`).
- The flag is independent of #05's flag. Enabling it before #05 is in
  production renders the empty state to every coach — annoying but safe.
- Kill switch removes the card and refetch from the home dashboard.

## Testing plan

- Component: empty state, 1 row, 5 rows, overflow (5+ available).
- Integration: tap row → ClientDetail mounts with `focusCheckInId` in
  params and scrolls (or no-ops on unknown id).
- Manual: side-by-side with #05 in TestFlight; submit a check-in as
  client → appears on coach widget within the React Query refetch
  window.

## Risks

- **Empty by design.** Until #05 has adoption, the widget will be empty for
  most coaches. Confirm the empty state copy is honest and not aspirational.
- **Privacy in preview.** A long-text answer preview could surface
  sensitive content above the fold. Trim aggressively (≤ 80 chars) and
  rely on the detail screen for full context.

## Dependencies

- #05 in production for non-empty data.
- Shared `CheckIn` type from `src/types/checkIn.ts`.

## Acceptance criteria

- [ ] Flag off → no card on coach home, no extra network call.
- [ ] Flag on, no data → honest empty state, no skeleton stuck on screen.
- [ ] Flag on, with data → up to 5 rows, tap navigates correctly.
- [ ] No hardcoded hex; theme tokens only.
- [ ] Per-module README under `src/screens/coach/README.md` updated to
      mention the new component directory.
