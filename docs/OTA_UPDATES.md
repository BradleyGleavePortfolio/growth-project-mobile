# Over-the-air updates (EAS Update)

Added for the clinic launch (C11). Lets JavaScript-only fixes reach installed
builds without a new App Store review.

## Configuration (app.json / eas.json)

| Setting | Value | Why |
|---|---|---|
| `expo-updates` | `~56.0.28` (SDK 56 pin from `npx expo install`) | native module, ships in the binary |
| `expo.runtimeVersion` | `{ "policy": "fingerprint" }` | see below |
| `expo.updates.url` | `https://u.expo.dev/a12c3345-cc8c-4c2c-9c57-711c10a57c1c` | this project's EAS projectId |
| `expo.updates.enabled` | `true` | OTA on (the validator fails on anything else) |
| `expo.updates.checkAutomatically` | `ON_LOAD` | check in the background on every cold start (the validator fails on any other mode) |
| `expo.updates.fallbackToCacheTimeout` | `0` | never block launch on the network; a downloaded update applies on the next launch |
| `eas.json build.production.channel` | `production` | store builds read the `production` channel |
| `eas.json build.clinic.channel` | `clinic` (environment `production`) | the clinic binary reads its own channel; it is built with clinic-only `EXPO_PUBLIC_FF_*` values, so it must never receive a `production` update |
| `eas.json build.preview.channel` | `preview` | internal builds read the `preview` channel |
| `development` profile | no channel | dev client loads from Metro |

### Launch never waits, offline never crashes

- `fallbackToCacheTimeout: 0`: the app always starts on the bundle it already has (embedded or a previously downloaded update). The update check runs natively in the background after launch.
- `checkAutomatically: ON_LOAD` with no JS update code: the app does not call `expo-updates` from JavaScript, so a failed or offline check has no JS code path that can throw. A failed download is discarded natively; the next cold start tries again.
- Anti-bricking and the embedded update stay on (`disableAntiBrickingMeasures` / `useEmbeddedUpdate: false` are rejected), so an update that crashes on launch rolls back to the embedded bundle (Expo error recovery, best-effort; see the device checks below).

`npm run validate:config` fails on any of these:
- `runtimeVersion` is anything other than `{ "policy": "fingerprint" }`, including a per-platform override.
- `disableAntiBrickingMeasures: true` or `useEmbeddedUpdate: false`.
- `fallbackToCacheTimeout` is not 0.
- A wrong updates URL or channel.
- `updates.enabled` is not `true`, or `checkAutomatically` is not `ON_LOAD` (audit C4).
- `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` is not `"true"` in the preview/production/clinic build profiles (after `extends`).
- The `preview`/`production`/`clinic` build profile is missing, its channel is wrong, or its `environment` is not `preview`/`production`/`production`.
- Two build profiles share a channel (each channel is one binary population).
- `fingerprint.config.js` is missing, fails to load, or no longer lists `src/config/purchaseSurfaces.ts` in `extraSources`.

Mutation tests: `scripts/__tests__/validateAppConfigUpdates.test.js`.

## Why `fingerprint` and not `appVersion`

The app keeps `version` at `1.0.0` and bumps only `ios.buildNumber` /
`android.versionCode` (`eas.json appVersionSource: local`). With the
`appVersion` policy every build would share runtime `1.0.0`, so a JS update
published after a native change (for example removing HealthKit, adding a
native module) would also be delivered to older binaries that lack that
native code and could crash them. The `fingerprint` policy hashes the native
inputs (dependencies with native code, config plugins, native config), so any
native change produces a new runtime and older binaries simply stop receiving
incompatible updates. It is the Expo-recommended default for CNG projects
(no committed `ios/`/`android/`, `prebuild` on EAS) like this one.

Trade-off: the fingerprint includes `eas.json` and the Expo config, so
publish an update from the same commit (or a commit with identical native
inputs) as the build you target. Check with:

```
npx expo-updates runtimeversion:resolve --platform ios
```

and compare with the runtime shown for the build on expo.dev.

### The purchase gate is a runtime input (`fingerprint.config.js`)

`fingerprint.config.js` adds `src/config/purchaseSurfaces.ts` to the
fingerprint. Any edit to the gate file therefore resolves to a **new runtime**:
- raising `IOS_P2P_ONLY_MIN_NATIVE_BUILD`
- changing the hide decision
- changing the host or URL-shape lists

