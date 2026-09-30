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

`npm run validate:config` fails if any of these drift.

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

```
eas update --channel production --message "<what changed>"   # store builds
eas update --channel preview --message "<what changed>"      # internal builds
```

Only JavaScript/asset changes can ship this way. Native changes (new native
module, permissions, plugins, build numbers) need a new binary.
