#!/usr/bin/env bash
set -euo pipefail
# Credentials never enter the app build, command line, summaries or artifacts.
# Maestro's private diagnostics can contain typed secrets: keep them in temp.
for key in REVIEW_CLIENT_EMAIL REVIEW_CLIENT_PASSWORD REVIEW_COACH_EMAIL REVIEW_COACH_PASSWORD; do
  value="${!key}"
  if [[ -n "$value" ]]; then printf '::add-mask::%s\n' "$value"; fi
done
runtime=$(xcrun simctl list runtimes -j | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
const r=JSON.parse(s).runtimes.filter(r=>r.isAvailable&&r.name.startsWith("iOS"))
.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}))[0];
if(!r)process.exit(1);console.log(r.identifier);});')
failed=0
mkdir -p out/ios-6.9 out/ios-6.5

for size in ${SHOT_SIZES:-6.9}; do
  out="out/ios-$size"
  if [[ "$size" == 6.9 ]]; then
    device=com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max
    dimensions=1320x2868
  else
    device=com.apple.CoreSimulator.SimDeviceType.iPhone-14-Plus
    dimensions=1284x2778
  fi
  udid=$(xcrun simctl create "TGP-SHOTS127-$size" "$device" "$runtime")
  echo "Booting $size-inch simulator ($runtime)."
  xcrun simctl boot "$udid"
  open -a Simulator
  perl -e 'alarm 180; exec @ARGV' -- xcrun simctl bootstatus "$udid" -b
  echo "$size-inch simulator boot complete."
  xcrun simctl ui booted appearance light
  xcrun simctl status_bar booted override --time 9:41 \
    --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
  xcrun simctl install "$udid" "$SIMULATOR_APP"
  printf 'Application SHA\t%s\nPipeline SHA\t%s\nNative pixels\t%s\nSimulator\t%s\nRuntime\t%s\n' \
    "$APP_SHA" "$GITHUB_SHA" "$dimensions" "$device" "$runtime" > "$out/manifest.tsv"
  export SHOT_SIZE="$size" SHOT_OUT="$out" SHOT_DIMENSIONS="$dimensions"
  export MAESTRO_CLIENT_EMAIL="$REVIEW_CLIENT_EMAIL" MAESTRO_CLIENT_PASSWORD="$REVIEW_CLIENT_PASSWORD"
  export MAESTRO_COACH_EMAIL="$REVIEW_COACH_EMAIL" MAESTRO_COACH_PASSWORD="$REVIEW_COACH_PASSWORD"
  master="$RUNNER_TEMP/shots-$size.yaml"
  node .github/shots127/batch-generator.js "$master"
  # One Maestro driver session per size, not one slow cold start per image.
  # The loopback-only helper invokes simctl between verified Maestro subflows.
  python3 .github/shots127/native_capture.py > "$RUNNER_TEMP/native-helper-$size.log" 2>&1 &
  helper_pid=$!
  trap 'kill "$helper_pid" 2>/dev/null || true' EXIT
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:8767/health >/dev/null; then break; fi
    sleep 1
  done
  echo "Starting verified Maestro batch for $size-inch."
  if ! perl -e 'alarm 2700; exec @ARGV' -- \
    maestro --device "$udid" test --debug-output "$RUNNER_TEMP/private-maestro/$size" \
    "$master" > "$RUNNER_TEMP/private-maestro-$size.log" 2>&1; then
    printf 'BATCH\tFAILED (uncaptured targets not published)\n' >> "$out/manifest.tsv"
    echo "::warning::$size-inch batch failed; private diagnostics withheld."
    if [[ "${INCLUDE_SIGNED_IN:-false}" != true ]]; then
      tail -35 "$RUNNER_TEMP/private-maestro-$size.log"
    fi
    failed=1
  fi
  # Safe summary: flow-level status lines only, typed text removed, emails masked.
  grep -E "(COMPLETED|FAILED|WARNED|SKIPPED)" "$RUNNER_TEMP/private-maestro-$size.log" \
    | grep -viE "input ?text|password" | sed -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+/<email>/g' | tail -80 || true
  ls "$out"
  kill "$helper_pid"
  wait "$helper_pid" 2>/dev/null || true
  trap - EXIT
  unset MAESTRO_CLIENT_EMAIL MAESTRO_CLIENT_PASSWORD MAESTRO_COACH_EMAIL MAESTRO_COACH_PASSWORD
  if compgen -G "$out/*.png" > /dev/null; then
    (cd "$out" && shasum -a 256 ./*.png > SHA256SUMS)
  fi
  { echo "### Native $size-inch capture"; echo '```'; cat "$out/manifest.tsv"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
  xcrun simctl shutdown "$udid"
done
exit "$failed"
