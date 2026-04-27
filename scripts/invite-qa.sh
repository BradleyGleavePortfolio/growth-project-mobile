#!/usr/bin/env bash
#
# Invite + deep-link QA against the production backend and marketing site.
#
# This script exercises every leg of the invite onboarding flow that does NOT
# require a device or a real user signup:
#
#   1. Backend reachability                api.trygrowthproject.com
#   2. /auth/signup-policy shape           feature flags drive the form UX
#   3. /invite/<code>/preview              valid / nonexistent / revoked / paused / expired
#   4. /auth/validate-invite-code          mirrors preview, but POST-only
#   5. assetlinks.json hosting             app.trygrowthproject.com/.well-known/...
#   6. apple-app-site-association hosting  same host, no extension
#   7. Google Digital Asset Links verifier confirms Android can verify silently
#   8. Apple AASA-CDN cache                what iOS actually fetches on device
#   9. /join/<code> universal URL          must respond 200 (or app-redirect HTML)
#  10. Optional ADB section (skipped if no device attached) — defers to
#      release-smoke.sh so we don't duplicate logic.
#
# What this script does NOT do:
#   - Create real users (requires Supabase admin creds we don't ship to QA boxes)
#   - Drive the actual app on a device — that's release-smoke.sh
#   - Test paid backend features (no auth token plumbed through)
#
# Usage:
#   bash scripts/invite-qa.sh
#   bash scripts/invite-qa.sh --code SMOKE01 --revoked OLDCODE --paused PAUSED1
#   API_HOST=api.staging.trygrowthproject.com APP_HOST=app.staging.trygrowthproject.com \
#     bash scripts/invite-qa.sh
#
# Exits non-zero on the first hard failure. Soft checks (e.g. assetlinks.json
# not yet hosted, Google verifier 404) print a "warn:" line and continue, so
# the script can be run before the marketing site rollout has fully landed.

set -uo pipefail

# Hosts default to production but can be overridden via env for staging runs.
API_HOST="${API_HOST:-api.trygrowthproject.com}"
APP_HOST="${APP_HOST:-app.trygrowthproject.com}"
PACKAGE="${PACKAGE:-com.growthproject.app}"

# Sample codes — override with --code / --revoked / --paused / --expired flags.
# Codes are kept ≤ 32 chars to satisfy the backend's class-validator length
# constraint (which returns HTTP 400 instead of `{valid:false}` for over-long
# input — that's a backend choice, not a contract we test against here).
#
# When --code is omitted we skip the "valid" probe entirely: there is no
# code that is both safe to leave in source AND guaranteed to exist in every
# environment. The script will still exercise the invalid / revoked / paused
# / expired probes so the negative path stays covered.
VALID_CODE="${VALID_CODE:-}"
INVALID_CODE="${INVALID_CODE:-NOPE$(date +%s | tail -c 11)}"
REVOKED_CODE="${REVOKED_CODE:-}"
PAUSED_CODE="${PAUSED_CODE:-}"
EXPIRED_CODE="${EXPIRED_CODE:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --code) VALID_CODE="$2"; shift 2 ;;
    --invalid) INVALID_CODE="$2"; shift 2 ;;
    --revoked) REVOKED_CODE="$2"; shift 2 ;;
    --paused) PAUSED_CODE="$2"; shift 2 ;;
    --expired) EXPIRED_CODE="$2"; shift 2 ;;
    --api-host) API_HOST="$2"; shift 2 ;;
    --app-host) APP_HOST="$2"; shift 2 ;;
    -h|--help)
      sed -n '3,38p' "$0"
      exit 0
      ;;
    *)
      printf 'unknown arg: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

step() { printf '\n=== %s ===\n' "$*"; }
ok()   { printf 'ok:   %s\n' "$*"; }
warn() { printf 'warn: %s\n' "$*" >&2; }
fail() { printf 'FAIL: %s\n' "$*" >&2; FAILED=1; }

FAILED=0

require() {
  command -v "$1" >/dev/null 2>&1 || { printf 'missing tool: %s\n' "$1" >&2; exit 2; }
}

require curl
require jq