Installed binaries only download updates for their own runtime, so a gate
change cannot reach users by OTA and has to ship in a new store build that goes
through App Review. **Accepted trade-off:** every gate-file edit needs a new
store build. Evidence: `node scripts/fingerprint-gate-check.js --platform ios`
(also `scripts/__tests__/purchaseGateFingerprint.test.js`, iOS and Android)
shows two in-memory gate edits each change the runtime while every other
fingerprint source is byte-identical:
- threshold 6 → 600
- always show

## One-time owner step

The Expo project owner (`the-growth-project` account) must enable EAS Update
for the project once (expo.dev → project → Updates, or `eas update:configure`
run by an account member). No code secret is required; the app only needs the
public updates URL already in `app.json`. Binaries built before this PR merges
do not contain `expo-updates` and never receive updates; the first binary built
from main after the merge is the first OTA-capable one (any profile).

## Publishing (operator)

OTA is for post-launch fixes only (owner). New features and anything that
touches native inputs ship in a store build.

Always publish through the guard:

```
npm run update:publish -- --channel clinic --environment production --message "<what changed>"       # clinic binary
npm run update:publish -- --channel production --environment production --message "<what changed>"   # store builds
npm run update:publish -- --channel preview --environment preview --message "<what changed>"          # internal builds
# add --dry-run to run every check without publishing
# add --rollout-percentage <1-100> for a staged rollout (for example 10)
```

The guard accepts only `--channel`, `--environment`, `--message`,
`--rollout-percentage`, `--dry-run` (and `--sourcemaps-only`, below). Any other
option is refused, not ignored. It runs
`eas update --channel <c> --environment <e> --message <m> --source-maps true --emit-metadata [--rollout-percentage <n>]`
only when all of these hold:
1. **Arguments.** Exactly one eas.json build profile uses the channel; `--environment` is given and equals that profile's `environment` (after `extends`; `clinic` → `production`; SDK 55+ requires it); `--message` is non-empty; `--rollout-percentage`, when given, is a whole number from 1 to 100.
2. **Purchase gate.** `src/config/purchaseSurfaces.ts` matches the reviewed hash in `scripts/purchase-policy.sha256`.
3. **Hide flag, remote.** The EAS project variable `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` in that environment is exactly `"true"`.
   - **Lookup:** `eas env:get <env> --variable-name EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES --format short --scope project --non-interactive`, with the flag stripped from the child's environment.
   - **Requirement:** exactly one `NAME=true` record. A missing variable (eas-cli prints "not found" and still exits 0), an empty, masked or duplicate value, or a failed lookup refuses.
   - **Why not `eas env:exec`:** it merges the parent shell env and skips absent remote values, so a locally exported `true` could pass as remote.
4. **Hide flag, local.** The local shell does not set the flag to anything other than `"true"`. The publish child runs without it, so the bundle takes the EAS value.
5. **The update ships the bundle the binary was built with.** `eas update --environment <e>` exports with `{ ...process.env, ...EAS plaintext and sensitive values }`; `secret` values are readable only on EAS builders and never reach an update. The guard reads `eas env:list <env> --format short --scope project|account --include-sensitive` and, for every name that reaches the bundle (each `EXPO_PUBLIC_*` and each `eas.json` profile env name), refuses when:
   - a record is `secret`, a file, masked or not revealed: the update could not carry the value the binary has (fix: make it `sensitive`, which an update can read);
   - the name is set more than once with different values (project vs account precedence is not documented, so the shipped value would be undefined);
   - the EAS value differs from the profile's `eas.json` value (for `clinic`: every clinic flag, the hide flag and `TGP_ANDROID_HEALTH_CONNECT=0`, which also keeps the runtime fingerprint equal to the build's).
   The publish child gets the profile env; every other local `EXPO_PUBLIC_*` is dropped.
6. **Release values.** The effective bundle values pass the same checks as the build (`scripts/check-expected-env.js` `valueProblem`, see `docs/RELEASE_ENV_CHECK.md`): every `kind: "required"` name plus the profile's `releaseProfiles` list is set, not a placeholder (`REPLACE_WITH_*`, `your_..._here`, a copied `*****` ...), and well formed (https URL on a real host, anon Supabase key, Sentry DSN, Stripe publishable key of the profile's mode). No secret-shaped `EXPO_PUBLIC_*` name is set.
7. **Sentry symbolication.** When the bundle reports to Sentry (a DSN is set; always on `clinic` and `production`), a usable `SENTRY_AUTH_TOKEN` must be available before anything is published: the local shell first, else a plaintext or sensitive EAS variable in that environment (a `secret` one cannot be read off EAS builders). app.json must name the Sentry organization and project (`@sentry/react-native/expo` plugin).

