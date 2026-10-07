#!/usr/bin/env bash
set -euo pipefail
slug="$1"
sleep 2
png="$RUNNER_TEMP/$SHOT_SIZE-$slug.png"
xcrun simctl io booted screenshot --type=png "$png"
actual=$(sips -g pixelWidth -g pixelHeight "$png" |
  awk '/pixelWidth/{w=$2}/pixelHeight/{print w "x" $2}')
if [[ "$actual" != "$SHOT_DIMENSIONS" ]]; then
  printf '%s\tWITHHELD (wrong native dimensions)\n' "$slug" >> "$SHOT_OUT/manifest.tsv"
  exit 1
fi
if ! swift .github/shots127/check-visible-email.swift "$png"; then
  printf '%s\tWITHHELD (account email visible)\n' "$slug" >> "$SHOT_OUT/manifest.tsv"
  exit 1
fi
cp "$png" "$SHOT_OUT/$slug.png"
printf '%s\tCAPTURED\t%s\n' "$slug" "$actual" >> "$SHOT_OUT/manifest.tsv"
echo "Captured $SHOT_SIZE-inch flow $slug ($actual)."
