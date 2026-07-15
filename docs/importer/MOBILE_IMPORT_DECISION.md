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
- **Automate:** the single CI job `Typecheck, lint, test` (`tsc --noEmit` + ESLint +
  the **full** jest suite) enforces correctness. The net-prod-LOC cap and test:src
  ratio are **review-time gates** measured against baseline `main` — they are not
  separate CI checks, so they are asserted here with reproducible counts, not implied
  by a green pipeline.

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
- `POST /api/extension/pair/status` → `{ status }`. The backend **constrains** this
  field to a **closed enum** `pending | paired | expired` (OpenAPI `enum`, plus the DTO
  `PAIR_STATUSES` union). Mobile still keeps the raw string on the wire and decodes it via
  `decodePairStatus` rather than blind-casting — any value it does not recognise resolves
  to `'unknown'`, never to `paired`.
- `POST /api/extension/pair/redeem` — **extension-only** (unauth code→token exchange).
- `POST /api/scout/ingest` · `POST /api/scout/progress` · `POST /api/scout/ingest/complete`
  — **extension-only** writers; terminal `status` is likewise a **closed enum**
  `success | partial | failed` (OpenAPI `enum`, DTO `SCOUT_TERMINAL_STATUSES` +
  `@IsIn`), decoded via `decodeTerminalStatus` (unknown → `'unknown'`, never
  `success`/`complete`). Gated by `FEATURE_SCOUT_INGEST`.
- **No mobile-readable import progress/status endpoint exists.** → progress mirror
  deferred; typed boundary only.

Although the backend constrains both fields to a closed enum, mobile still does **not**
blind-cast an arbitrary server string into the union — it decodes defensively. This is
**forward-compatible version-skew defense**, not a claim that the contract is open: if a
future contract version, a renamed member, or a garbled/malformed response arrives, the
decoder yields `'unknown'` (a truthful non-terminal reading) instead of asserting an
unverified member. The decoders are that structural seam.
- **No cancel endpoint exists.** → the mobile "cancel" is local-only: it stops polling
  and discards any in-flight mint/poll result (it does not abort the HTTP request); no
  server cancel is faked.

## Gates (verified on the pushed head)

Verified by running the **entire** CI-equivalent locally, not a hand-picked subset:

- `tsc --noEmit`: clean.
- ESLint: 0 errors, 0 warnings on the import-flow files (no `eslint-disable`, no
  `as any`, no `require()` — the api test mocks via `import` + `jest.mocked`).
- **Full** jest suite (`npm test`, all suites): green — 295 suites / 3563 tests
  (the +3 vs the original 3560 are the single-flight poll-guard tests added at head
  `35cdc45`; the CI `Typecheck, lint, test` check is green at that head).
  An earlier revision was reported green from a *targeted* run and was in fact
  **RED** on the repo-wide Quiet-Luxury doctrine scan (`ImportDataScreen` title
  used `fontWeight: '700'`). That narrow-suite "green" claim is **retracted**; the
  title weight is `'600'` and the full suite is the standard of truth.
- Net-prod-LOC (added non-blank/non-comment lines vs `main`), reproducible per file:
  events 6 + extensionPairApi 9 + ExtensionPairingPanel 140 + useExtensionPairing 188
  + ImportDataScreen 6 = **349 (≤ 400, no exception requested)**. The client-clock
  expiry/countdown deletion (round-cause fix) created this headroom; the single-flight
  poll guard added at head `35cdc45` accounts for the +6 on `useExtensionPairing`.
- test:src ratio: 968 test LOC / 349 prod LOC = **2.77 (≥ 2.0)** (review-time).

## Rollback / stop

Flag OFF (`EXPO_PUBLIC_FF_EXTENSION_IMPORT` unset/false) removes the entry and route.
Full rollback = revert this PR. Stop conditions: any P0–P3 audit finding, or a contract
mismatch against the frozen OpenAPI slice.

## Next (named chained follow-up)

**PR-M2 — Live extension pairing + progress UX:** wire `pair/init` (code mint),
bounded/backoff/background-safe `pair/status` polling to the server-authoritative
`paired`/`expired` terminal (no client clock, no local countdown), and — once a mobile-readable
progress contract lands — the learning/importing/partial/complete progress mirror. Uses
the typed contract frozen in this PR (`src/types/extensionImport.ts`).

---

## PR-M2 addendum — Live pairing wired (2026-07-14)

**Shipped in PR-M2** (built on the M1 boundary, flag still default-OFF):

- `src/api/extensionPairApi.ts` — thin typed transport for the ONLY two
  mobile-callable endpoints, `POST /extension/pair/init` and
  `POST /extension/pair/status` (paths relative to the `/api`-suffixed baseURL).
- `src/hooks/useExtensionPairing.ts` — the mint→poll state machine:
  **server-authoritative expiry** (the ONLY expiry signal is the `pair/status`
  terminal returning `expired`; the client never reads its own clock — no
  `Date.now`/`Date.parse`, no local countdown, no local expiry timer, per
  Rule 16), bounded exponential backoff (2s→15s, ×1.5), AppState pause/resume,
  transient-error tolerance (≤5 consecutive) before a retryable `failed`,
  single-flight mint (no duplicate intents), and full timer teardown on
  unmount. Unknown/garbled `status` fails closed (treated as a non-terminal
  wait, never promoted to `paired`). 401/403 → `authExpired`; 404 →
  `unavailable`; no token/code is logged, stored, or emitted in telemetry.
  `cancel()` is a LOCAL abandon — it stops polling and discards any in-flight
  mint/poll result; it never aborts the HTTP request or fakes a server cancel.
- `src/components/coach/ExtensionPairingPanel.tsx` — renders the honest
  lifecycle (minting → `waiting` showing the code with an honest "enter it
  soon" prompt — no client-clock countdown → `paired`, plus
  expired/failed/authExpired/unavailable/cancelled), mounted inside the M1
  `awaitingExtension` state.

**Verified contract mapping** (against `growth-project-backend`
`docs/contracts/importer-openapi.json`, fetched live this session):

| Brief-named endpoint (does NOT exist) | Real endpoint used | Note |
|---|---|---|
| `POST /auth/extension/pair` | `POST /api/extension/pair/init` | mint `{pairing_code, expires_at}` |
| `GET /auth/extension/pair/status` | `POST /api/extension/pair/status` | body-only (never query); `{status: pending\|paired\|expired}` |
| `POST /api/scout/ingest/init` | — | no such route; `scout/*` are extension-only POST writers |
| `GET /api/scout/ingest/:intentId/status` | — | **no mobile-readable progress route exists** |

**Still blocked (documented, not invented):** there is no mobile-readable import
progress/`:intentId/status` route and no `scout/ingest/init` intent-creation link
callable by mobile. The autonomous crawl runs entirely inside the extension after
`paired`. So the mobile terminal is honestly `paired` ("running in the browser
extension"); importing/partial/complete and any page/entity count are NOT
rendered. Cancel is a LOCAL abandon (no server cancel endpoint exists).

**Backend/extension follow-up required to close the progress mirror:** expose a
mobile-readable, coach-scoped progress read (e.g. `GET /api/scout/ingest/:intentId/status`
returning the extension-reported terminal `success|partial|failed` + coarse
progress) plus the intent-id linkage from a paired code, all behind
`FEATURE_SCOUT_INGEST`. Only then can the mobile importing/partial/complete states
be wired truthfully.
