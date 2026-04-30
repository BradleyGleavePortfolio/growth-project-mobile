# 10 — Mobile QA matrix

> Pre-build brief. Defines the device × OS × build-profile × persona grid every release ticks before promotion to TestFlight external / Play Closed Testing / Production.

## WHY

`docs/RELEASE_SMOKE.md` and `scripts/release-smoke.sh` cover smoke checks for an Android build. There is no equivalent for iOS, no persona coverage matrix (coach vs student vs onboarding), and no "this device is what we test on" list. The expansion features add coach-facing surfaces; ungated coach bugs that escape to production are worse than client bugs because there are far fewer coaches and they are louder.

A written matrix:

- Sets a floor for what gets exercised before a release ships.
- Makes it visible which device classes we **don't** test on, so a regression on a Pixel 5 isn't a surprise the morning of launch.
- Gives a release captain a checklist instead of a vague "test the app".

## WHEN

Land this brief before the first expansion-pack feature reaches `production`. It is also a sensible retrofit even without expansion features — but the expansion pack increases surface area, which makes the case more urgent.

## WHERE

When implemented:

- `docs/QA_MATRIX.md` (new) — the canonical grid.
- `docs/RELEASE_SMOKE.md` — extended to reference the matrix and add the iOS-side checks.
- `scripts/release-smoke.sh` — kept as Android-side automation; an `scripts/release-smoke-ios.sh` (new) for the iOS subset that can be automated.
- `.github/pull_request_template.md` — release-candidate PRs link to a filled-in matrix.

## WHO

- **Release captain**: fills in the matrix per release. A release does not ship without a green matrix.
- **Mobile lead**: extends the matrix when a new persona / device class becomes relevant (e.g. tablet support graduates).
- **Operator/QA contractor** (when budgeted): runs the manual cells the captain doesn't have devices for.

## WHAT

### Axes

