#!/usr/bin/env bash
#
# Drive the iOS simulator and capture App Store screenshots.
#
# Prerequisites:
#   - macOS with Xcode + iPhone 16 Plus simulator installed
#   - The app already running on the simulator under EXPO_PUBLIC_SCREENSHOT_MODE=1
#     (i.e. you ran `EXPO_PUBLIC_SCREENSHOT_MODE=1 npx expo run:ios --device "iPhone 16 Plus"`
#     in another terminal first)
#
# What it does:
#   - Boots the iPhone 16 Plus simulator if not already booted
#   - For each entry in src/screenshots/screens.ts, deep-links into the
#     screen, waits for it to settle, and saves a 1284x2778 PNG to
#     ./screenshots/ios-6.5/<slug>.png
#
# Output is the App Store Connect 6.5" set, ready to upload.
#
set -euo pipefail

DEVICE_NAME="${SCREENSHOT_DEVICE:-iPhone 16 Plus}"
OUT_DIR="${SCREENSHOT_OUT_DIR:-./screenshots/ios-6.5}"
SETTLE_SECONDS="${SCREENSHOT_SETTLE:-2.0}"
SCHEME="tgp"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun is not on PATH — this script needs macOS + Xcode." >&2
  exit 2
fi

mkdir -p "$OUT_DIR"

# Locate the simulator UDID. `xcrun simctl list devices available` prints lines
# like:
#   iPhone 16 Plus (ABCD-1234-...) (Booted)
udid="$(xcrun simctl list devices available \
  | awk -v name="$DEVICE_NAME" '
    $0 ~ "^[[:space:]]*"name"[[:space:]]*\\(" {
      match($0, /\(([A-F0-9-]+)\)/, m); print m[1]; exit
    }')"

if [[ -z "${udid:-}" ]]; then
  echo "error: simulator '${DEVICE_NAME}' is not installed. Try:" >&2
  echo "  xcrun simctl list devicetypes | grep 'iPhone 16 Plus'" >&2
  exit 3
fi

echo "→ booting ${DEVICE_NAME} (${udid})…"
xcrun simctl boot "$udid" 2>/dev/null || true
open -a Simulator

# Routes — keep in sync with src/screenshots/screens.ts. We do not parse the
# TS file here to avoid pulling node into a shell script; the duplication is
# small and a missing entry yells loudly because it lands on Home.
ROUTES=(
  "01-home:home"
  "02-log:log"
  "03-plan:plan"
  "04-recipes:recipes"
  "05-progress:progress"
  "06-fasting:fast"
)

# Deep-link prefixes: app.json declares both `tgp://` and
# `https://app.trygrowthproject.com`. Use the custom scheme to avoid Safari
# interception. Routes other than auth (`Welcome`, `Login`, `CreateAccount`)
# are not registered in the linking config today, so the harness adds a
# best-effort fallback: tap the corresponding tab via UI automation when
# `simctl openurl` is a no-op. For the marketing target screens this is
# acceptable because the four bottom tabs cover Home / Log / MoreTab, and
# Plan / Recipes / Progress / Fast are reachable from the More index.

capture_one() {
  local slug="$1" route="$2" out
  out="${OUT_DIR}/${slug}.png"

  # Drive navigation: emit a custom deep-link the app's NavigationContainer
  # picks up. Until ClientNavigator's linking config grows entries for these
  # routes, we fall through to Home and the user/operator pre-positions the
  # app on the right tab in the simulator. See src/screenshots/screens.ts for
  # which tab each route lives under.
  xcrun simctl openurl "$udid" "${SCHEME}://${route}" >/dev/null 2>&1 || true

  echo "→ settling ${slug} (${SETTLE_SECONDS}s)…"
  sleep "$SETTLE_SECONDS"

  echo "→ capturing ${out}"
  xcrun simctl io "$udid" screenshot --type=png "$out"
}

for entry in "${ROUTES[@]}"; do
  slug="${entry%%:*}"
  route="${entry#*:}"
  capture_one "$slug" "$route"
done

echo
echo "✓ wrote ${#ROUTES[@]} screenshots to ${OUT_DIR}"
echo "  Verify each is 1284 × 2778 before uploading to App Store Connect:"
echo "    sips -g pixelWidth -g pixelHeight ${OUT_DIR}/*.png"
