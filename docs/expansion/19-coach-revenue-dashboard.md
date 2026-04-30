# 19 — Coach revenue dashboard

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app
**Owner:** Mobile (coach-side)

## WHY

`CoachBillingScreen` shows the coach's *own subscription* to the
platform. It does not show the coach's *revenue from clients* — MRR,
active vs paused clients, churn this month, upcoming renewals. Coaches
running this as a business want a one-glance read on the shape of their
month. A dedicated dashboard, fed by an existing payments rollup, turns
that data into something they look at without exporting CSVs.

Revenue is *income data* — sensitive, motivating, and prone to bad
chart choices. The doctrine forbids decorative metrics; every number on
this screen must answer a question the coach actually asks.

## WHEN to build

After the backend payments-rollup endpoint exists. Without server-side
aggregation, the device cannot reliably compute MRR or trend lines —
the inputs aren't on the device, and computing on a partial set is
worse than not computing at all.

This is independent of #117 / #118 in the backend; it depends on
existing payments infra.

## WHERE in the repo

- New screen: `src/screens/coach/RevenueDashboardScreen.tsx`.
- Entry: row on `SettingsScreen.tsx` ("Revenue") and a tile on
  `CoachHomeScreen.tsx` showing "MRR" + delta vs last month, tappable
  to the full screen.
- API: `coachApi.getRevenueRollup(period?)` in `src/services/api.ts`.
- Type: `src/types/revenue.ts`.

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Primary user:** Coach.
- **Audience:** Coach only — never client-visible. Treat the data as
  PII-adjacent.

## WHAT MVP includes

- **Top tiles:**
  - MRR this month.
  - Active paying clients (count).
  - Churn this month (count + %).
  - Upcoming renewals next 7 days (count).
- **Trend chart:** MRR over the last 6 months — single line, hand-rolled
  via `react-native-svg` per the existing chart pattern. No
  third-party chart library.
- **Client list (compact):** clients ranked by current MRR; tap → existing
  `ClientDetail`. Helps a coach see who is contributing what.
- Period selector: Month-to-date, Last month, Last 90 days. Default
  MTD.
- Honest empty state: "No paying clients yet — your dashboard will
  populate once payments roll in."

### Out of scope for v1

- Forecasting / projections.
- Coach-side payouts / Stripe Connect surfaces.
- Coupon analytics, refunds breakdown.
- Export to CSV (defer; if an operator asks, add a single endpoint
  later).

## HOW to implement safely

1. The screen is a *view*, not a calculator. All aggregates come from
   `getRevenueRollup`. If the rollup is missing a field, the tile
   disappears — never compute on the device.
2. Currency: display in the coach's account currency. Don't convert
   on the device. If the backend returns a single-currency total
   (e.g. USD), show the symbol explicitly.
3. The trend chart uses the same pattern as existing charts in
   `src/screens/client/ProgressScreen.tsx` (or wherever the
   hand-rolled SVG charts live). Reuse, don't reinvent.
4. The MRR tile on home is opt-in — gate with the same flag, and
   ensure that when the screen is removed (flag flipped off), the
   tile disappears too.
5. Privacy: revenue is sensitive even on a coach's own device. Avoid
   logging the numbers; ensure Sentry breadcrumbs do not capture
   them. Confirm `services/sentry.ts` redaction covers these payload
   shapes.

## Screens / navigation sketch

```
CoachHomeScreen
  └─ MRR tile (current MTD + delta vs last month) ──► RevenueDashboardScreen

SettingsScreen
  └─ Row "Revenue"                                ──► RevenueDashboardScreen

RevenueDashboardScreen
  ├─ Period selector (MTD / Last month / Last 90d)
  ├─ Tiles (MRR, Active, Churn, Upcoming renewals)
  ├─ Trend chart (6-month MRR, react-native-svg)
  └─ Top clients by MRR  ──► ClientDetail (existing)
```

## API contract dependency

- `GET /coach/revenue/rollup?period=mtd|last_month|last_90d` →
  `RevenueRollup`
  - `{ currency, mrr_cents, active_paying_clients, churn_count, churn_rate, upcoming_renewals_7d, trend_6m: { month, mrr_cents }[], top_clients: { client_id, name, mrr_cents }[] }`
- All numbers are server-computed; mobile renders.

## Feature flag / rollout

- Flag: `features.coachRevenueDashboard`.
- Phased rollout: flip on for the founding-coach cohort first; review
  numbers against backend's own admin views before going wider. Bad
  numbers on a revenue screen erode trust faster than anywhere else
  in the app.
- Kill switch hides the home tile and the screen registration.

## Testing plan

- Unit: tile renderer drops fields the rollup didn't include (no
  zero-fill).
- Unit: currency formatting for the supported currencies.
- Component: empty state, partial state (some fields missing), full
  state.
- Integration: tap home tile → lands on screen with the same period.
- Manual: spot-check MRR against a known coach's backend admin view
  on at least one production-like account before flag-on.

## Risks

- **Wrong numbers.** Highest-trust surface in the app. Verify against
  source-of-truth before any flag flip.
- **Sensitive data in logs.** Revenue numbers in Sentry breadcrumbs
  is a leak we can avoid trivially; do.
- **Empty months.** Coaches with seasonal income see scary dips.
  Tooltips on the chart that explain "this is paid revenue, not
  invoiced" prevent support tickets later. Optional but cheap.

## Dependencies

- Backend payments-rollup endpoint.
- Existing chart-rendering pattern (`react-native-svg`).
- `services/sentry.ts` redaction confirmation.

## Acceptance criteria

- [ ] Flag off → no home tile, no screen.
- [ ] Flag on, no paying clients → honest empty state.
- [ ] Flag on, with data → tiles, trend chart, and top-clients list
      match the backend admin view for the same coach.
- [ ] Numbers do not appear in any Sentry payload.
- [ ] No hardcoded hex; theme tokens only.
- [ ] `src/screens/coach/README.md` updated.
