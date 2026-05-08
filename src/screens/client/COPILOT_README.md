# Client Path Copilot

## Purpose

The Client Path Copilot is a per-client AI coaching surface. It reads the client's logged data (check-ins, weight, meals, workouts) and surfaces an AI-drafted summary of patterns — presented as suggestions the client can read but not act on alone. Every suggestion that requires a response is gated behind explicit coach approval before it appears in the client's feed. The screen is a trust primitive: it makes AI's role transparent and keeps the coach as the decision-maker.

All backend endpoints are **not yet live**. The screen reads from a mock-safe adapter that returns an empty, `isStale: true` payload. The empty state is intentional — the UI shows honest "no data yet" text rather than fabricated suggestions.

## Screens + State Machine

| Screen | File | State |
|---|---|---|
| ClientPathCopilotScreen | `src/screens/client/ClientPathCopilotScreen.tsx` | `loading → flag-off empty / stale empty / suggestions list` |

### State transitions

```
mount
  └─ featureFlags.clientPathCopilot === false
       └─ render: "Copilot is preview-only" [terminal until flag on]
  └─ featureFlags.clientPathCopilot === true
       └─ loading=true → fetch fetchClientPathCopilot()
            └─ success → payload.isStale=true → render stale banner + empty suggestions
            └─ success → payload.suggestions.length > 0 → render suggestion cards
  └─ pull-to-refresh → re-fetch
```

## API Endpoints Consumed

| Endpoint | Status | Notes |
|---|---|---|
| `GET /client/copilot` | **MOCKED** | Adapter returns empty stub. Replace `fetchClientPathCopilot()` body when endpoint ships. |
| `POST /coach/brief/approve` | **MOCKED** | Approval toggle is local-state only until this endpoint exists. |

## Feature Flags

| Flag | Env var | Default (prod) | Default (dev) | Meaning |
|---|---|---|---|---|
| `clientPathCopilot` | `EXPO_PUBLIC_FF_CLIENT_PATH_COPILOT` | `false` | `true` | Enables the Client Path Copilot surface for this build |
| `verifiedProgressSignoff` | `EXPO_PUBLIC_FF_VERIFIED_PROGRESS_SIGNOFF` | `false` | `true` | Enables the signoff status chips and submission list |

## Tests

| File | What it asserts |
|---|---|
| `src/__tests__/wave11Screens.test.tsx` | Flag-off renders preview-only empty state (RTL). Source guards: flag check present, AINote wrapper present, stale banner copy present, accessibility labels on root + headers + suggestion cards. |
| `src/__tests__/wave11Doctrine.test.ts` | Adapter returns `isStale: true` + empty arrays without a live endpoint. |

## Future Work / Known Limits

- **No live backend.** `GET /client/copilot` does not exist yet. When it ships, replace the body of `fetchClientPathCopilot()` in `src/services/wave11Adapters.ts` with `api.get(...)`.
- **Approval toggle is local state only.** The "Approve to send" Pressable in suggestion cards sets local `draftApproved` state. It must call `POST /coach/brief/approve` once that endpoint exists.
- **Verified-progress proof URLs.** The `proofUrl` field in `VerifiedProgressItem` is typed as `string | null`. The backend contract for proof URLs (signed S3 or signed CDN) is not yet defined.
- **Finance disclaimer domain.** Suggestions with `topic: 'finance'` use the finance-specific disclaimer. Ensure the backend's copilot suggestions populate `topic` correctly when the endpoint ships.