- **Device class**: iPhone (current iOS major - 2 to current), iPad (smallest + biggest), Pixel (current Android major - 2 to current), Samsung (one mid-range), low-end Android (one).
- **OS version**: minimum supported (SDK ~55 → iOS 15 / Android 7+ effective; verify against Expo SDK matrix), latest GA, latest beta.
- **Build profile**: `preview`, `production`.
- **Persona**: anonymous (welcome), onboarding-in-progress, client (student), coach (single-coach), coach (head/team — once #118 lands, see [brief 04](./04-role-based-navigation-architecture.md)), invited-via-deeplink.
- **Network**: full, throttled (3G), offline (after warm cache), airplane → online transition.
- **Accessibility**: VoiceOver/TalkBack, Dynamic Type at largest, Reduce Motion on.

### Cells

The matrix is not the cartesian product (that's hundreds of cells). Instead, mark each cell as:

- **Required** — every release.
- **Risk-based** — included when the release touches the cell's domain (e.g. accessibility cells when a new screen lands, deep-link cells when [brief 11](./11-deep-links-readiness.md) work ships).
- **Aspirational** — best-effort; failure here doesn't block.

### Required floor (suggested)

| Cell | Outcome |
| --- | --- |
| iPhone (current major) on `production`, client persona | Sign in, log a meal, view home, sign out. |
| iPhone (current major) on `production`, coach persona | Sign in, view client list, open a client. |
| iPhone (oldest supported) on `production`, client persona | Cold start < 4 s; same flow as above. |
| Pixel (current major) on `production`, client persona | Same as iPhone client. |
| Pixel (current major) on `production`, coach persona | Same as iPhone coach. |
| iPhone, airplane → online, client persona | Cached data shows; refetch resumes when online. |
| iPhone, deep-link `tgp://join/<code>` from a fresh install | Lands on Create Account with prefilled code. |
| iPhone, VoiceOver, home flow | Reading order makes sense; CTA reachable. |

That is eight required cells. Risk-based cells are added per release based on what changed.

## HOW

1. Write `docs/QA_MATRIX.md` with the axes + the required floor + the risk-based cells.
2. Extend `docs/RELEASE_SMOKE.md` to include iOS subset (currently Android-only) and the deep-link smoke.
3. Add `scripts/release-smoke-ios.sh` (light — a few `xcrun simctl` invocations to validate URL schemes and screenshots).
4. Update the PR template to require a link to the matrix for release-candidate PRs.
5. Document the matrix-fill workflow: the release captain duplicates the template per release into `docs/release-history/<version>.md`.

## Expo / EAS considerations

- iOS oldest-supported is bounded by Expo SDK 55 (currently iOS 15). Mark this in the matrix; bumping it is a separate decision.
- Android oldest-supported similarly bounded by Expo SDK 55 (Android 7 — minSdkVersion 24). Note in the matrix.
- `preview` and `production` profiles differ in `EXPO_PUBLIC_ENVIRONMENT` only (and Sentry/PostHog projects). Coverage for both ensures we catch env-key drift early.
- `expo-dev-client` is implicit for `development` builds; not in the matrix because dev builds don't ship.
- For tablet QA, `supportsTablet: true` is set in `app.json`; iPad coverage in the matrix is a one-cell aspirational item until tablet UX is explicitly designed.

## Acceptance criteria

- `docs/QA_MATRIX.md` exists with the axes and the required floor.
- `docs/RELEASE_SMOKE.md` references it and covers iOS-side checks.
- A `docs/release-history/` directory exists with at least one filled-in template (the next real release).
- The PR template lists a checkbox: "Release-candidate? Linked to a filled QA matrix in `docs/release-history/`."
- `scripts/release-smoke-ios.sh` is in the repo and runnable on a Mac with Xcode.

## Rollout strategy

- **Phase 1**: ship the matrix doc + the PR-template change.
- **Phase 2**: first release captain fills it in for the next release.
- **Phase 3**: the iOS smoke script lands and the Android one is updated to match.
- **Phase 4**: matrix becomes a hard release gate.
- Rollback: docs revert independently; nothing runtime-affecting.

## Tests

- Most cells are manual by nature.
- Automatable subset:
  - Cold-start time on a simulator (script) — `< 4 s` from launch to first interactive frame. Stretches as content grows.
  - Deep-link entry — `xcrun simctl openurl` and `adb shell am start` invocations validate the URL routes to the right screen.
  - VoiceOver / TalkBack lints — render-test fixtures (per [brief 06](./06-accessibility-readiness.md)).
- Manual cells filled by the captain or the operator.

## Risks

- **Captain time cost** — running the matrix takes hours. Mitigation: keep the required floor small; risk-based cells scoped by what changed.
- **Device-availability gap** — we don't always have an oldest-iPhone on hand. Mitigation: simulator/emulator coverage for those cells; mark the cell explicitly as "simulator" in the filled template.
- **Aspirational cells become "skip everything not required"** — guard against this by reviewing one risk-based cell at a time in CR.

## Dependencies

- [`01-mobile-release-and-eas-readiness.md`](./01-mobile-release-and-eas-readiness.md) — release process is the parent; the matrix is a step inside that process.
- [`06-accessibility-readiness.md`](./06-accessibility-readiness.md) — accessibility cells reference its bar.
- [`11-deep-links-readiness.md`](./11-deep-links-readiness.md) — deep-link cells reference its routes.
- No backend dependency.

## Operator handoff

- **Owning surface(s)**: `docs/QA_MATRIX.md`, `docs/RELEASE_SMOKE.md`, `docs/release-history/<version>.md` (per release), `scripts/release-smoke-ios.sh`.
- **Out-of-band steps**: assemble a small physical-device pool (one iPhone, one Pixel, one mid-range Samsung); document where it lives; document who has access. Budget for one rented session per release if devices are unavailable.
- **Done means**: a release captain reads `docs/QA_MATRIX.md`, fills the template, ticks the floor, executes risk-based cells based on the diff, ships when green.
