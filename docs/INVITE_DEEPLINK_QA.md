# Invite + deep-link QA

This document is the canonical QA checklist for the invite-gated onboarding
surface: email signup with code, Google sign-in code attach, QR / shared-link
opens, malformed and revoked codes, and Universal-Link / App-Link verification
for `app.trygrowthproject.com`.

It complements — does not duplicate — `docs/RELEASE_SMOKE.md`. Release smoke
covers the *whole* APK before promoting; this document is the deep-dive QA
matrix for the invite path specifically. Run it any time:

- The backend `/api/auth/*` or `/api/invite/*` routes change
- `app.json` invite-related entries change (`scheme`, `intentFilters`,
  `associatedDomains`)
- `RootNavigator.tsx` linking config changes
- The marketing site (`app.trygrowthproject.com`) is migrated, re-signed, or
  put behind a new CDN — both `assetlinks.json` and the AASA file must be
  re-verified after any infra change
- The Android Play App Signing key is rotated (rare; would require an
  `assetlinks.json` update)

## Production hosts

| Surface | Host |
| --- | --- |
| Backend API | `https://api.trygrowthproject.com/api` |
| Marketing site / universal link host | `https://app.trygrowthproject.com` |
| Android assetlinks | `https://app.trygrowthproject.com/.well-known/assetlinks.json` |
| iOS AASA | `https://app.trygrowthproject.com/.well-known/apple-app-site-association` |
| Google verifier | `https://digitalassetlinks.googleapis.com/v1/statements:list` |
| Apple AASA-CDN | `https://app-site-association.cdn-apple.com/a/v1/app.trygrowthproject.com` |

Staging hosts use the same shape with a `.staging.` segment; pass them via
`API_HOST=` / `APP_HOST=` to the QA script. **Never** point QA scripts at a
fake or example domain — invite previews leak nothing PII, but App Links and
AASA are pinned to the real host and will silently fail otherwise.

## Quickstart

```bash
# Hits the real prod backend + marketing site. No device required.
bash scripts/invite-qa.sh

# With sandbox codes that exercise the rejection paths (recommended):
bash scripts/invite-qa.sh \
  --code SMOKE01 \
  --revoked OLDCODE01 \
  --paused PAUSED01 \
  --expired EXPIRED01

# Same script against staging:
API_HOST=api.staging.trygrowthproject.com \
APP_HOST=app.staging.trygrowthproject.com \
  bash scripts/invite-qa.sh
```

