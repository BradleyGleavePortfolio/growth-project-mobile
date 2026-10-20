# Screenshot harness

The existing tool captures **real app screens**, not drawn substitutes:
client Home, Roman chat, active workout logging, food logging, coach messages,
then coach Overview. `screens.ts` is the single target/size manifest consumed
by the app and both drivers. Its caption options retain MOCK-STORESHOTS ids
1–12 (prefix `MOCK-STORESHOTS-`); owner selection is pending. Captures have no
caption, frame, device illustration or marketing overlay.

## Isolation and navigation

Only `EXPO_PUBLIC_SCREENSHOT_MODE=1` activates the fixture adapter and demo
storage. App mounts `ScreenshotNavigator`, which reads
`tgp://screenshot/<slug>` (web: `/screenshot/<slug>`), seeds the target role,
and supplies nested initial state to the **shipping ClientNavigator or
CoachNavigator**. All six possible client tabs are represented by the real
navigation type; flags still decide which exist. Coach tabs are never replaced
or forced on: the selected store profile's `coachTabsV2` decides the bar.
Roman must be enabled in that profile; its canned history makes no AI call.
Network data is invented. Never use this mode on a personal/production install.
Fixture matching ignores URL query strings; handlers keep the original request.
Capture-only realtime adapters never join live channels, on either platform.
The production Metro alias still removes the harness and fixtures entirely.
Web-only adapters cover SQLite and unused native payment/support SDKs; no selected
screen or navigation bar is substituted.

## CI proof / web review

The Store capture CI job uses `eas.json` production profile env (including
inherited env), starts Expo locally, and runs the existing web driver. It checks
distinct screen content, missing fixtures, runtime errors and PNG header sizes,
then uploads **12 raw PNGs**, `evidence.json` (captions separate) and Metro logs.
Web frames are react-native-web renders, **not native/device proof**; review
them, but use the native path below for App Store upload.

For an equivalent local run after `npm ci` (Playwright is not in
package.json; this is the workflow's own line):

```bash
SCREENSHOT_PROFILE=production npm exec --yes --package=playwright@1.58.2 -- sh -c '
  playwright install --with-deps chromium
  export NODE_PATH="$(dirname "$(dirname "$(command -v playwright)")")"
  node scripts/capture-screenshots-web.js'
```

Outputs: `screenshots/web/{1320x2868,1206x2622}/<slug>.png`.
1320×2868 fills Apple's large-display iPhone slot; 1206×2622 fills the
required medium-display slot (App Store Connect scales the rest).
An existing Expo server may be selected with `SCREENSHOT_WEB_URL`; start it
with the selected profile's flags and screenshot mode yourself in that case.
Remote EAS environment values are not read: supply any store-build flag
overrides in the shell, particularly `EXPO_PUBLIC_FF_COACH_TABS_V2`, if used.
The driver does not silently enable that flag.

## Native capture (macOS, no EAS)

On a dedicated simulator, install/start a development app with the **same
public feature flags as the store build**, plus screenshot mode, using Expo's
local simulator workflow. Do this on both iPhone 16 Pro Max (1320×2868) and
iPhone 16 Pro (1206×2622). The release binary intentionally has no harness.
Keep Metro running, then:

```bash
bash scripts/capture-screenshots.sh
```

The existing native driver cold-launches each target and switches client/coach
fixtures automatically. It rejects missing apps and wrong PNG dimensions
(no stretching or resizing) or with alpha, and sets a clean 9:41 status bar. Outputs: `screenshots/ios/<size>/<slug>.png`.
If Metro needs longer, set `SCREENSHOT_SETTLE=20`. Before upload, inspect all
12 frames: correct screen, content loaded, no development overlays, full real
navigation bar, no caption. Native capture requires this visual check; a
fixed settle delay alone is not proof of screen readiness.
No EAS build/update, production service or store upload is part of either driver.
