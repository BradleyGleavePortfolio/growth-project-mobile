# Over-the-air updates (EAS Update)

Added for the clinic launch (C11). Lets JavaScript-only fixes reach installed
builds without a new App Store review.

## Configuration (app.json / eas.json)

| Setting | Value | Why |
|---|---|---|
| `expo-updates` | `~56.0.28` (SDK 56 pin from `npx expo install`) | native module, ships in the binary |
| `expo.runtimeVersion` | `{ "policy": "fingerprint" }` | see below |
| `expo.updates.url` | `https://u.expo.dev/a12c3345-cc8c-4c2c-9c57-711c10a57c1c` | this project's EAS projectId |
| `expo.updates.checkAutomatically` | `ON_LOAD` | check on every cold start |
| `expo.updates.fallbackToCacheTimeout` | `0` | never block launch on the network; a downloaded update applies on the next launch |
| `eas.json build.production.channel` | `production` | store builds read the `production` channel |
| `eas.json build.preview.channel` | `preview` | internal builds read the `preview` channel |
| `development` profile | no channel | dev client loads from Metro |

`npm run validate:config` fails on any of these:
- `runtimeVersion` is anything other than `{ "policy": "fingerprint" }`, including a per-platform override.
- `disableAntiBrickingMeasures: true` or `useEmbeddedUpdate: false`.
- `fallbackToCacheTimeout` is not 0.
- A wrong updates URL or channel.
- `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` is not `"true"` in the preview/production build profiles.

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

## One-time owner step

The Expo project owner (`the-growth-project` account) must enable EAS Update
for the project once (expo.dev → project → Updates, or `eas update:configure`
run by an account member). No code secret is required; the app only needs the
public updates URL already in `app.json`. Builds made before this PR (≤ #5)
do not contain `expo-updates` and never receive updates.

## Publishing (operator)

Always publish through the guard:

```
npm run update:publish -- --channel production --environment production --message "<what changed>"   # store builds
npm run update:publish -- --channel preview --environment preview --message "<what changed>"          # internal builds
# add --dry-run to run every check without publishing
```

The guard (`scripts/eas-update-guard.js`) runs
`eas update --channel <c> --environment <c> --message <m>` only when all of these hold:
1. `--environment` is given and equals the channel. SDK 55+ requires it.
2. `src/config/purchaseSurfaces.ts` matches the reviewed hash in `scripts/purchase-policy.sha256`.
3. `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` is exactly `"true"` in that EAS environment. This is read with `eas env:exec`; if the read fails, the guard refuses to publish.

The unguarded equivalent, for reference only, is
`eas update --channel production --environment production --message "<what changed>"`.

### Build env vs update env (purchase-critical)

`eas.json` `build.<profile>.env` applies to **builds only**. `eas update` exports the JS bundle with the variables of the **EAS environment** named by `--environment`, and does not use `eas.json` env. Every `EXPO_PUBLIC_*` value is inlined into that bundle again. Before the first publish, provision these release-critical variables in EAS for **both** `preview` and `production`:

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
- **Governance.** The publish guard above, plus the pinned policy hash (CI also checks the lock through `easUpdateGuard.test.js`).
- **Server.** Every native request sends `X-Client-Platform`, `X-Client-Native-Build` and `X-Client-Purchase-Policy` (`p2p-only` on hidden iOS). Backend follow-up, not in this PR: reject AI credit-pack checkout, coach subscription/portal sessions and other non-P2P session creation for `X-Client-Platform: ios` requests.
- **Limit.** Anyone who can publish can still ship arbitrary JS, including JS that edits the gate. That is a publisher-permission question. Restrict EAS publish rights to the owner.

### Update signing

Update code signing is **not** configured. Updates are authenticated by EAS account access only, so keep publish rights restricted. Signing would not fix the risk above either, because an authorised publisher can sign any bundle.

### Before the first production publish (device checks)

1. Build 6 starts offline (embedded bundle).
2. A preview update is received on a later launch.
3. An update that fails early recovers to the embedded bundle.
4. An operator rollback (`eas update:rollback`) reaches the device.

Expo error recovery is best-effort. None of these checks is covered by Jest or the config validator.

Only JavaScript/asset changes can ship this way. Native changes (new native
module, permissions, plugins, build numbers) need a new binary.