The script exits non-zero on the first hard failure; "warn:" lines (e.g. AASA
not yet cached by Apple's CDN) are expected when a release is still rolling
out and do not fail the run.

## Test matrix

The matrix below is the contract every change to the invite path must
preserve. Items marked **automated** are exercised by `scripts/invite-qa.sh`
and the Jest suite; items marked **manual** still need a human eye on a real
device.

### A. Email signup — invite code required

| # | Scenario | Expected outcome | How |
| --- | --- | --- | --- |
| A1 | Policy fetch returns `require_invite_code=true` | Form shows "INVITE CODE" (not "OPTIONAL") | automated (`inviteFlow.test.ts` + `invite-qa.sh`) |
| A2 | Submit with no code | Client-side error: "An invite code from your coach is required to join." | manual — `CreateAccountScreen` enforces |
| A3 | Submit with valid code | `POST /auth/signup-with-code` succeeds, navigates to verify step | manual — backend creates user with `coach_id` populated |
| A4 | Submit with invalid code | Inline error from server `reason` text | automated (preview/validate) + manual UX |
| A5 | Submit with revoked code | Inline error reflecting revocation | automated (`--revoked` flag) |
| A6 | Submit with paused code | Inline error reflecting pause | automated (`--paused` flag) |
| A7 | Submit with expired code | Inline error reflecting expiry | automated (`--expired` flag) |
| A8 | Code with leading/trailing spaces (paste artifact) | Trimmed before send | unit-tested via `parseInviteDeepLink` whitespace cases |
| A9 | Code containing `%`-escapes (QR artifact) | Decoded once, sent as the original alpha code | unit-tested in `deepLink.test.ts` |

### B. Google sign-in — code attach

| # | Scenario | Expected outcome | How |
| --- | --- | --- | --- |
| B1 | Google sign-in *without* code | `POST /auth/google` body is `{ token }` only | automated (`inviteFlow.test.ts`) |
| B2 | Google sign-in *with* code (typed in form) | `POST /auth/google` body is `{ token, invite_code }` | automated |
| B3 | Backend ignores `invite_code` on `/auth/google` (legacy server) | Mobile falls back to `POST /auth/attach-invite-code` | automated (covered by `googleAuth.ts` defensive branch + tests) |
| B4 | New Google user is associated with the inviting coach | Verify in Supabase dashboard `users.coach_id` | manual on staging |
| B5 | Existing Google user re-attaches a new code | `coach_id` updated, no duplicate user | manual on staging |
| B6 | Google sign-in cancelled mid-OAuth | Friendly error, no token persisted | manual |

### C. Deep links — custom scheme `tgp://`

| # | Scenario | Expected outcome | How |
| --- | --- | --- | --- |
| C1 | `tgp://join/SMOKE01` opens the app to CreateAccount with code prefilled | `parseInviteDeepLink` returns `{inviteCode:"SMOKE01"}`; navigator routes to CreateAccount | automated (`deepLink.test.ts`) + manual via `adb shell am start ...` |
| C2 | `tgp://join` (no code) opens CreateAccount with code field empty | `inviteCode: null`, navigator opens form for manual entry | automated |
| C3 | `tgp://join/CODE?ref=qr` strips the query, code parsed cleanly | `inviteCode: "CODE"` | automated |
| C4 | `tgp://join/%41%42%43` decoded to `ABC` | percent-decoding happens in parser | automated |
| C5 | `tgp://join/%ZZ123` — malformed escape — does not crash | parser returns the raw segment, backend rejects | automated |
| C6 | App not installed: tap `tgp://...` from a browser | Browser shows "no app to handle this" — expected; users on platforms without the app should use the universal link instead | manual |

### D. Deep links — universal link `https://app.trygrowthproject.com`

| # | Scenario | Expected outcome | How |
| --- | --- | --- | --- |
| D1 | `assetlinks.json` hosted at `/.well-known/...` | HTTP 200, JSON array, contains `com.growthproject.app`, real SHA-256 (no `REPLACE_WITH_*` placeholder) | automated |
| D2 | `assetlinks.json` served with no redirect | Direct HTTP 200, `Content-Type: application/json` | automated (`invite-qa.sh` flags 3xx as a hard fail — Android does not follow redirects for verification) |
| D3 | Google Digital Asset Links verifier returns statements | `https://digitalassetlinks.googleapis.com/...` returns ≥ 1 statement for our host | automated (warn-only — Google's cache lags real publishes by ~minutes) |
| D4 | `apple-app-site-association` hosted, no extension, no redirect | HTTP 200, JSON, `appIDs` end in `.com.growthproject.app` (Team ID prefix populated) | automated |
| D5 | Apple AASA-CDN warmed up | `https://app-site-association.cdn-apple.com/a/v1/<host>` returns 200 | automated (warn-only — Apple's CDN refreshes hourly after first publish) |
| D6 | `https://app.trygrowthproject.com/join/SMOKE01` opens app silently when installed | No browser flash, no chooser, app launches to CreateAccount with code prefilled | manual on real device + automated `pm get-app-links com.growthproject.app` shows `verified` |
| D7 | `https://app.trygrowthproject.com/join` (no code) opens app, manual-entry form | code field empty, signup policy still applies | manual |
| D8 | Same URL when app is *not* installed | Marketing-site smart banner offers App Store / Play Store install + preserves the code through the install referrer | manual — Web team owns this |
| D9 | URL tapped from Gmail / Messages / WhatsApp | Same outcome as D6 (chooser dialog regression is the most common App Links bug) | manual |
| D10 | URL with trailing slash `/join/SMOKE01/` | Same outcome as D6 | automated parser test |
| D11 | URL with utm parameters `/join/SMOKE01?utm_source=email` | Same outcome, query stripped before navigation | automated parser test |

### E. Marketing-site QR codes

| # | Scenario | Expected outcome | How |
| --- | --- | --- | --- |
| E1 | Coach generates an invite, taps "Share" — message contains a tappable URL | Currently: bare code text. **Recommendation**: include the universal link `https://app.trygrowthproject.com/join/<code>` so the tap on the receiving end skips the chooser. The helper `buildInviteUniversalLink(code)` from `src/utils/deepLink.ts` is wired to the same constants the navigator uses, so the share text and the verified domain stay in sync by construction. | manual |
| E2 | QR code printed in marketing material encodes the universal link | Tap on phone camera opens the app silently when installed; opens marketing site smart banner when not | manual + scan with QR app pointed at staging |
| E3 | QR code encoded with percent-escaped code | `parseInviteDeepLink` decodes once and sends the canonical code | automated (`deepLink.test.ts`) |

### F. Negative / abuse paths

| # | Scenario | Expected outcome | How |
| --- | --- | --- | --- |
| F1 | URL with foreign host `https://attacker.example/join/X` | Parser rejects, navigator does not route | automated |
| F2 | URL with extra path segments `https://app.trygrowthproject.com/join/CODE/extra` | Parser rejects | automated |
| F3 | Empty preview response from backend | UI shows "Could not verify…" — no crash, no false-positive `valid:true` | UX manual + unit test for `valid` boolean shape |
| F4 | Network error mid-validate | UI shows "Could not verify the invite code. Check your connection." | manual — `CreateAccountScreen.handleRegister` error branch |
| F5 | Backend returns HTTP 5xx for `/auth/signup-policy` | UI falls back to **strict** policy (`require_invite_code: true`) — never silently allow a codeless signup on a backend hiccup | code-reviewed in `CreateAccountScreen` (`catch` branch sets `setRequireInviteCode(true)`); not unit-tested directly, would require a screen-level integration test |

## How the pieces connect

```
                         ┌─────────────────────────────┐
                         │    coach generates code     │
                         │  POST /coach/invite-codes   │
                         └──────────────┬──────────────┘
                                        │
                                        ▼
            ┌──────────────────── share / QR ─────────────────────┐
            │ tgp://join/<code>          (in-app, ADB)            │
            │ https://app.trygrowthproject.com/join/<code>        │
            └──────────────────────┬──────────────────────────────┘
                                   │
              ┌────────────────────┴───────────────────┐
              │                                        │
   ┌──────────▼──────────┐               ┌─────────────▼───────────┐
   │ App Links / Univ.   │               │ Custom-scheme intent    │
   │ verified via:       │               │ filter — always works   │
   │  • assetlinks.json  │               │ once app is installed   │
   │  • AASA file        │               │                         │
   └──────────┬──────────┘               └─────────────┬───────────┘
              │                                        │
              └────────────────────┬───────────────────┘
                                   │
                                   ▼
                ┌──────────────────────────────────┐
                │  RootNavigator linking config    │
                │  parseInviteDeepLink (unit-test) │
                └──────────────────┬───────────────┘
                                   │
                                   ▼
                ┌──────────────────────────────────┐
                │   CreateAccountScreen, code      │
                │   prefilled, preview fetched     │
                │   GET /api/invite/<c>/preview    │
                │   POST /api/auth/validate-...    │
                └──────────────────┬───────────────┘
                                   │
                ┌──────────────────┴────────────────┐
                ▼                                   ▼
   ┌────────────────────────┐           ┌─────────────────────────┐
   │  email + password →    │           │  Google → /auth/google  │
   │  /auth/signup-with-code│           │  with invite_code, OR   │
   │  (atomic coach attach) │           │  fallback /auth/attach- │
   │                        │           │  invite-code            │
   └────────────────────────┘           └─────────────────────────┘
```

## When something fails

| Symptom | Most likely cause |
| --- | --- |
| Tapping `https://app.trygrowthproject.com/join/X` opens Chrome chooser | `assetlinks.json` not hosted, returning a 3xx redirect, or the `sha256_cert_fingerprints` value does not match the **Play App Signing** key (still has the upload-key SHA from before Play takeover) |
| iOS taps open Safari instead of the app | AASA not hosted, `apple-app-site-association` has the wrong file extension, Apple Team ID still says `REPLACE_WITH_APPLE_TEAM_ID`, or the AASA-CDN has not refreshed yet (wait ≤ 1 hour after first publish) |
| `tgp://join/X` works but `https://...` does not | Custom scheme filter is independent of App Links — the universal-link verification step has not completed. Run `adb shell pm verify-app-links --re-verify com.growthproject.app` and re-check `pm get-app-links` |
| Code prefilled but signup says "invite code is not valid" | Code was created in a different environment (staging vs prod), or the code is paused / revoked / past `expires_at`. Check Supabase `invite_codes` row directly. |
| Signup succeeds but `coach_id` is null on the new user | Backend received the request via `/auth/register` (codeless path) instead of `/auth/signup-with-code`. Mobile only routes to `/signup-with-code` when a code is present and validates as `valid:true`. Inspect the network log on the failing device. |
| Google sign-in works but no coach attached | `/auth/google` did not accept `invite_code` (older backend). Confirm the fallback `/auth/attach-invite-code` was called — see `src/utils/googleAuth.ts:138` |

## Known divergences — surfaced by `scripts/invite-qa.sh` against prod

These are real findings from running the QA script against the live production
backend on **2026-04-27**. They are tracked here so the next person running QA
sees them before opening a "this is broken" issue.

### `/auth/signup-policy` shape mismatch

- **Backend returns:** `{ "coach_code_required": false, "providers": ["email","google"], "invite_code_field": "invite_code" }`
- **Mobile expects** (`src/services/api.ts:200`): `{ require_invite_code: boolean, google_signin_enabled: boolean }`
- **Effect:** the mobile client's `getSignupPolicy()` resolves with a payload
  that has neither key, so `CreateAccountScreen` falls into its `catch` branch
  and applies the strictest defaults: `requireInviteCode = true`,
  `googleEnabled = true`. **Functionally the form still works**, but the
  backend's intended `coach_code_required: false` (codeless signup allowed) is
  silently overridden on the device. The fix lives on the backend (or in a
  mobile-side mapper if the backend shape is intentional).
- **Test coverage:** `inviteFlow.test.ts > signup policy` exercises the
  *expected* mobile shape; the live backend deviates from it. Once the
  backend or the mapper lands, this divergence section can be removed.

### `/auth/validate-invite-code` enforces a 32-character cap

- **Backend behaviour:** a code longer than 32 chars returns HTTP 400
  `{ statusCode:400, message:["code must be shorter than or equal to 32 characters"] }`
  rather than the documented `{ valid: false, reason }` envelope.
- **Effect:** the mobile UI never hits this path organically (codes are
  generated server-side and cap at 12 chars). The QA script accepts both 200
  + `valid:false` and 4xx as legitimate "rejected" outcomes for invalid
  inputs, so the test still passes. Documented here so future QA runs that
  use very long synthetic codes understand the response.

## What this QA does NOT cover

- **Real user creation.** The script exercises preview / validate / asset
  hosting, but never POSTs to `/auth/signup-with-code` with a real email — that
  would pollute the production DB and trigger real verification emails. Manual
  end-to-end signup against staging is still required before a release.
- **Push-receive after signup.** Owned by `docs/RELEASE_SMOKE.md` items 25–27.
- **Coach-side invite code lifecycle (create / list / revoke).** Covered by
  the existing `apiClients.test.ts` suite for the wire contract; UX for the
  coach screen is manual.
- **Marketing-site smart banner UX when the app is not installed.** Owned by
  the web team. The QA script does check that `/join/<code>` returns 200, but
  whether the resulting page actually proxies the user through the App Store
  install referrer is out of scope for the mobile repo.
