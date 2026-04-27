# Hosted association files for deep links

These two files must be hosted on `https://app.trygrowthproject.com` for Android App Links and iOS Universal Links to verify silently. Until they are live, taps on `https://app.trygrowthproject.com/join/<code>` will open a chooser sheet on Android (or Safari on iOS) instead of launching the app.

| File | Hosted URL | Purpose |
| --- | --- | --- |
| `assetlinks.json` | `https://app.trygrowthproject.com/.well-known/assetlinks.json` | Verifies Android App Link for `com.growthproject.app` |
| `apple-app-site-association` | `https://app.trygrowthproject.com/.well-known/apple-app-site-association` | Verifies iOS Universal Link for `com.growthproject.app` |

Both files in this directory are **templates**. Replace the placeholders before publishing — never check real fingerprints into the marketing site repo without confirming the source of truth is EAS managed credentials, not a one-off keystore.

---

## Android — `assetlinks.json`

### What to fill in

- `package_name` — already set to `com.growthproject.app` (matches `app.json → expo.android.package`).
- `sha256_cert_fingerprints` — replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` with the fingerprint of the **Play App Signing** key.

### How to obtain the fingerprint

After the first production EAS build is uploaded to the Play Console, Play takes over signing. Pull the canonical fingerprint either way:

```bash
# Option A — from EAS managed credentials (pre-Play-takeover)
eas credentials
# choose:  Android  →  production  →  Keystore  →  view fingerprints

# Option B — from Play Console (post-upload, this is the SHA-256 Play actually uses)
# Play Console → Setup → App integrity → App signing → "App signing key certificate"
# Copy the SHA-256 fingerprint string (colon-separated, uppercase hex).
```

If a build was distributed to internal testing using the **upload key** before Play took over, list that fingerprint as well — App Links will only verify if the fingerprint matches the cert that signed the installed APK/AAB.

### Hosting requirements

- Served over HTTPS with a valid (not self-signed) cert.
- `Content-Type: application/json`.
- HTTP 200 (no redirect chains; Android does not follow them for verification).
- Reachable to anonymous traffic — no auth, no IP allowlist.

### Verification commands

```bash
# Sanity-check the file is reachable and valid JSON
curl -sS https://app.trygrowthproject.com/.well-known/assetlinks.json | jq .

# Google's hosted verifier — returns the parsed asset statement on success
curl -sS "https://digitalassetlinks.googleapis.com/v1/statements:list?\
source.web.site=https://app.trygrowthproject.com&\
relation=delegate_permission/common.handle_all_urls" | jq .

# On a connected Android device, ask the system to re-verify our domain
adb shell pm verify-app-links --re-verify com.growthproject.app
adb shell pm get-app-links com.growthproject.app
# Expected: "Domain verification state: app.trygrowthproject.com:  verified"

# End-to-end: tapping this URL should open the app silently (no chooser)
adb shell am start -a android.intent.action.VIEW \
  -d "https://app.trygrowthproject.com/join/SMOKE01" \
  com.growthproject.app
```

If `pm get-app-links` reports `legacy_failure` or `none`, the most common causes are: fingerprint mismatch, `assetlinks.json` returning a redirect, or the file behind a CDN that injects non-JSON content.

---

## iOS — `apple-app-site-association`

### What to fill in

- Replace both `REPLACE_WITH_APPLE_TEAM_ID` placeholders with the 10-character Apple Developer Team ID (e.g. `ABCDE12345`). Do not include the leading `app:` prefix — the format is `<TeamID>.<bundleID>`.

### Hosting requirements

- Served over HTTPS with a valid cert.
- **No file extension** (`apple-app-site-association`, not `.json`).
- `Content-Type: application/json` is recommended; iOS accepts `application/pkcs7-mime` too but plain JSON is simpler.
- HTTP 200, no redirects.
- Maximum size: 128 KB.

### Verification commands

```bash
# Confirm the file is served and valid JSON
curl -sS https://app.trygrowthproject.com/.well-known/apple-app-site-association | jq .

# Apple's CDN (the AASA-CDN that iOS actually fetches from on device)
curl -sS "https://app-site-association.cdn-apple.com/a/v1/app.trygrowthproject.com" | jq .

# Apple's official validator (web UI):
#   https://branch.io/resources/aasa-validator/   (third-party but widely used)
#   https://search.developer.apple.com/appsearch-validation-tool/   (Apple)
```

On device, after install:

```bash
# Watch the swcd (shared web credentials daemon) log for AASA fetch results
log stream --predicate 'subsystem == "com.apple.swc"' --info
# Then tap https://app.trygrowthproject.com/join/SMOKE01 from Notes or Messages.
```

A successful verification logs `applinks: matched <URL>` and the app launches without Safari blinking.

---

## When to update these files

- **Apple Team ID change** (rare — only on org-level account migration): update both `appIDs` and `webcredentials`.
- **Bundle ID / package name change**: do not change. Both IDs are immutable post-launch.
- **Re-keying the Android app**: do not re-key. If Play Signing is ever rotated, the new SHA-256 must be **added** to `sha256_cert_fingerprints`, not replacing the old one, until all installed-base versions signed with the prior key are below 1% adoption.
- **Adding a new universal link path**: extend `components` in `apple-app-site-association` and add a corresponding `pathPrefix` to `app.json → expo.android.intentFilters`.

The matching `app.json` declarations are at:

- iOS: `expo.ios.associatedDomains: ["applinks:app.trygrowthproject.com"]`
- Android: `expo.android.intentFilters[*].data` entries for `https://app.trygrowthproject.com/join`
