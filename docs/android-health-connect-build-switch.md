# Android Health Connect build switch

The first Android closed-test binary does not include Health Connect permission
declarations or connect actions. Apple Health on iOS is unchanged.

`app.config.js` reads the base Expo config from `app.json`.
`TGP_ANDROID_HEALTH_CONNECT=1` is the only opt-in value; unset, `0` and all other
values keep Android Health Connect off. `preview` and `production` explicitly set
`0` in `eas.json`. `clinic` (the launch profile) extends `production` and sets
`1` (S14 round 3, #317): Health Connect returns in the clinic Android binary.
Before that binary goes to a reviewed Play track, the owner completes the Play
Console Health apps declaration for the read types listed in #317.

S-WEAR-3 (Opus C-317-5): the Samsung additional-health-data permission and
`android.permission.ACTIVITY_RECOGNITION` are no longer declared and are
blocked in every build, ON and OFF.

OFF removes every `android.permission.health.*` declaration, adds manifest-merger removal rules through
`android.blockedPermissions`, removes the Health Connect plugin and sets
`extra.healthConnectEnabled=false`. The package and version code remain
`com.growthproject.app` and `4`. This switch does not uninstall the dependency or
change health-data contracts.

Runtime checks fail closed when that metadata is absent or not boolean `true`.
Health Connect and Samsung Health connect sheets explain that Health Connect is
coming in an Android update, offer Close, and have no permission CTA. Native reads,
permissions and sync entry points reject with `health_connect_build_disabled`
before loading the Health Connect module.

## Wearables integration

[Wearables PR #317](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/317)
must retain these guards and the lazy Health Connect require in
`onDeviceConnect.ts` when resolving overlapping files. OFF also filters its
`./plugins/withHealthConnectPermissionDelegate` registration. ON passes all
`app.json` permissions and plugins through unchanged, including #317's added
resting-heart-rate permission and delegate plugin. Its consent, account-isolation,
history-import and ingest fixes remain required before enabling Health Connect.

For a later native update, obtain approval for #317 and the Play declaration,
explicitly change the desired EAS profile to `TGP_ANDROID_HEALTH_CONNECT=1`, and
build a new Android binary. Changing JavaScript alone cannot add native manifest
permissions. Do not use an ON OTA update to enable Health Connect in an OFF binary.

## Introspection proof

Without running prebuild or starting an EAS build:

```sh
TGP_ANDROID_HEALTH_CONNECT=0 EXPO_NO_DOTENV=1 npx expo config --type introspect --json
TGP_ANDROID_HEALTH_CONNECT=1 EXPO_NO_DOTENV=1 npx expo config --type introspect --json
```

On base `c4963f87159d36dc50ecc90a8461262220956f75`, OFF has zero active Health
Connect/Samsung health permissions and 18 `tools:node="remove"` entries:
17 Android health permissions (including background reads) plus Samsung's
additional-health-data permission. ON has those 18 active declarations and the
Health Connect plugin. The brief's estimate of 18 Android health permissions is
one higher than this base; #317 adds `READ_RESTING_HEART_RATE`, which the transform
also removes/blocks when OFF. These are config-plugin introspection results, not
an inspection of a built AAB or an installed-device test.