# `curl` flags we use everywhere:
#   -sS    silent but show errors
#   -L     follow redirects (http) — but for assetlinks we deliberately want
#          to see redirects, so those calls drop -L
#   --max-time 15  bound the wall-clock so a wedged DNS doesn't hang QA
CURL=(curl -sS --max-time 15)

http_status() {
  # Print the status code for a URL without dumping the body.
  "${CURL[@]}" -o /dev/null -w '%{http_code}' "$1"
}

http_body() {
  "${CURL[@]}" "$1"
}

# Validate that a JSON document has `valid: bool`. If `valid: false`, we
# additionally accept (and surface) a `reason` string. Returns 0 on a parseable
# response, 1 if jq could not parse, 2 if the shape is wrong.
check_invite_payload() {
  local label="$1"
  local payload="$2"
  if ! echo "$payload" | jq -e . >/dev/null 2>&1; then
    fail "$label — response was not JSON: ${payload:0:200}"
    return 1
  fi
  if ! echo "$payload" | jq -e 'has("valid") and (.valid|type=="boolean")' >/dev/null; then
    fail "$label — JSON missing boolean 'valid' field: $payload"
    return 2
  fi
  local valid; valid="$(echo "$payload" | jq -r '.valid')"
  local reason; reason="$(echo "$payload" | jq -r '.reason // empty')"
  printf '  valid=%s' "$valid"
  [ -n "$reason" ] && printf ' reason=%q' "$reason"
  printf '\n'
  return 0
}

# ---------------------------------------------------------------------------
# 1. Backend reachability
# ---------------------------------------------------------------------------

step "backend reachable: https://${API_HOST}"
HEALTH_STATUS="$(http_status "https://${API_HOST}/")"
case "${HEALTH_STATUS}" in
  2*|3*|404)  ok "https://${API_HOST}/ → HTTP ${HEALTH_STATUS}" ;;
  000)        fail "could not reach https://${API_HOST}/ (DNS / TLS error)" ;;
  5*)         fail "https://${API_HOST}/ → HTTP ${HEALTH_STATUS} (backend is down)" ;;
  *)          warn "https://${API_HOST}/ → HTTP ${HEALTH_STATUS} (unexpected, continuing)" ;;
esac

# ---------------------------------------------------------------------------
# 2. /auth/signup-policy
# ---------------------------------------------------------------------------

step "GET /auth/signup-policy"
POLICY_BODY="$(http_body "https://${API_HOST}/api/auth/signup-policy" || true)"
# The mobile client (src/services/api.ts → authApi.getSignupPolicy) expects
# `{require_invite_code: bool, google_signin_enabled: bool}`. If the live
# backend returns a different shape — e.g. `{coach_code_required, providers}` —
# CreateAccountScreen falls back to its strict default (require_invite_code=true,
# googleEnabled=true), so the *worst case* is the policy is ignored, not that
# signup breaks. We surface the divergence as a hard fail so it's tracked,
# not a silent drift.
if echo "${POLICY_BODY}" | jq -e 'has("require_invite_code") and has("google_signin_enabled")' >/dev/null 2>&1; then
  REQ="$(echo "${POLICY_BODY}" | jq -r '.require_invite_code')"
  GOOG="$(echo "${POLICY_BODY}" | jq -r '.google_signin_enabled')"
  ok "policy: require_invite_code=${REQ} google_signin_enabled=${GOOG}"
elif echo "${POLICY_BODY}" | jq -e 'type=="object"' >/dev/null 2>&1; then
  fail "/auth/signup-policy returned a JSON object with the wrong shape: ${POLICY_BODY:0:200}
  expected keys: require_invite_code, google_signin_enabled
  see src/services/api.ts:200 (authApi.getSignupPolicy) — backend must return that shape or mobile silently falls back to strict-default policy"
else
  fail "/auth/signup-policy did not return JSON: ${POLICY_BODY:0:200}"
fi

# ---------------------------------------------------------------------------
# 3. /invite/<code>/preview — valid + invalid (+ revoked/paused/expired if provided)
# ---------------------------------------------------------------------------

preview_url() {
  printf 'https://%s/api/invite/%s/preview' "${API_HOST}" "$(printf '%s' "$1" | jq -sRr @uri)"
}

