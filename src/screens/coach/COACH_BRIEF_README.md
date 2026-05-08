# Coach Brief

## Purpose

The Coach Brief is a daily morning summary screen for coaches. The AI drafts a short overview of which clients logged activity, who needs attention, and what verified-progress claims are waiting for signoff. The coach explicitly approves the draft before anything is sent — there is no autonomous delivery. The approve-to-send toggle is local state only until the backend approval endpoint ships.

All backend endpoints are **not yet live**. The adapter returns a stale empty payload.

## Screens + State Machine

| Screen | File | State |
|---|---|---|
| CoachBriefScreen | `src/screens/coach/CoachBriefScreen.tsx` | `loading → flag-off empty / stale empty / brief with draft + client cards` |

### State transitions

```
mount
  └─ featureFlags.coachBrief === false
       └─ render: "Coach Brief is preview-only" [terminal until flag on]
  └─ featureFlags.coachBrief === true
       └─ loading=true → fetch fetchCoachBrief()
            └─ success → payload.isStale=true → render stale banner
            └─ payload.morningSummary.aiDraft empty → "No brief yet" empty state
            └─ payload.morningSummary.aiDraft present → AINote draft + approve toggle
            └─ payload.clients present → CoachBriefClientCard list
  └─ pull-to-refresh → re-fetch
  └─ Pressable (approve toggle) → setDraftApproved(v => !v) [local state only]
```

## API Endpoints Consumed

| Endpoint | Status | Notes |
|---|---|---|
| `GET /coach/brief` | **MOCKED** | Adapter returns empty stub. Replace `fetchCoachBrief()` body when endpoint ships. |
| `POST /coach/brief/approve` | **MOCKED** | Approve toggle is local state. Must call this endpoint when it exists. |

## Feature Flags

| Flag | Env var | Default (prod) | Default (dev) | Meaning |
|---|---|---|---|---|
| `coachBrief` | `EXPO_PUBLIC_FF_COACH_BRIEF` | `false` | `true` | Enables the Coach Brief surface |

## Tests

| File | What it asserts |
|---|---|
| `src/__tests__/wave11Screens.test.tsx` | Flag-off renders preview-only empty state (RTL). Source guards: flag check present, AINote draft wrapper present, approve-button has `accessibilityRole="button"` and descriptive labels, stale banner present, VerifiedProgressRow used for client cards. |
| `src/__tests__/wave11Doctrine.test.ts` | `fetchCoachBrief()` returns empty + `isStale: true`. |

## Future Work / Known Limits

- **No live backend.** `GET /coach/brief` does not exist yet. When it ships, replace `fetchCoachBrief()` body with `api.get(...)`.
- **Approve-to-send wiring.** The toggle must call `POST /coach/brief/approve` once the endpoint exists, and the response should include the `approvedAt` timestamp.
- **Delivery channel.** The approved draft can be posted as a community announcement, an in-app banner, or both — this is not yet decided. The PR description lists this as an open question.
- **Coach Brief delivery channel.** Once the brief is approved, the intent is to surface it to clients. The delivery mechanism (announcement post vs. push notification) needs a product decision before the endpoint is built.
