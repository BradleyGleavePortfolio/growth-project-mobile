# 12 — Ready-to-scale checklist UI

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app
**Owner:** Mobile (coach-side)

## WHY

Solo coaches who want to grow into a team — or an agency model — get stuck
on the same handful of operational gaps: unclear pricing, no intake
template, no public profile, no SOPs for clients churning. A
"ready-to-scale" checklist is a guided self-audit they can complete inside
the app, with each item linking to the surface that fixes it (intake →
#14, public profile → #16, voice/tone → #11, etc.). It's both a UX glue
and a soft funnel into the rest of the expansion-pack features.

## WHEN to build

After the features it links *to* have a flagged-on path — at least #11,
#14, #16. Shipping a checklist that points to dead screens is worse than
no checklist. A safe order: ship #11/#14/#16 → ship #12 referencing them.

## WHERE in the repo

- New screen: `src/screens/coach/ReadyToScaleScreen.tsx`.
- Entry: row on `SettingsScreen.tsx` ("Ready to scale — checklist") and
  optionally a card on `CoachHomeScreen.tsx` until the checklist is
  complete (auto-hides at 100%).
- API: `coachApi.getReadinessStatus()` returning a derived status object
  computed server-side. Computing it on the device is brittle and
  duplicates business rules.
- Type: `src/types/readiness.ts` — `ReadinessChecklist`,
  `ReadinessItem`.

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Primary user:** Coach (especially solo coaches considering scale).
- **Secondary:** Internal — the same data backs ops dashboards if we
  decide to surface "% of coaches scale-ready" later (out of scope for
  this README).

## WHAT MVP includes

- A vertical list of ~6 items, each with: title, one-line description,
  status (`done` / `in_progress` / `not_started`), and a CTA that
  navigates to the relevant surface.
- Items in v1:
  1. **Set your AI voice** → #11 screen
  2. **Create an intake template** → #14 surface
  3. **Publish your public profile** → #16 entry
  4. **Add a starter program** → #18 entry (or existing
     `ProgramTemplatesScreen`)
  5. **Connect billing** → existing `CoachBillingScreen`
  6. **Invite your first client** → existing `InviteCodesScreen`
- Progress bar at the top: `done / total`.
- Honest empty state never appears (the list is fixed); but if the
  status endpoint 404s, render the items as `not_started` and disable
  the progress bar — never fake completion.

### Out of scope for v1

- Editable / coach-defined items (the list is curated for v1).
- Gamification (badges, streaks). Doctrine: no decorative chrome.
- Reminders / push notifications.

## HOW to implement safely

1. The status endpoint is the source of truth. Items the mobile app
   knows nothing about (server-only checks) still render correctly via
   the returned `code` + a fallback copy table on the device.
2. Ship a fallback copy table keyed by `code` so a new server-side item
   appears on old clients as a generic "Recommended next step" rather
   than crashing.
3. CTA navigation is per-item. Resolve the route at render time; if the
   target feature flag is off, render the item as disabled with helper
   text "Coming soon for your account" — but only if the flag is
   genuinely off, never as a placeholder.
4. The card on `CoachHomeScreen` auto-hides when all items are `done`.
   Do not persist a "Dismiss" — let the data drive visibility.

## Screens / navigation sketch

```
CoachHomeScreen
  └─ "Ready to scale" card (n/total complete) ──► ReadyToScaleScreen

SettingsScreen
  └─ Row "Ready to scale — checklist" ──► ReadyToScaleScreen

ReadyToScaleScreen
  ├─ Progress bar (done/total)
  ├─ Item rows (status + CTA)
  └─ Each CTA  ──► target screen (#11, #14, #16, #18, Billing, InviteCodes)
```

## API contract dependency

- `GET /coach/readiness` →
  `{ items: { code: string, status: 'done'|'in_progress'|'not_started' }[], generated_at: string }`
- Item codes are stable strings; mobile maintains a copy/CTA table
  keyed by code with a generic fallback for unknown codes.

## Feature flag / rollout

- Flag: `features.coachReadiness`.
- Roll out *after* the surfaces it points to are flagged on for the
  same coaches. A coach who taps "Set your AI voice" and gets a "not
  available" screen will trust the checklist less.
- Kill switch hides the row and the home card.

## Testing plan

- Unit: copy/CTA fallback when an unknown code arrives.
- Component: each status renders correctly; progress math is right;
  100% complete hides the home card.
- Integration: completing the underlying action (e.g. saving voice
  settings) → next refetch flips the item to `done`.
- Manual: walk a fresh coach account through the entire list; confirm
  every CTA lands on a usable screen.

## Risks

- **Stale items.** Server-side rules change; mobile copy doesn't. The
  fallback table mitigates, but reviewers should sanity-check the copy
  table on every release.
- **Pointing to dead screens.** Worst-case UX. The flag-gating above is
  the prevention. Treat shipping #12 ahead of its dependencies as a
  bug.
- **Checklist fatigue.** If the list is too long it becomes
  intimidating. Stay at ~6 items for v1.

## Dependencies

- #11, #14, #16, plus existing `CoachBillingScreen` and
  `InviteCodesScreen`. #18 ideally; existing
  `ProgramTemplatesScreen` is the fallback target.

## Acceptance criteria

- [ ] Flag off → no row, no card.
- [ ] Flag on → list renders, progress is correct, CTAs land on real
      screens.
- [ ] Status endpoint 404 → all items render as `not_started`,
      progress bar disabled (no fake green ticks).
- [ ] Unknown server code → renders with generic fallback copy.
- [ ] No hardcoded hex; theme tokens only.