probe_preview() {
  local label="$1" code="$2" expected_valid="$3"
  step "GET /invite/${code}/preview  (${label})"
  local url; url="$(preview_url "${code}")"
  local body; body="$(http_body "${url}" || true)"
  local code_status; code_status="$(http_status "${url}")"
  printf '  status=%s\n' "${code_status}"
  case "${code_status}" in
    2*) ;; # 200/204 acceptable; many backends return 200 with valid:false
    400|404)
      # 4xx is also acceptable for INVALID — the backend may choose either
      # 200 + {valid:false} or a 400 / 404. We accept all three as long as
      # the *intended* outcome (rejected) is preserved.
      if [ "${expected_valid}" = "false" ]; then
        ok "preview returned ${code_status} for ${label} (acceptable — represents rejection)"
        return
      fi
      fail "${label} preview returned ${code_status} unexpectedly"
      return
      ;;
    5*) fail "${label} preview returned ${code_status} (backend error)"; return ;;
    *)  warn "${label} preview returned ${code_status}"; return ;;
  esac
  if check_invite_payload "${label} preview" "${body}"; then
    local got_valid; got_valid="$(echo "${body}" | jq -r '.valid')"
    if [ "${got_valid}" != "${expected_valid}" ]; then
      fail "${label} preview: expected valid=${expected_valid}, got valid=${got_valid}"
    else
      ok "${label} preview: valid=${got_valid} (as expected)"
    fi
  fi
}

if [ -n "${VALID_CODE}" ]; then
  probe_preview "valid" "${VALID_CODE}" "true"
else
  printf '\nskip: no --code supplied; pass --code <real-code> to exercise the happy path against this env\n'
fi
probe_preview "invalid"     "${INVALID_CODE}"   "false"
[ -n "${REVOKED_CODE}" ] && probe_preview "revoked" "${REVOKED_CODE}" "false"
[ -n "${PAUSED_CODE}" ]  && probe_preview "paused"  "${PAUSED_CODE}"  "false"
[ -n "${EXPIRED_CODE}" ] && probe_preview "expired" "${EXPIRED_CODE}" "false"

# ---------------------------------------------------------------------------
# 4. /auth/validate-invite-code — POST mirror of preview
# ---------------------------------------------------------------------------

probe_validate() {
  local label="$1" code="$2" expected_valid="$3"
  step "POST /auth/validate-invite-code  (${label})"
  local url="https://${API_HOST}/api/auth/validate-invite-code"
  local body code_status
  # Capture both the body and the status code so a 4xx with a NestJS error
  # envelope (statusCode/message/error) is reported clearly instead of being
  # mistaken for a malformed JSON shape.
  body="$("${CURL[@]}" -o /tmp/_validate.json -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg c "${code}" '{code:$c}')" "${url}" || true)"
  code_status="${body}"
  body="$(cat /tmp/_validate.json 2>/dev/null || true)"
  case "${code_status}" in
    200|201)
      if check_invite_payload "${label} validate" "${body}"; then
        local got_valid; got_valid="$(echo "${body}" | jq -r '.valid')"
        if [ "${got_valid}" != "${expected_valid}" ]; then
          fail "${label} validate: expected valid=${expected_valid}, got valid=${got_valid}"
        else
          ok "${label} validate: valid=${got_valid}"
        fi
      fi
      ;;
    400)
      # Backend uses class-validator to enforce code length / shape. A 400 for
      # a too-long or too-short code is acceptable rejection — the mobile
      # client trims input before sending and validates length client-side, so
      # the user never hits this path organically.
      if [ "${expected_valid}" = "false" ]; then
        ok "${label} validate: HTTP 400 (rejected by validator — acceptable)"
      else
        fail "${label} validate: HTTP 400 unexpectedly: ${body:0:200}"
      fi
      ;;
    404)
      if [ "${expected_valid}" = "false" ]; then
        ok "${label} validate: HTTP 404 (rejected — acceptable)"
      else
        fail "${label} validate: HTTP 404 — backend does not know this code"
      fi
      ;;
    *)
      fail "${label} validate: HTTP ${code_status} body=${body:0:200}"
      ;;
  esac
}

if [ -n "${VALID_CODE}" ]; then
  probe_validate "valid" "${VALID_CODE}" "true"