Every refusal line names the variable, its scope and the fix. No configured value is ever printed (only the reviewed `eas.json` value, which is the expected policy).

**After `eas update` succeeds** the guard checks that `dist/` holds iOS and Android source maps with Sentry Debug IDs written by this publish, and uploads them with `sentry-expo-upload-sourcemaps` (from `@sentry/react-native`; organization, project and URL from app.json; the token is passed to that child only). Then it prints the Sentry searches for the new update ids. If the upload fails, the update is already live: the guard exits non-zero and names the re-upload command:

```
npm run update:sourcemaps -- --channel <channel> --environment <environment>
```

It uploads the source maps of the update in `dist/` again (it requires `dist/eas-update-metadata.json` from a guarded publish) and publishes nothing.

Tests: `scripts/__tests__/easUpdateGuard.test.js` drives `main()` end to end with an injected runner. No refusal case reaches `eas update`; the upload runs only after a successful publish.

The guard refuses before publishing when a local `.env.sentry-build-plugin` exists in the project root: the upload script would load its token and project over the ones the guard checked (Opus C-305-10). Delete or rename it.

There is no supported unguarded path: a raw `eas update` would ship without the clinic profile env, without the release-value checks and without source maps in Sentry.

### Build env vs update env (purchase-critical)

`eas.json` `build.<profile>.env` applies to **builds only**. `eas update` exports the JS bundle with the variables of the **EAS environment** named by `--environment`, and does not use `eas.json` env. Every `EXPO_PUBLIC_*` value is inlined into that bundle again. The guard closes that gap by passing the profile env to the export (step 5); a raw `eas update` would not, and on the clinic channel it would ship with every clinic flag off. Before the first publish, provision these release-critical variables in EAS for **both** `preview` and `production`:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` | `true` |
| `EXPO_PUBLIC_API_URL` (and the other `EXPO_PUBLIC_*` in `.env.example`) | same values as the build, visibility `plaintext` or `sensitive` (never `secret`: an update cannot read it) |
| `SENTRY_AUTH_TOKEN` | a Sentry token with `project:releases` scope, visibility `sensitive` (or export it in the publishing shell) |

```
eas env:create --environment production --name EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES --value true --visibility plaintext
eas env:create --environment preview    --name EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES --value true --visibility plaintext
```

### Why an OTA cannot turn on non-P2P purchases (and the limits)

- **Runtime gate.** `nonP2PPurchasesHidden()` (`src/config/purchaseSurfaces.ts`) fails closed. It shows non-P2P purchases on iOS only when the bundle flag is explicitly `false` **and** the installed binary's `CFBundleVersion` (read natively via expo-application, not changeable by an update) is below 6. Build 6 is the first binary that has expo-updates, so every OTA-capable iOS binary stays hidden whatever the bundle says. `src/__tests__/iosNonP2PSurfacesMatrix.test.tsx` renders the real surfaces with an "OTA" bundle (flag false) on build 6 and 7 and asserts they stay hidden. Verified 1:1 packages and Android keep their flows.
- **Runtime immutability.** The gate file is a fingerprint input (above), so an OTA that edits the threshold or decision targets a runtime no installed binary has.
- **Governance.** The publish guard above, plus the pinned policy hash (CI also checks the lock through `easUpdateGuard.test.js`).
- **Server.** Every native request sends `X-Client-Platform`, `X-Client-Native-Build` and `X-Client-Purchase-Policy` (`p2p-only` on hidden iOS). Backend follow-up, not in this PR: reject AI credit-pack checkout, coach subscription/portal sessions and other non-P2P session creation for `X-Client-Platform: ios` requests.
- **Limit.** Anyone who can publish can still ship arbitrary JS that bypasses the gate from *another* file, for example by not calling it. That is a publisher-permission question. Restrict EAS publish rights to the owner.

### Update signing

Update code signing is **not** configured. Updates are authenticated by EAS account access only, so keep publish rights restricted. Signing would not fix the risk above either, because an authorised publisher can sign any bundle.

### Before the first production publish (device checks)

Hard gate before the first `clinic` or `production` publish. Record for each run the binary (build number and EAS build id), its runtime (`npx expo-updates runtimeversion:resolve --platform <p>` and the runtime on expo.dev), and the update group id.

1. The first OTA-capable build starts offline (embedded bundle), in airplane mode, twice.
2. A preview update is received on a later cold start, and a clinic update reaches only the clinic binary.
3. An update that fails early recovers to the embedded bundle, and Sentry shows the warning "OTA emergency launch" with `expo.updates.emergency:true`.
4. An operator rollback (`eas update:rollback`) reaches the device.

Expo error recovery is best-effort. None of these checks is covered by Jest or the config validator.

Only JavaScript/asset changes can ship this way. Native changes (new native
module, permissions, plugins, build numbers) need a new binary.

### Never mid-session, never on the first launch

- The app never checks for, downloads or applies an update from JavaScript. `npm run validate:config` fails if any runtime file imports `expo-updates`.
- A downloaded update applies on the next cold start only. The first launch after install always runs the embedded bundle (`fallbackToCacheTimeout: 0`), so onboarding is never interrupted by an update.
- `src/services/otaUpdateTags.ts` reads the running update's identity (no import of `expo-updates`) for Sentry.

### Watching an update in Sentry

An update keeps the binary's Sentry release (`<version>+<build>`), so search by update instead. Every event carries:

| Tag | Meaning |
|---|---|
| `expo.updates.update_id` | the running update (the iOS or Android update id that `eas update` prints, lowercase) |
| `expo.updates.channel` | `clinic`, `production` or `preview` |
| `expo.updates.runtime_version` | the binary's fingerprint runtime |
| `expo.updates.embedded` | `true` while the bundle inside the binary runs |
| `expo.updates.emergency` | `true` when expo-updates fell back to the embedded bundle because an update failed |

Every event (and, through scope sync, every native crash report) also carries the `ota_updates` context with the same field names the Sentry SDK uses: `is_enabled`, `is_embedded_launch`, `is_emergency_launch`, `is_using_embedded_assets`, `update_id`, `channel`, `runtime_version`, `check_automatically`, `launch_duration` and `emergency_reason_category`. The emergency warning adds one context value, `ota_emergency.reason_category`. Both reason fields are one of `not_reported`, `launch_failed`, `asset_or_bundle`, `database`, `timeout` or `unknown`.

The native reason text itself never leaves the phone (it can hold anything), and an update id, channel, runtime or check mode that does not have the expected shape is dropped or reported as `other` (Sol B-305-10). The Sentry SDK's own `ExpoContext` integration would copy that text verbatim into `ota_updates.emergency_launch_reason` on every event and into the native crash scope, so `initSentry` removes it (B-305-12) and the app sets the bounded context itself (`src/services/otaUpdateTags.ts`). As a second line, the content policy (`src/services/sentryPrivacy.ts`) reduces any `ota_updates` or `ota_emergency` context on a JS event to the allowlist above. `src/services/__tests__/otaUpdateTags.canary.test.ts` runs the real SDK with synthetic personal data in the native constants and checks every envelope and every native call; after an SDK upgrade, it fails if the integration is renamed or a new one reads the same module.

The names match what newer `@sentry/react-native` versions set, so the searches keep working after an SDK upgrade. Source maps uploaded for an update have no release in Sentry; Debug IDs match them to events.

### Who may publish (C-305-3)

Update code signing is not configured, so EAS publish rights are the only authorization. Keep them with the owner: on expo.dev → account → Members, no one else should hold the Owner, Admin or Developer role (each can publish updates). Check that list before the first publish.

## Release procedure (operator-run)

1. Merge the JS fix to `main` (green required checks, audit). Check out that exact commit, clean tree.
2. Confirm the runtime matches the installed binary: `npx expo-updates runtimeversion:resolve --platform ios` (and `android`) equals the runtime shown for the target build on expo.dev. If not, the change touched native inputs: ship a new binary instead.
3. `npm run update:publish -- --channel <clinic|production|preview> --environment <its environment> --message "<what changed>" --dry-run`, then the same without `--dry-run`.
4. Publish to `preview` first and check it on a preview build; then the target channel. For a risky change add `--rollout-percentage 10` (through the guard, never the raw command), then raise it with `eas update:edit` once Sentry stays quiet.
5. Watch Sentry with `expo.updates.update_id:<id>` (the guard prints the searches) and `expo.updates.emergency:true`. Roll back with `eas update:rollback`, or republish the previous commit through the guard.
