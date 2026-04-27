#!/usr/bin/env bash
#
# Automatable subset of docs/RELEASE_SMOKE.md.
#
# Runs the parts that don't need eyeballs against a connected Android device
# or emulator. Intended to be run after `adb install` of a preview APK.
#
# Anything visual (splash render, button taps, Google OAuth in a browser) is
# NOT here — those stay in the human checklist.
#
# Usage:
#   bash scripts/release-smoke.sh                 # full run
#   bash scripts/release-smoke.sh --skip-deeplink # if assetlinks.json is not yet hosted
#
# Exits non-zero on the first failure so CI / a release runbook can branch on it.

set -euo pipefail

PACKAGE="com.growthproject.app"
HOST="app.trygrowthproject.com"
SMOKE_INVITE="SMOKE01"

SKIP_UNIVERSAL=0
for arg in "$@"; do
  case "$arg" in
    --skip-deeplink) SKIP_UNIVERSAL=1 ;;
    -h|--help)
      sed -n '3,16p' "$0"
      exit 0
      ;;
  esac
done

step() { printf '\n=== %s ===\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
ok()   { printf 'ok: %s\n' "$*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "missing tool: $1"
}

require adb
require jq
require node

# ----- 1. App config validation (no device needed) ---------------------------

step "validate app config"
node "$(dirname "$0")/validate-app-config.js"

# ----- 2. Device reachable ----------------------------------------------------

step "device check"
DEVICE_LINE="$(adb devices | awk 'NR>1 && $2=="device"{print; exit}')"
[ -n "${DEVICE_LINE}" ] || fail "no Android device/emulator attached (adb devices is empty)"
ok "device present: ${DEVICE_LINE}"

# ----- 3. Package installed ---------------------------------------------------

step "package installed"
adb shell pm list packages | grep -q "package:${PACKAGE}$" \
  || fail "${PACKAGE} not installed; run \`adb install -r build.apk\` first"
ok "${PACKAGE} installed"

# ----- 4. versionCode sanity --------------------------------------------------

step "versionCode matches app.json"
APP_JSON_CODE="$(jq -r '.expo.android.versionCode' "$(dirname "$0")/../app.json")"
DEVICE_CODE="$(adb shell dumpsys package "${PACKAGE}" | awk -F= '/versionCode=/{print $2; exit}' | awk '{print $1}')"
[ "${APP_JSON_CODE}" = "${DEVICE_CODE}" ] \
  || fail "versionCode mismatch: app.json=${APP_JSON_CODE} device=${DEVICE_CODE} (rebuild + reinstall)"
ok "versionCode ${DEVICE_CODE}"

# ----- 5. Notification channels created --------------------------------------

step "notification channels"
CHANNELS_DUMP="$(adb shell dumpsys notification 2>/dev/null | grep -A1 "NotificationChannel.*${PACKAGE}" || true)"
for ch in default water fasting; do
  if echo "${CHANNELS_DUMP}" | grep -qi "id=${ch}"; then
    ok "channel '${ch}' present"
  else
    # Channels are lazily created on first call to setNotificationChannelAsync,
    # which fires from App.tsx → requestNotificationPermissions on launch. If
    # it's missing, the app probably hasn't been launched yet.
    fail "notification channel '${ch}' not found — has the app been launched at least once after install?"
  fi
done

# ----- 6. Custom-scheme deep link --------------------------------------------

step "custom scheme deep link"
adb shell am start -a android.intent.action.VIEW \
  -d "tgp://join/${SMOKE_INVITE}" "${PACKAGE}" >/dev/null
sleep 2
TOP="$(adb shell dumpsys activity activities | awk '/topResumedActivity=|mResumedActivity=/{print; exit}')"
echo "${TOP}" | grep -q "${PACKAGE}" \
  || fail "tgp://join/${SMOKE_INVITE} did not resume our activity (top=${TOP})"
ok "custom scheme launched ${PACKAGE}"

# ----- 7. Universal link verification (gated by assetlinks.json hosting) -----

if [ "${SKIP_UNIVERSAL}" -eq 1 ]; then
  printf 'skip: universal link check (--skip-deeplink) — re-run once https://%s/.well-known/assetlinks.json is live\n' "${HOST}"
else
  step "android app links — domain verified"
  VERIFY="$(adb shell pm get-app-links "${PACKAGE}" 2>/dev/null || true)"
  if echo "${VERIFY}" | grep -E "(^|[[:space:]])${HOST}:" | grep -qi 'verified'; then
    ok "${HOST} verified for ${PACKAGE}"
  else
    fail "${HOST} not verified — host docs/well-known/assetlinks.json at https://${HOST}/.well-known/assetlinks.json with the Play App Signing SHA-256 (see docs/well-known/README.md)"
  fi
fi

# ----- 8. Crash check (recent logcat) ----------------------------------------

step "no recent FATAL exceptions"
CRASHES="$(adb logcat -d -t 500 | grep -E 'FATAL EXCEPTION|AndroidRuntime: FATAL' || true)"
[ -z "${CRASHES}" ] || fail "FATAL exception observed in logcat:\n${CRASHES}"
ok "no FATAL in last 500 log lines"

printf '\nAll automatable smoke checks passed. The visual / OAuth / push-receive items in docs/RELEASE_SMOKE.md still require manual sign-off.\n'
