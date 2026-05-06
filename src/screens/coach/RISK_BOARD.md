# Coach Risk Board — PTM Phase 1E

The first time the coach sees PTM (Predictive Tracking Model) scores. Surfaces
the per-client risk score plus a "Send check-in nudge" action so the coach can
intervene before a client churns.

## Screens

- **`RiskBoardScreen.tsx`** — Sorted list of clients by `risk_score DESC`.
  - Server-side filter chips: All / Red / Amber / Green.
  - Pull-to-refresh; cursor-paginated (20 per page); infinite scroll.
  - Row: traffic-light dot, name + email, risk %, last-signal "Xd ago".
  - Empty state: _"No risk data yet — recompute runs nightly at 04:00 UTC."_
  - Tap → `ClientRiskDetail`.
- **`ClientRiskDetailScreen.tsx`** — Single-client detail.
  - Big traffic-light + risk %.
  - Sorted factor list (the "why" drawer). Positive contribution = red bar
    (adds risk), negative = green bar (protective).
  - Last 14 PtmPredictions, one row per recompute.
  - Outcome label badge if present.
  - "Send check-in nudge" — POSTs through the existing `coachApi.sendNudge`
    wire (`POST /coach/clients/:id/nudges`). Lower-friction than dropping the
    coach into Messages: one tap, templated body.

## Components

- **`src/components/RiskDot.tsx`** — 12 px (default) traffic-light dot. Maps
  bucket → forest / mutedGold / oxblood from the design tokens.
- **`src/components/FactorRow.tsx`** — One factor in the "why" drawer. Renders
  label, optional `observed` count, and signed contribution percentage with a
  coloured side bar.

## API

Wired through `src/services/ptmApi.ts`:

| Endpoint                                      | Used by                |
| --------------------------------------------- | ---------------------- |
| `GET  /admin/ptm/risk-board?bucket&cursor`    | `RiskBoardScreen`, home widget |
| `GET  /admin/ptm/clients/:id`                 | `ClientRiskDetailScreen`       |
| `GET  /admin/ptm/outcomes`                    | (reserved for outcome history) |
| `POST /admin/ptm/clients/:id/outcomes`        | (reserved for outcome labels)  |

The four endpoints are typed against the backend DTOs in
`gpb/src/admin/ptm/admin-ptm.dto.ts` (the contract another agent is building
in parallel).

## Role gating — temporary OWNER-only

Phase 1E ships with **OWNER-only** access. This is a deliberate, time-boxed
constraint:

- The backend `/admin/ptm/*` endpoints are gated by an admin guard. Coaches
  do not have direct access today.
- `CoachGuard` lets the OWNER role bypass coach scoping, so the OWNER seeing
  their own clients via these endpoints is the only role/data combo that
  works end-to-end in this release.
- Students must NEVER see PTM scores. The role check on
  `RiskBoardScreen` and `ClientRiskDetailScreen` is doctrine belt-and-braces
  on top of the navigator-level role split.

When a coach (non-owner) opens the screen they see a placeholder:
_"Coach risk board coming with the next backend release."_ — no fake data.

## Follow-on plan

A coach-scoped `GET /coach/clients/risk-board` endpoint is planned for the
next backend release. When it lands:

1. Add `coachApi.getMyRiskBoard()` (same shape as `ptmApi.getRiskBoard`).
2. Switch the `isOwner` gate to a feature-detection check, or branch on
   role at the call site.
3. Drop the placeholder screen.

## Doctrine

- No raw model internals are exposed. The basis (`heuristic_v1`,
  `weighted_v2`, `model_v3`) is **not** rendered. Only `risk_score`,
  `factors[].label`, and the sign of `factors[].contribution`.
- No emoji, no gamification, no confetti.
- Theme: bone background, ink text, oxblood for risk, forest for protection.
- TypeScript strict, no `any`.

## Tests

- `src/__tests__/RiskDot.test.tsx` — snapshot per bucket.
- `src/__tests__/RiskBoardScreen.test.tsx` — source-level guards for the
  role gate, filter chips, cursor pagination, navigation contract, and the
  doctrine that the engine basis is not surfaced. Plus an RTL render test
  for the non-owner placeholder branch.
