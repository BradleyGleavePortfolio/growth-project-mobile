# Pre-build release-env check

`scripts/check-expected-env.js` fails a release build before anything is installed or compiled when a value the
binary needs is missing, a placeholder, or the wrong kind of key. It never prints a value.

## When it runs

- **On every EAS build**, as the `eas-build-pre-install` npm hook (`node scripts/check-expected-env.js --eas-hook`).
  It reads `EAS_BUILD_PROFILE`:
  - A release profile (`clinic`, `production`, `preview`): runs the checks below; any problem fails the build.
  - Any other profile (`development`): skipped.
  - No profile name: fails (closed).
  - The hook runs before `npm install`, so it skips the TypeScript source scan. CI runs that scan on every PR.
- **Locally, before starting a build** (operator), with the EAS environment loaded:
  `eas env:exec production 'npm run check:release-env -- --profile clinic'`
- **To list what a profile checks:** `node scripts/check-expected-env.js --list --profile clinic`

## What it checks (profiles and lists live in `config/expected-env.json` `releaseProfiles`)

| Profile | Values that must be set and real | Stripe key |
|---|---|---|
| `clinic` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SENTRY_DSN` | `pk_live_` |
| `production` | same five | `pk_live_` |
| `preview` | the four `kind: "required"` names (no Sentry requirement) | `pk_live_` or `pk_test_` |

For each of those values:
- **Not a placeholder.** Rejected: empty values, `your_..._here`, `REPLACE_WITH_*`, `<...>`, `${...}`, `changeme` / `todo` / `xxx`, a copied masked `*****`.
- **URLs** (`API_URL`, `SUPABASE_URL`, `HELP_BASE_URL`) must be `https` on a real host. Rejected: localhost; loopback, private (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10), link-local (169.254/16) and 0/8 IPv4, including decimal or hex forms; IPv6 loopback, unspecified, ULA (`fc00::/7`), link-local (`fe80::/10`) and IPv4-mapped; `example.*`; `*.invalid` / `*.test` / `*.local` / `*.localhost` / `*.internal` / `*.lan` / `*.home.arpa`; single-label names.
- **Supabase anon key** must be a complete key:
  - a JWT with three non-empty base64url parts, a signed header (`alg` set, not `none`), role `anon`, a full-length signature (at least 32 bytes) and an `exp` that has not passed; or
  - an `sb_publishable_` key followed by at least 20 letters, digits, `_` or `-`.
  - A `service_role` JWT or an `sb_secret_` key fails: either one bypasses row-level security.
- **Sentry DSN** must look like `https://<key>@<host>/<project-id>`. Without one, crash and unknown-error reports never arrive.
- **Stripe key** must be a complete publishable key (`pk_live_` or `pk_test_` followed by 24 to 247 letters and digits) of the profile's mode (`pk_live_` for `stripe: "live"`). A bare prefix or a run of one repeated character fails.

These are shape checks only. They do not call Stripe, Supabase or Sentry, so they cannot prove a key is active.

Two checks also run on every release build:
- **Build parity.** Every `eas.json` `build.<profile>.env` value, after `extends`, must reach the build unchanged. For `clinic` that means all the clinic `EXPO_PUBLIC_FF_*` flags, the iOS purchase hide flag and `TGP_ANDROID_HEALTH_CONNECT`.
- **No secret-shaped names.** No `EXPO_PUBLIC_*` name shaped like a secret (`SECRET`, `PASSWORD`, `SERVICE_ROLE`, `PRIVATE_KEY`, `WEBHOOK`, `_SK`) may be set.

Every failure line names the variable, says what is wrong, and gives the `eas env:create` / `eas env:update` fix.
The text is fixed: no part of a value (not even a URL scheme) is ever printed, so the line is safe in EAS build logs.
Tests: `scripts/__tests__/releaseEnvProfile.test.js` (and `expectedEnv.test.js` for the base checks).
