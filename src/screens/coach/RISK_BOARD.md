# Coach Risk Board — PTM Phase 1E

The coach risk board is the first surface where PTM (Predictive Transformation Model) scores leave the backend. It lists every client on a coach's roster sorted by churn risk so a coach can intervene before a client drops off. The owner gets a platform-wide view with the raw numeric score; coaches see the traffic-light bucket (red / amber / green) only — the raw float is redacted server-side before the response is sent.

---

## Screens + State Machine

### `RiskBoardScreen.tsx`

| State | Trigger | What renders |
|---|---|---|
| `locked` | `currentUser.role` is not `'coach'` or `'owner'` | "Restricted" panel, `testID="risk-board-locked"`, no fetch fires |
| `loading` (initial) | mount with `canViewBoard=true` | `ActivityIndicator` (large), no list |
| `loaded` | fetch resolves with items | `FlatList` of client rows, pull-to-refresh active |
| `empty` | fetch resolves with `items: []` | Inline message — "No risk data yet — recompute runs nightly at 04:00 UTC." |
| `error` | fetch rejects | `ListEmptyComponent` shows "Could not load risk data" + the error message |
| `loading-more` | user scrolls to 80% of list | `ActivityIndicator` (small) in list footer |
| `refreshing` | pull-to-refresh gesture | `RefreshControl` spinner, cursor resets, list replaced |

Filter chip state machine (orthogonal to above):

- Default filter: `'all'`
- Chips: All / Red / Amber / Green
- Selecting a chip resets `items`, `cursor`, and re-fetches with the new `bucket` query param
- The `useEffect` dependency array `[filter, canViewBoard]` ensures re-fetch on both filter change and role arrival

### `ClientRiskDetailScreen.tsx`

Navigated to by tapping a row. Reads `GET /admin/ptm/clients/:id` (OWNER + coach both hit this endpoint via the admin PTM service). Shows:

- Traffic-light dot + risk percentage
- Sorted factor list ("why" drawer) via `FactorRow` components
- Last 14 `PtmPrediction` rows
- Outcome label badge if present
- "Send check-in nudge" button — fires `POST /coach/clients/:id/nudges`

---

## Components

### `src/components/RiskDot.tsx`

Traffic-light indicator. Maps bucket → theme color token:

| Bucket | Token | Visual |
|---|---|---|
| `green` | `colors.success` | Forest green dot |
| `amber` | `colors.warning` | Muted gold dot |
| `red` | `colors.error` | Oxblood dot |

Props: `bucket: PtmRiskBucket`, `size?: number` (default `12`), `testID?: string`.

### `src/components/FactorRow.tsx`

One factor in the "why" drawer. Renders label, optional `observed` count, and signed contribution as a coloured side-bar percentage. Positive contribution (adds risk) uses `colors.error`; negative (protective) uses `colors.success`.

---

## API Endpoints Consumed

| Endpoint | Method | Caller role | Used by |
|---|---|---|---|
| `/admin/ptm/risk-board?bucket&cursor&limit` | GET | OWNER only | `RiskBoardScreen` (owner branch) |
| `/coach/clients/risk-board?bucket&cursor&limit` | GET | Coach (own roster) | `RiskBoardScreen` (coach branch) |
| `/admin/ptm/clients/:id` | GET | OWNER + coach | `ClientRiskDetailScreen` |
| `/admin/ptm/outcomes` | GET | OWNER | (reserved — outcome history) |
| `/admin/ptm/clients/:id/outcomes` | POST | OWNER | (reserved — outcome labelling) |
| `/coach/clients/:id/nudges` | POST | Coach | "Send check-in nudge" button |

All requests flow through `src/services/ptmApi.ts`. Both risk-board endpoints return the same envelope shape:

```ts
{
  data: RiskBoardEntry[];  // items array
  next_cursor: string | null;
  generated_at?: string;
}
```

The OWNER endpoint populates `risk_score` and `success_score` as floats. The coach endpoint sets both to `null` — the bucket is pre-computed server-side before the score is dropped, so the coach sees the same triage decision the OWNER would.

### Score redaction — why coaches see a bucket, not a percentage

`risk_score` is a model internal. Surfacing the raw float invites gaming and over-interpretation. The project doctrine pins the numeric score as OWNER-only.

Redaction is server-side: `/coach/clients/risk-board` returns `risk_score: null`. The mobile screen branches on `item.risk_score == null` — the percentage render path (`Math.round(risk_score * 100)`) is never reached for coach-scope rows. There is no client-side fallback that re-derives a percentage from the bucket.

---

## Env Vars / Feature Flags

| Var | Default | Meaning |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | (required) | Base URL for all API calls — consumed by `src/services/api.ts` |

No feature flags gate this screen. Role gating is enforced at the screen level (`currentUser.role`) and on the backend (JWT + CoachGuard / RolesGuard). A student-role token physically cannot reach the risk-board data.

---

## Tests

| File | Assertions |
|---|---|
| `src/__tests__/RiskBoardScreen.test.tsx` | Source-level: role gate present, locked `testID`, coach vs owner endpoint routing, filter chip array, `useEffect` dep array, `ClientRiskDetail` navigation, `04:00 UTC` copy, no engine basis exposed, `risk_score == null` branch present. RTL: locked branch mounts for student; coach calls `getMyRiskBoard` (never owner endpoint); empty state renders "04:00 UTC"; loaded-data row renders client name and bucket label; error state renders "Could not load risk data" + error message; owner calls `getRiskBoard`, renders numeric percentage. |
| `src/__tests__/RiskDot.test.tsx` | Snapshot per bucket (green / amber / red) plus custom `size` prop. |

---

## Known Limits / Future Work

- **`/coach/clients/risk-board` backend endpoint**: this endpoint must exist in `growth-project-backend/src/coach/coach.controller.ts`. It mirrors `GET /admin/ptm/risk-board` but filters to the calling coach's roster and nulls `risk_score` / `success_score` on every row before returning. If the endpoint is not yet deployed, coaches will receive a 404 and the error state will render.
- **`ClientRiskDetailScreen.tsx`**: referenced in the README and navigation contract but shipped as a separate screen — confirm it exists in the navigator before releasing to production.
- **Outcome labelling from the risk board**: the spec calls for a one-click "label outcome" flow from the risk board. `ptmApi.labelOutcome` is wired but no UI button exists on this screen yet. Reserved for Phase 1C follow-up.
- **Admin home widget**: a risk-count widget (red / amber / green totals) on the admin home screen is part of Phase 1E spec. Not in scope for this PR — tracked separately.
