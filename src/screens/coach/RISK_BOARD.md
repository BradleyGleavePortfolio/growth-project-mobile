# Coach Risk Board — PTM Phase 1E

The first time the coach sees PTM (Predictive Tracking Model) scores. Surfaces
the per-client risk bucket (and, for the OWNER, the underlying %) plus a
"Send check-in nudge" action so the coach can intervene before a client
churns.

## Screens

- **`RiskBoardScreen.tsx`** — Sorted list of clients by `risk_score DESC`.
  - Server-side filter chips: All / Red / Amber / Green.
  - Pull-to-refresh; cursor-paginated (20 per page); infinite scroll.
  - Row: traffic-light dot, name + email, risk indicator (% for the OWNER,
    bucket label for a coach — see "Score redaction" below), last-signal
    "Xd ago".
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

| Endpoint                                      | Used by                                           |
| --------------------------------------------- | ------------------------------------------------- |
| `GET  /admin/ptm/risk-board?bucket&cursor`    | `RiskBoardScreen` (OWNER branch), home widget     |
| `GET  /coach/clients/risk-board?bucket&cursor`| `RiskBoardScreen` (coach branch — Phase 1E coach scope wired) |
| `GET  /admin/ptm/clients/:id`                 | `ClientRiskDetailScreen`                          |
| `GET  /admin/ptm/outcomes`                    | (reserved for outcome history)                    |
| `POST /admin/ptm/clients/:id/outcomes`        | (reserved for outcome labels)                     |

`ptmApi.getMyRiskBoard()` is the typed wrapper for the coach endpoint;
both endpoints return the same envelope so the screen renders either
without conditionals.

## Role gating — coach scope wired

As of this release the coach branch is real data — **the placeholder is
gone**.

- **OWNER**: hits `/admin/ptm/risk-board` (platform-wide). Renders the
  numeric percentage alongside the traffic-light dot.
- **Coach**: hits `/coach/clients/risk-board` (the calling coach's roster
  only). Renders the **bucket label** (RED / AMBER / GREEN) where the
  OWNER row would show a percentage.
- **Anything else** (student, missing role): renders a "Restricted"
  screen with `testID="risk-board-locked"`. RootNavigator stops a
  student long before this screen mounts; the explicit lock is
  doctrine belt-and-braces.

### Score redaction (why coaches see a bucket, not a percentage)

The PTM `risk_score` is a model internal. A coach is authorised to act on
the **bucket** (green / amber / red) — that is the triage signal.
Surfacing the raw float would invite gaming and over-interpretation, and
the project doctrine pins the score as OWNER-only.

The redaction is enforced **server-side**, not in the UI:

- `/coach/clients/risk-board` returns `risk_score: null` and
  `success_score: null` on every row. The bucket is computed by the same
  `bucketize()` thresholds used by the OWNER endpoint, *before* the score
  is dropped, so the coach sees the same triage decision the OWNER would.
- The mobile screen's percentage path (`Math.round(risk_score * 100)`)
  short-circuits when `risk_score == null`. There is no client-side
  fallback that re-derives a percentage from the bucket — by design.

## Doctrine

- No raw model internals are exposed. The basis (`heuristic_v1`,
  `weighted_v2`, `model_v3`) is **not** rendered. Only `risk_score`
  (OWNER only), the bucket, `factors[].label`, and the sign of
  `factors[].contribution`.
- No emoji, no gamification, no confetti.
- Theme: bone background, ink text, oxblood for risk, forest for protection.
- TypeScript strict, no `any`.

## Tests

- `src/__tests__/RiskDot.test.tsx` — snapshot per bucket.
- `src/__tests__/RiskBoardScreen.test.tsx` — source-level guards for the
  role gate, filter chips, cursor pagination, navigation contract, the
  doctrine that the engine basis is not surfaced, and the
  null-risk_score → bucket-label render branch. Plus RTL renders that
  prove (a) the locked branch mounts for non-coach/non-owner roles,
  (b) the coach role calls `getMyRiskBoard` (never the OWNER endpoint),
  and (c) the OWNER role calls `getRiskBoard` (never the coach endpoint).
