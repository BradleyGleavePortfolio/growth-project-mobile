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
- **URLs** (`API_URL`, `SUPABASE_URL`, `HELP_BASE_URL`) must be `https` on a real host. Rejected: localhost, emulator or private IPs, `example.*`, `*.invalid` / `*.test` / `*.local`.
- **Supabase anon key** must be a JWT whose role is `anon`, or an `sb_publishable_` key. A `service_role` JWT or an `sb_secret_` key fails: either one bypasses row-level security.
- **Sentry DSN** must look like `https://<key>@<host>/<project-id>`. Without one, crash and unknown-error reports never arrive.
- **Stripe key** must be a publishable key of the profile's mode (`pk_live_` for `stripe: "live"`).

Two checks also run on every release build:
- **Build parity.** Every `eas.json` `build.<profile>.env` value, after `extends`, must reach the build unchanged. For `clinic` that means all the clinic `EXPO_PUBLIC_FF_*` flags, the iOS purchase hide flag and `TGP_ANDROID_HEALTH_CONNECT`.
- **No secret-shaped names.** No `EXPO_PUBLIC_*` name shaped like a secret (`SECRET`, `PASSWORD`, `SERVICE_ROLE`, `PRIVATE_KEY`, `WEBHOOK`, `_SK`) may be set.

Every failure line names the variable, says what is wrong, and gives the `eas env:create` / `eas env:update` fix.
Tests: `scripts/__tests__/releaseEnvProfile.test.js` (and `expectedEnv.test.js` for the base checks).
