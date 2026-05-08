# Admin Control Room

## Purpose

The Admin Control Room is a governance screen for platform administrators. It shows aggregate KPIs (active coaches, active clients, pending signoffs, flagged items, disputed items) and a severity-tagged alert list. The AI surfaces patterns and recommendations — never autonomous decisions. Every action (dismiss alert, escalate dispute, suspend coach) must flow through an explicit admin approval step, which is not yet built in this scaffold.

The screen is mounted in the coach navigator's Settings stack but is gated by the `adminControlRoom` flag, which defaults `false` in production and requires a server-side role check before it can be enabled safely for non-admin users.

All backend endpoints are **not yet live**. The adapter returns zero-value KPIs and an empty alert list.

## Screens + State Machine

| Screen | File | State |
|---|---|---|
| AdminControlRoomScreen | `src/screens/coach/AdminControlRoomScreen.tsx` | `loading → flag-off empty / stale empty / KPI grid + alerts list` |

### State transitions

```
mount
  └─ featureFlags.adminControlRoom === false
       └─ render: "Admin Control Room is preview-only" [terminal until flag on]
  └─ featureFlags.adminControlRoom === true
       └─ loading=true → fetch fetchAdminControlRoom()
            └─ success → render KPI grid (5 tiles) + alerts section
            └─ payload.alerts.length === 0 → "No active alerts" empty state
            └─ payload.alerts present → AlertRow list (info / watch / critical)
  └─ pull-to-refresh → re-fetch
```

## API Endpoints Consumed

| Endpoint | Status | Notes |
|---|---|---|
| `GET /admin/control-room` | **MOCKED** | Adapter returns zero-value stub. Replace `fetchAdminControlRoom()` body when endpoint ships. |
| `POST /admin/alerts/:id/dismiss` | **NOT YET BUILT** | Alert dismissal action not yet in UI. |
| `POST /admin/alerts/:id/escalate` | **NOT YET BUILT** | Escalation action not yet in UI. |

## Feature Flags

| Flag | Env var | Default (prod) | Default (dev) | Meaning |
|---|---|---|---|---|
| `adminControlRoom` | `EXPO_PUBLIC_FF_ADMIN_CONTROL_ROOM` | `false` | `true` | Enables the Admin Control Room surface |

## Tests

| File | What it asserts |
|---|---|
| `src/__tests__/wave11Screens.test.tsx` | Flag-off renders preview-only empty state (RTL). Source guards: all 5 KPI fields present, "AI suggests" used (never "AI decides"), semantic colour palette for severity, accessibility labels on screen + KPI grid + section headers. |
| `src/__tests__/wave11Doctrine.test.ts` | `fetchAdminControlRoom()` returns zero KPIs + `isStale: true`. |

## Future Work / Known Limits

- **No live backend.** `GET /admin/control-room` does not exist yet.
- **Server-side role check.** The flag-gate alone is not sufficient for production. A Supabase RLS policy or `RoleGuard` on the `/admin/control-room` endpoint must verify the requesting user is `owner` before returning data.
- **Alert action buttons.** Dismiss and escalate actions are designed but not yet rendered. When the backend dismiss/escalate endpoints ship, add `Pressable` action buttons to `AlertRow`.
- **KPI staleness.** The screen shows `isStale: true` when the adapter is in stub mode. Once the live endpoint ships, consider a polling interval (e.g., 60s) since the Brief says "freshness matters" on admin dashboards.
- **Navigation placement.** Currently under the coach `SettingsStack`. Once role-gating is confirmed server-side, consider moving it to a dedicated admin tab or a deep link accessible only from the admin web console.
