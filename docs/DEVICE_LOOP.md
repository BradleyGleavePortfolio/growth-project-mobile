# Device loop

`.github/workflows/device-loop.yml` keeps one internal TestFlight build of mobile `main` current. It is the device proof for UI
work (web renders are previews only). The `testing` build is the production build (same flags, `production` EAS environment,
production backend, live Stripe) on its own update channel, `testing`, which no production binary reads.

## What runs when

On every push to `main`, daily at 11:23 UTC, and on Actions → Device loop → Run workflow. Never on pull requests; runs never
overlap (one concurrency group). Only `main` is built or published: Run workflow from any other branch skips the loop job.
The workflow and the update guard run the same pinned eas-cli (`eas-version` in the workflow, `EAS_CLI` in
`scripts/eas-update-guard.js`); bump both together (`scripts/__tests__/deviceLoop.test.js` fails otherwise).

1. No `EXPO_TOKEN` repository secret: the run skips with the notice "Device loop skipped". Nothing fails.
2. Otherwise it computes the iOS fingerprint of the `testing` profile (`eas fingerprint:generate --platform ios --build-profile
   testing`) and reads the latest 50 testing iOS builds:

| Testing builds | What the run does |
|---|---|
| One with this fingerprint is finished or still building | publishes the commit to channel `testing` through the update guard (`npm run update:publish -- --channel testing --environment production`, docs/OTA_UPDATES.md) |
| Another one is still building | nothing; the next push or daily run builds the new fingerprint |
| One with this fingerprint failed or was canceled | on a push: nothing (warning "build failed"); the daily run or Run workflow builds it again |
| 10 started in the last 31 days | nothing (warning); a build ages out after 31 days |
| None of the above | `eas build --profile testing --platform ios --non-interactive --auto-submit --no-wait`: EAS builds, then submits to TestFlight |

`submit.testing` extends `submit.production` (the same App Store Connect app). The build goes to TestFlight only: no external
group and no App Review.

## Version numbers

App Store Connect wants the build numbers of one version unique and rising. A testing build under app.json's `1.0.0` would take
a production build number or block the next one, so the EAS post-install hook (`scripts/eas-testing-version.js`) gives every
testing iOS build its own TestFlight version, `99.0.0` (an upload must be above the last approved store version), and a build
number of whole minutes since 1970 UTC (`29869410` at 2026-10-16 15:30). Production builds keep app.json's version and
`ios.buildNumber`; the hook returns at once for them. It edits only the generated `ios/` folder, which the fingerprint ignores.
expo.dev still lists testing builds under app.json's numbers; TestFlight shows the real ones. Never pick a `99.0.0` build for
App Review.

## Reading the results

- GitHub → Actions → Device loop → the run: the annotation names the fingerprint and the path taken (update, build, waiting,
  build limit, skipped). A red run names the failing step; the update guard's refusal lines name the fix.
- Builds and submissions: expo.dev → the-growth-project → tgp-health-and-wellness → Builds (profile `testing`).
- Updates: expo.dev → the same project → Updates → channel `testing`. On the phone an update downloads on one launch and applies
  on the next cold start.
- TestFlight: version 99.0.0; internal testers install the newest build. It is the same app as the App Store one, so it
  replaces it on that phone (reinstall from the App Store to go back). A failed submission leaves the build on expo.dev only
  (later runs still send it updates): fix the cause shown there, then `eas submit --profile testing --platform ios --id
  <build id>`.

## The EAS Free build limit

EAS Free allows 15 iOS builds a month and cannot be charged overage: once they are used, no iOS build starts, store builds
included, until the allowance resets. JavaScript-only changes cost no build (they ship as updates). The loop starts a build
only when no finished or running testing build has the fingerprint, never while another testing build runs, and at most 10 in
any 31 days (`MAX_TESTING_BUILDS` in the workflow; manual testing builds count too), so at least 5 of every month's 15 stay for
the other profiles, store builds first. A failed or canceled testing build is retried only by the daily run or Run workflow,
never by a push, so a build that fails every time costs one build a day (plus any manual run), not one per merge. The
fingerprint covers the native inputs: dependencies, app config, config plugins, `eas.json` (any profile: a flag change there
costs a testing build), `package.json` scripts and `src/config/purchaseSurfaces.ts`. Check usage with `eas account:usage the-growth-project`.

## Before the first run (operator)

1. Repository secret `EXPO_TOKEN`: an Expo access token for the `the-growth-project` account (Settings → Secrets and variables
   → Actions).
2. EAS `production` environment: the variables in docs/OTA_UPDATES.md ("Build env vs update env"), including
   `SENTRY_AUTH_TOKEN` as `sensitive`. The guard refuses an update without them.
3. EAS Submit needs an App Store Connect API key stored in EAS (`eas credentials`) to submit without prompting; TestFlight
   needs an internal group with automatic distribution.
4. Merging to main starts the first run (EXPO_TOKEN is already set), so finish steps 2 and 3 first. On EAS Free one build runs
   at a time, so a testing build queued first delays a store build behind it.

## Turning it off

Actions → Device loop → ⋯ → Disable workflow (Enable workflow turns it back on). Deleting the `EXPO_TOKEN` secret also stops it:
every run then skips with a notice.
