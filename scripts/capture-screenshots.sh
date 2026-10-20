#!/usr/bin/env bash
# Native captures require an already installed screenshot-mode simulator app.
set -euo pipefail
command -v xcrun >/dev/null || { echo "macOS + Xcode required" >&2; exit 2; }
OUT_DIR="${SCREENSHOT_OUT_DIR:-./screenshots/ios}"
APP_ID="com.growthproject.app"
slugs="$(node scripts/capture-screenshots-web.js --list)"
for spec in "iPhone 16 Pro Max:1320:2868" "iPhone 16 Pro:1206:2622"; do
  IFS=: read -r device width height <<< "$spec"
  udid="$(xcrun simctl list devices available -j | DEVICE="$device" node -e '
    let s=""; process.stdin.on("data", b => s+=b).on("end", () => {
      const d=Object.values(JSON.parse(s).devices).flat().find(d=>d.name===process.env.DEVICE);
      if (!d) process.exit(3); console.log(d.udid);
    });')"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl get_app_container "$udid" "$APP_ID" app >/dev/null
  xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 \
    --wifiBars 3 --cellularBars 4
  dir="$OUT_DIR/${width}x${height}"
  mkdir -p "$dir"
  while IFS= read -r slug; do
    # Cold launch per frame also switches the seeded client/coach identity.
    xcrun simctl terminate "$udid" "$APP_ID" 2>/dev/null || true
    xcrun simctl openurl "$udid" "tgp://screenshot/$slug"
    sleep "${SCREENSHOT_SETTLE:-8}"
    file="$dir/$slug.png"
    xcrun simctl io "$udid" screenshot --type=png "$file"
    actual="$(sips -g pixelWidth -g pixelHeight "$file" | awk '/pixelWidth|pixelHeight/ {print $2}' | paste -sdx -)"
    [[ "$actual" == "${width}x${height}" ]] || { echo "Wrong PNG size: $actual" >&2; exit 4; }
    sips -g hasAlpha "$file" | grep -q 'hasAlpha: no' || { echo "PNG has alpha: $file" >&2; exit 5; }
  done <<< "$slugs"
done
echo "Captured both sizes. Verify each screen before store upload; captions are separate data."