fi
probe_validate "invalid" "${INVALID_CODE}" "false"
[ -n "${REVOKED_CODE}" ] && probe_validate "revoked" "${REVOKED_CODE}" "false"
[ -n "${PAUSED_CODE}" ]  && probe_validate "paused"  "${PAUSED_CODE}"  "false"

# ---------------------------------------------------------------------------
# 5. Android assetlinks.json hosting
# ---------------------------------------------------------------------------

step "https://${APP_HOST}/.well-known/assetlinks.json"
AL_URL="https://${APP_HOST}/.well-known/assetlinks.json"
# Important: do NOT pass -L. Android's verifier does not follow redirects.
AL_STATUS="$(curl -sS --max-time 15 -o /tmp/_assetlinks.json -w '%{http_code}' "${AL_URL}" || echo 000)"
case "${AL_STATUS}" in
  200)
    if jq -e 'type=="array"' /tmp/_assetlinks.json >/dev/null 2>&1; then
      PKGS="$(jq -r '.[].target.package_name // empty' /tmp/_assetlinks.json | sort -u | tr '\n' ',' | sed 's/,$//')"
      if echo ",${PKGS}," | grep -q ",${PACKAGE},"; then
        ok "assetlinks.json hosted, includes ${PACKAGE}"
      else
        fail "assetlinks.json hosted but does NOT include ${PACKAGE} (got: ${PKGS})"
      fi
      FP="$(jq -r '.[].target.sha256_cert_fingerprints[]? // empty' /tmp/_assetlinks.json)"
      if [ -z "${FP}" ]; then
        fail "assetlinks.json has no sha256_cert_fingerprints — App Links cannot verify"
      elif echo "${FP}" | grep -qi 'REPLACE_WITH'; then
        fail "assetlinks.json contains placeholder fingerprint REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT — replace with real Play App Signing SHA-256"
      else
        ok "assetlinks.json fingerprint(s) populated"
      fi
    else
      fail "assetlinks.json is not a JSON array"
    fi
    ;;
  404|000)
    warn "${AL_URL} not yet hosted (HTTP ${AL_STATUS}). Universal links will fall through to a chooser until this is live. See docs/well-known/README.md."
    ;;
  3*)
    fail "assetlinks.json returned HTTP ${AL_STATUS} (redirect) — Android does not follow redirects for verification. Serve the file directly with no redirect."
    ;;
  *)
    fail "${AL_URL} returned HTTP ${AL_STATUS}"
    ;;
esac

# Google's hosted Digital Asset Links verifier — what Play actually checks.
step "Google Digital Asset Links verifier"
GDAL="$(curl -sS --max-time 15 \
  "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://${APP_HOST}&relation=delegate_permission/common.handle_all_urls" || true)"
if echo "${GDAL}" | jq -e '.statements | length > 0' >/dev/null 2>&1; then
  ok "Google verifier returned statements for https://${APP_HOST}"
elif echo "${GDAL}" | jq -e '.error' >/dev/null 2>&1; then
  ERR="$(echo "${GDAL}" | jq -r '.error.message')"
  warn "Google verifier error: ${ERR}"
else
  warn "Google verifier returned no statements (assetlinks.json not yet picked up)"
fi

# ---------------------------------------------------------------------------
# 6. iOS apple-app-site-association hosting
# ---------------------------------------------------------------------------

step "https://${APP_HOST}/.well-known/apple-app-site-association"
AASA_URL="https://${APP_HOST}/.well-known/apple-app-site-association"
AASA_STATUS="$(curl -sS --max-time 15 -o /tmp/_aasa.json -w '%{http_code}' "${AASA_URL}" || echo 000)"
case "${AASA_STATUS}" in
  200)
    if jq -e '.applinks.details | length > 0' /tmp/_aasa.json >/dev/null 2>&1; then
      ok "apple-app-site-association hosted and parses"
      APPIDS="$(jq -r '.applinks.details[].appIDs[]?' /tmp/_aasa.json)"
      if echo "${APPIDS}" | grep -qi 'REPLACE_WITH_APPLE_TEAM_ID'; then
        fail "apple-app-site-association still has REPLACE_WITH_APPLE_TEAM_ID placeholder — replace with the 10-char Apple Developer Team ID"
      elif echo "${APPIDS}" | grep -q "\.${PACKAGE}\$"; then
        ok "AASA appIDs include a bundle matching ${PACKAGE}"
      else
        fail "AASA appIDs do not include any entry ending in .${PACKAGE} (got: $(echo ${APPIDS} | tr '\n' ' '))"
      fi
    else
      fail "AASA file present but applinks.details is empty"
    fi
    ;;
  404|000)
    warn "${AASA_URL} not yet hosted (HTTP ${AASA_STATUS}). iOS Universal Links will open in Safari until this is live."
    ;;
  3*)
    fail "AASA returned HTTP ${AASA_STATUS} (redirect) — Apple does not follow redirects for AASA. Serve directly."
    ;;
  *)
    fail "${AASA_URL} returned HTTP ${AASA_STATUS}"
    ;;
