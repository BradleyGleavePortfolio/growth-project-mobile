# Mobile Import Data — Decision Record

**Date:** 2026-07-14 · **Author:** Bradley Gleave · **Wave:** importer-wave (v0.3 site-agnostic autonomous import)

## Decision

Land the **smallest coherent, non-dead-code mobile slice** of the locked v0.3 import
flow: a **default-OFF, coach-facing "Import Data" entry** in coach Settings that opens
an intro → data-driven platform picker (including Custom/Other) → safe external
login-site open, with an honest explanation of the browser-extension prerequisite.

The **live pairing-code mint/poll UX** and the **import progress/status mirror** are
deferred to a **named chained follow-up** (PR-M2), because (a) the full slice exceeds
the 400 net-prod-LOC cap (R76), and (b) the backend exposes **no mobile-readable import
progress contract** — progress/complete are written *by the extension*, not readable by
mobile. Shipping a progress UI now would require faking a contract, which is forbidden.

## Real goal

After signup, a coach can choose Import Data, pick their prior coaching platform (or a
custom site), open its login page in the browser, and understand — honestly — that the
TGP browser extension will prompt them to start the autonomous import once they log in.
No screen ever claims an import is complete when it is not.

## Root cause

The v0.3 flow needs a mobile entry point that funnels coaches from signup to the
extension-driven import. That entry did not exist. `CoachPairingScreen` is Day-1
**client-invite** pairing — a different flow — and must not be conflated or altered.

## Three options

1. **Full slice in one PR** — entry + picker + open + pairing-code mint + status poll +
   progress mirror. *Rejected:* exceeds the 400-LOC cap; requires a robust polling
   state machine + UI; and the progress mirror has no backend read contract, so part of
   it would be dead or faked.
2. **Boundary + entry + picker + safe open now; pairing/progress in PR-M2** *(chosen)* —
   a genuinely usable funnel with zero dead code, a frozen typed contract for the
   deferred wiring, and a named follow-up. Matches the brief's explicit fallback.
3. **Types-only stub** — ship interfaces and a placeholder screen. *Rejected:* an entry
   that does nothing is dead product surface (Rule 21) and fails the decacorn bar.

## Five-step (Musk algorithm)

- **Question requirements:** dropped live progress from this PR — no mobile read
  contract exists for it; a coach does not need it to *start* an import.
- **Delete:** no pairing-code polling loop, no fake progress states, no per-platform
  mapped tooling (product is site-agnostic; platforms are launch shortcuts only).
- **Simplify:** one screen, one canonical state model, reuse of the existing
  https-scheme guard pattern (`safeExternalEventUrl`), theme, telemetry, and nav.
- **Accelerate:** static flag-off tests + behavioral render tests mirror existing
  harnesses (romanFlagOff / communityEventsScreens).
- **Automate:** CI gates (typecheck, lint, jest, LOC, ratio) enforce the invariants.

## Idiot-index

One screen + one typed contract + one data catalog + one URL guard + a flag and a nav
row. No new service, no new dependency, no new native module. Reuses axios instance,
theme, analytics, and `Linking`.

## Extreme / hyperscaler

- **Extreme:** default OFF unconditionally (not `isDev`); kill switch hides the entry
  entirely and the screen mounts no network path.
- **Hyperscaler:** explicit UI states; https-only external open with private/loopback
  rejection; PII-free telemetry (platform slug + intent category only, never tokens or
  codes); one source of truth for import state; never report complete on partial/unknown.

## Good-without-bad

Coach autonomy to bring their data across — **without** broad permissions, server-side
credential scraping, or destructive methods. External login opens the coach's *own*
session in *their* browser; TGP never handles the competitor password.

## Evidence (verified backend contract, PR #504 frozen OpenAPI)

Verified against `growth-project-backend/docs/contracts/importer-openapi.json` and the
extension `DESIGN.md` v0.3:

- `POST /api/extension/pair/init` → `{ pairing_code, expires_at }` (mobile-callable,
  Bearer JWT, gated by `FEATURE_EXTENSION_PAIRING`).
- `POST /api/extension/pair/status` → `{ status: 'pending' | 'paired' | 'expired' }`.
- `POST /api/extension/pair/redeem` — **extension-only** (unauth code→token exchange).
- `POST /api/scout/ingest` · `POST /api/scout/progress` · `POST /api/scout/ingest/complete`
  — **extension-only** writers; terminal status `success | partial | failed`. Gated by
  `FEATURE_SCOUT_INGEST`.
- **No mobile-readable import progress/status endpoint exists.** → progress mirror
  deferred; typed boundary only.
- **No cancel endpoint exists.** → the mobile "cancel" is local-only (abandon the flow
  before it starts); no server cancel is faked.

## Rollback / stop

Flag OFF (`EXPO_PUBLIC_FF_EXTENSION_IMPORT` unset/false) removes the entry and route.
Full rollback = revert this PR. Stop conditions: any P0–P3 audit finding, or a contract
mismatch against the frozen OpenAPI slice.

## Next (named chained follow-up)

**PR-M2 — Live extension pairing + progress UX:** wire `pair/init` (code mint with
server-authoritative `expires_at` countdown), bounded/backoff/background-safe
`pair/status` polling to the `paired`/`expired` terminal, and — once a mobile-readable
progress contract lands — the learning/importing/partial/complete progress mirror. Uses
the typed contract frozen in this PR (`src/types/extensionImport.ts`).
