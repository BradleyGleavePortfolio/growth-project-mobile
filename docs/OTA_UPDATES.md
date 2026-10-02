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

Always publish through the guard:

```
npm run update:publish -- --channel clinic --environment production --message "<what changed>"       # clinic binary
npm run update:publish -- --channel production --environment production --message "<what changed>"   # store builds
npm run update:publish -- --channel preview --environment preview --message "<what changed>"          # internal builds
# add --dry-run to run every check without publishing
```

The guard (`scripts/eas-update-guard.js`) runs
`eas update --channel <c> --environment <e> --message <m>` only when all of these hold:
1. Exactly one eas.json build profile uses the channel, and `--environment` is given and equals that profile's `environment` (after `extends`; `clinic` → `production`). SDK 55+ requires it.
2. `src/config/purchaseSurfaces.ts` matches the reviewed hash in `scripts/purchase-policy.sha256`.
3. The **remote** EAS project variable `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` in that environment is exactly `"true"`.
   - **Lookup:** `eas env:get <env> --variable-name EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES --format short --scope project --non-interactive`, with the flag stripped from the child's environment.
   - **Requirement:** the output must contain exactly one `NAME=true` record.
   - **Refusals (fail closed):** a missing variable (eas-cli prints "not found" and still exits 0), an empty, masked (sensitive/secret) or duplicate value, or a failed lookup.
   - **Why not `eas env:exec`:** it merges the parent shell env and skips absent remote values, so a locally exported `true` could pass as remote. The guard therefore never trusts the local shell.
4. The local shell does not set the flag to anything other than `"true"`. The publish child also runs without the local flag, so the bundle takes the EAS environment's value.
5. **Build parity.** The publish child gets the target profile's resolved `eas.json` env (for `clinic`: the production values plus every clinic flag, and `TGP_ANDROID_HEALTH_CONNECT=0`, which also keeps the Expo config and so the runtime fingerprint equal to the build's). Every other `EXPO_PUBLIC_*` in the local shell is dropped. eas-cli exports with `{ ...process.env, ...EAS environment }`, so an EAS variable wins over the shell: the guard reads `eas env:list <env> --format short` for the project and the account scope and refuses when any of those names exists there with a different, masked or duplicated value.
6. Every `kind: "required"` name in `config/expected-env.json` is present in the EAS environment or the profile env.

Tests: `scripts/__tests__/easUpdateGuard.test.js` drives `main()` end to end with an injected runner. No refusal case reaches `eas update`.

The unguarded equivalent, for reference only, is
`eas update --channel production --environment production --message "<what changed>"`.

### Build env vs update env (purchase-critical)

`eas.json` `build.<profile>.env` applies to **builds only**. `eas update` exports the JS bundle with the variables of the **EAS environment** named by `--environment`, and does not use `eas.json` env. Every `EXPO_PUBLIC_*` value is inlined into that bundle again. The guard closes that gap by passing the profile env to the export (step 5); a raw `eas update` would not, and on the clinic channel it would ship with every clinic flag off. Before the first publish, provision these release-critical variables in EAS for **both** `preview` and `production`:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` | `true` |
| `EXPO_PUBLIC_API_URL` (and the other `EXPO_PUBLIC_*` in `.env.example`) | same values as the build |

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

1. The first OTA-capable build starts offline (embedded bundle), in airplane mode, twice.
2. A preview update is received on a later launch (and a clinic update reaches only the clinic binary).
3. An update that fails early recovers to the embedded bundle.
4. An operator rollback (`eas update:rollback`) reaches the device.

Expo error recovery is best-effort. None of these checks is covered by Jest or the config validator.

Only JavaScript/asset changes can ship this way. Native changes (new native
module, permissions, plugins, build numbers) need a new binary.

## Release procedure (operator-run)

1. Merge the JS fix to `main` (green required checks, audit). Check out that exact commit, clean tree.
2. Confirm the runtime matches the installed binary: `npx expo-updates runtimeversion:resolve --platform ios` (and `android`) equals the runtime shown for the target build on expo.dev. If not, the change touched native inputs: ship a new binary instead.
3. `npm run update:publish -- --channel <clinic|production|preview> --environment <its environment> --message "<what changed>" --dry-run`, then the same without `--dry-run`.
4. Publish to `preview` first and install it on a preview build; then the target channel. For a risky change use `--rollout-percentage` with the raw command only after the dry run passed.
5. Watch Sentry for the new release; roll back with `eas update:rollback` (or republish the previous commit through the guard).