esac

# Apple's CDN — the URL iOS actually fetches on-device. Worth checking
# separately because Cloudflare / origin-only deploys often miss the AASA-CDN
# warm-up.
step "Apple AASA-CDN cache"
CDN_STATUS="$(http_status "https://app-site-association.cdn-apple.com/a/v1/${APP_HOST}")"
case "${CDN_STATUS}" in
  200) ok "AASA-CDN cached our file (HTTP 200)" ;;
  404) warn "AASA-CDN has not picked up our file yet (HTTP 404). Apple refreshes ~hourly after first publish." ;;
  *)   warn "AASA-CDN returned HTTP ${CDN_STATUS}" ;;
esac

# ---------------------------------------------------------------------------
# 7. /join/<code> universal URL — what a user actually taps
# ---------------------------------------------------------------------------

# Use whatever real-or-synthetic code we have so the URL path has a trailing
# segment — `/join/abc` exercises a different routing rule than bare `/join`
# on most static hosts.
JOIN_PROBE_CODE="${VALID_CODE:-${INVALID_CODE}}"
step "GET https://${APP_HOST}/join/${JOIN_PROBE_CODE}"
JOIN_STATUS="$(curl -sS --max-time 15 -L -o /dev/null -w '%{http_code}' "https://${APP_HOST}/join/${JOIN_PROBE_CODE}")"
case "${JOIN_STATUS}" in
  200) ok "marketing site serves /join/<code> (HTTP 200)" ;;
  301|302|303|307|308) ok "redirects to ${JOIN_STATUS} — fine, browser will follow" ;;
  404) warn "marketing site has no /join/<code> page yet — taps will hit a 404 if AASA verification fails. Add a smart-banner page that redirects to the App Store / Play Store for non-installed users." ;;
  *)   fail "https://${APP_HOST}/join/${JOIN_PROBE_CODE} returned HTTP ${JOIN_STATUS}" ;;
esac

# Also check the bare /join (manual-entry) path
step "GET https://${APP_HOST}/join"
BARE_STATUS="$(curl -sS --max-time 15 -L -o /dev/null -w '%{http_code}' "https://${APP_HOST}/join")"
case "${BARE_STATUS}" in
  200|301|302|303|307|308) ok "marketing site serves /join (HTTP ${BARE_STATUS})" ;;
  404) warn "/join (no code) has no page — same fix as above" ;;
  *)   fail "https://${APP_HOST}/join returned HTTP ${BARE_STATUS}" ;;
esac

# ---------------------------------------------------------------------------
# 8. Optional: ADB section
# ---------------------------------------------------------------------------

step "device-side checks (optional)"
if command -v adb >/dev/null 2>&1; then
  if adb devices | awk 'NR>1 && $2=="device"{found=1} END{exit !found}'; then
    ok "Android device attached — defer to scripts/release-smoke.sh for on-device verification"
    printf '   run:  bash scripts/release-smoke.sh\n'
  else
    ok "no Android device attached — skipping on-device checks"
  fi
else
  ok "adb not installed — skipping on-device checks"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

step "summary"
if [ "${FAILED}" -ne 0 ]; then
  printf 'one or more hard checks failed (see FAIL lines above)\n' >&2
  exit 1
fi
printf 'all hard checks passed. Soft warnings (warn:) above are expected if the marketing site / hosted association files have not landed yet.\n'
