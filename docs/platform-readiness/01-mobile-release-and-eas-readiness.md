# 01 — Mobile release & EAS readiness

> Pre-build brief. Sets the rules a release captain follows so a build can move from `development` → `preview` → `production` without surprises. Implementation lives in EAS configuration, store consoles, and one or two scripts under `scripts/`. No runtime code is described here.

## WHY

Today the repo can produce a build (`eas.json` defines `development`, `preview`, `production`), and `PLAY_STORE_READINESS.md` covers Android signing + data-safety. What is **not** written down is the process glue:

- When does `version` / `buildNumber` / `versionCode` bump, and who bumps it.
- Which build profile a given commit targets and how that decision is recorded.
- Where the Apple + Google store-listing assets live, who owns them, and how they get refreshed without rebuilding the binary.
- How a release captain rolls back without losing user data when an EAS build ships a regression.
- Who has access to the signing keys, and what happens if that person leaves.

Without this written down, every release is a one-person tribal-knowledge event. The expansion features (#92) and the cross-cutting work in this pack will multiply release cadence; the unwritten parts have to become written before that cadence increases.

## WHEN

Land this brief before any of the following:

- The first non-Dependabot user-facing PR in the expansion pack (any of #92's items 5/6/8/10/11/12/14/16/18/19/20).
- The first build that wants to ship to TestFlight external testers.
- The first time more than one engineer touches `app.json` in the same week.

## WHERE

Files that will be touched when this brief becomes implementation work (not in this PR):

- `eas.json` — profile envs, possibly a new `staging` profile if §3 is adopted.
- `app.json` — `expo.version`, `expo.ios.buildNumber`, `expo.android.versionCode`. No other fields.
- `scripts/validate-app-config.js` — extended to fail when `versionCode` doesn't strictly increase against the value on `main`.
- `scripts/release-bump.sh` (new) — single command that bumps `version`, `buildNumber`, `versionCode` consistently.
- `docs/RELEASE_SMOKE.md` — kept in sync as the smoke list grows.
- `PLAY_STORE_READINESS.md` — Android-specific, already exists; this brief adds an iOS counterpart `docs/APP_STORE_READINESS.md` (new file).

Out of scope for this brief: any change to the source-map upload contract — that already works through `@sentry/react-native/expo` and `SENTRY_AUTH_TOKEN`.

## WHO

- **Release captain** (rotating role, typically the engineer who shipped the largest change in the cycle): owns the bump, the EAS build trigger, and the smoke run.
- **Mobile lead**: owns approving any change to `eas.json`, the bump script, or this doc.
- **Operator/PM**: owns store-listing copy, screenshots, what's-new strings; never edits `app.json` themselves.

## WHAT

Three artefacts come out of implementation:

1. **A versioning convention** documented under `## Versioning` below — semver for `expo.version`, monotonically increasing integers for `buildNumber` and `versionCode`, bumped by a single script.
2. **A release-channel definition** documented under `## Channels` — which EAS profile maps to which audience, how an audience is moved between profiles.
3. **An access ledger** documented under `## Custody` — who holds the App Store Connect key, who holds the Play upload key, where each is stored, and the rotation procedure when a holder leaves.

### Versioning

| Bump type | When | What changes |
| --- | --- | --- |
| Patch (`1.0.0` → `1.0.1`) | Bug-fix-only release. | `expo.version` minor segment. `buildNumber` + `versionCode` always +1. |
| Minor (`1.0.x` → `1.1.0`) | New user-visible feature, no breaking-flow change. | Same — version bump + integer +1. |
| Major (`1.x.y` → `2.0.0`) | Breaking onboarding or auth change. | Same. Plus a `docs/RELEASE_NOTES_2.0.md` written before submit. |

`buildNumber` (iOS) and `versionCode` (Android) bump on **every** EAS production build, even when the underlying `expo.version` does not. The validator (`scripts/validate-app-config.js --release`) fails the build when `versionCode` is not strictly greater than the value on `origin/main`.

### Channels

EAS today exposes three profiles: `development`, `preview`, `production`. The convention below maps profile → audience:

| Profile | Audience | Distribution |
| --- | --- | --- |
| `development` | Engineers on dev clients. | `internal`. APK on Android. |
| `preview` | Internal testers, contractors, the operator. | `internal`. APK on Android. Signed but not store-uploaded. |
| `production` | End users. | `store`. iOS via TestFlight → App Store; Android via Play Internal → Closed → Production tracks. |

A `staging` profile (between `preview` and `production`) is **considered but not adopted in this brief** — adopting it would require EAS env duplication and a fourth Sentry environment tag. The brief flags it as optional future work.

### Custody

Implementation of the ledger lives in a private location (1Password or the team's secret manager — never in the repo). What lives in the repo is the **policy**: the names of the keys, who currently holds each, and the rotation steps. No actual key material.

Keys to enumerate:

- Apple App Store Connect API key (`AuthKey_*.p8`).
- Apple Distribution certificate + provisioning profile.
- Google Play upload key (Android keystore + alias + password).
- Google Play API service-account JSON.
- Sentry org auth token (`SENTRY_AUTH_TOKEN` — already an EAS Secret).
- PostHog project API key (already public-by-design `EXPO_PUBLIC_POSTHOG_KEY`, but the personal-API-key for managing flags is private).

## HOW

1. Write `docs/APP_STORE_READINESS.md` modelled on `PLAY_STORE_READINESS.md` (iOS-side checklist).
2. Add `scripts/release-bump.sh` that takes one arg (`patch|minor|major`) and updates `app.json` + opens a commit. Validate: `npm run validate:config --release` passes after the bump.
3. Extend `scripts/validate-app-config.js` so `--release` fetches `origin/main` and asserts `versionCode > main.versionCode` and `buildNumber > main.buildNumber`. Fails CI with a clear error message if not.
4. Document `docs/RELEASE_PROCESS.md` (new) in the order: bump → validate → `eas build` → smoke → submit → tag git release. Cross-link `docs/RELEASE_SMOKE.md`.
5. Move the custody ledger to the secret manager and add a one-line entry to `docs/RELEASE_PROCESS.md` pointing at it.

Each of the five steps above is a separate PR. They are not bundled.

## Expo / EAS considerations

- `appVersionSource: "local"` is currently set in `eas.json`. The bump script must therefore live in the repo, not in the EAS dashboard. Switching to `appVersionSource: "remote"` is **explicitly out of scope** for this brief; revisit only after the bump script has been live for one full release cycle.
- Sentry release identifier is `<version>+<buildNumber|versionCode>` (see `src/services/sentry.ts`). The bump script must not introduce non-numeric characters into either field, or the Sentry release id will not match the uploaded source maps.
- `requireCommit: true` is set in `eas.json` — the bump script must create a commit, not leave a dirty tree.
- Adding a new EAS profile (e.g. `staging`) requires updating the env block, the validator, **and** the Sentry environment list. None of those are done in this brief.

## Acceptance criteria

- `docs/APP_STORE_READINESS.md` exists, mirrors `PLAY_STORE_READINESS.md` section-by-section.
- `scripts/release-bump.sh patch|minor|major` runs from a clean tree, produces a single commit, leaves the repo clean.
- `npm run validate:release` fails when `versionCode` did not increase. Tested by deliberately reverting the bump and confirming the script exits non-zero.
- `docs/RELEASE_PROCESS.md` lists the seven phases (bump, validate, build, smoke, submit, monitor, tag) and links the relevant existing docs.
- The custody ledger reference is committed (link only, no secret material).

## Rollout strategy

- **Phase 1**: Ship the docs (`APP_STORE_READINESS.md`, `RELEASE_PROCESS.md`) before any of the bump-script changes, so the rules exist before the tooling enforces them.
- **Phase 2**: Ship the bump script. Use it once for the next real release.
- **Phase 3**: Add the validator's `--release` mode. Make it advisory for one release, then required.
- Rollback plan: every step is reversible — revert the doc PRs, delete the script, revert the validator change.

## Tests

- Unit-ish: a small node test that runs `scripts/release-bump.sh patch` against a fixture `app.json` in a temp dir and asserts the post-state.
- Integration: a CI job that runs `npm run validate:release` against a synthesised "previous main" and asserts both pass and fail paths.
- Manual: one full release captain run-through, with the run logged as a checklist in the PR description.

## Risks

- **Drift between iOS and Android version numbers**: cured by bumping both in one script — the script must touch both fields atomically.
- **Validator becomes flaky if `origin/main` is shallow**: ensure CI fetches enough depth (`fetch-depth: 0` for the validator job) or the validator falls back gracefully and prints a warning.
- **`appVersionSource: "remote"` migration in the future will invalidate the bump script**: documented as a known trade-off; revisit after one release cycle.
- **Operator edits `app.json` directly** and forgets the bump: the `--release` validator catches this in CI.

## Dependencies

- None on backend PRs.
- Implicit dependency on `scripts/validate-app-config.js` staying the source of truth for `app.json` shape — see `docs/HANDOFF.md` §3.
- No dependency on the expansion pack briefs (#92).

## Operator handoff

- **Owning surface(s)**: `docs/RELEASE_PROCESS.md`, `docs/APP_STORE_READINESS.md`, `scripts/release-bump.sh`, `scripts/validate-app-config.js`.
- **Out-of-band steps**: create the App Store Connect API key (Apple Developer portal → Users and Access → Keys), upload the Play upload key to the team secret manager, share the bump-script invocation in the engineering handbook.
- **Done means**: a release captain who has never shipped this app before can take the bump-script + `RELEASE_PROCESS.md` and ship a build to TestFlight + Play Internal Testing without paging the mobile lead.
