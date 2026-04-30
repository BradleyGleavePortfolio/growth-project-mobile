# 03 — Experiment & update channels

> Pre-build brief. Defines how A/B experiments and over-the-air (OTA) updates — if and when adopted — share the same channel concept as builds, so an operator never has to reason about three different audience definitions.

## WHY

The mobile app today has three release audiences (`development` / `preview` / `production` per `eas.json`) and two telemetry projects (Sentry environment + PostHog project, both keyed off `EXPO_PUBLIC_ENVIRONMENT`). It does **not** have:

- A defined experiment audience boundary. If we run an A/B test inside `production`, what fraction of users sees variant B, and is that fraction stable across app reloads?
- An OTA-update audience boundary. Expo Updates is not currently enabled. If it is enabled later (e.g. for a hotfix without a store cycle), it will need to respect the same audience boundaries — and not, for instance, push a `preview` JS bundle to a `production` device.

The expansion pack (#92 — items 10, 11, 18 explicitly call out experimentation around AI surfaces, refs backend PR #117) will want to A/B test prompt/voice variants. Without a written-down audience model, every experiment becomes a separate ad-hoc decision.

## WHEN

Land this brief before:

- The first AI-voice / prompt-variant experiment goes live (#92 item 11).
- Any conversation about adopting `expo-updates` for OTA hotfixes.
- The first PostHog experiment (not just a flag) is configured.

## WHERE

If implemented (note the conditionals — OTA in particular may be deferred):

- `app.json` — `expo.updates` block would be added if OTA is adopted.
- `src/config/env.ts` — already centralises env reads; would gain a `CHANNEL` accessor.
- `src/lib/experiments.ts` (new) — thin wrapper around PostHog experiments that returns a stable variant per user.
- `docs/EXPERIMENTS_PLAYBOOK.md` (new) — the operator-facing doc on how to design an experiment that won't bias itself.
- `docs/OTA_POLICY.md` (new, optional) — if OTA is adopted, the policy that says what's allowed in an OTA payload (JS only, no native changes) and what is not.

## WHO

- **Mobile lead**: signs off on adopting OTA, on every experiment definition, and on the audience-fraction maths for any experiment that includes >5% of `production`.
- **Operator/PM**: writes the experiment hypothesis, defines the success metric in PostHog, owns the call to ship the winning variant.
- **Engineer**: implements the variant code paths behind `useFlag`/`useExperiment` and removes the loser after promotion.

## WHAT

Three concepts, made explicit:

1. **Build channel** — the audience the binary was built for: `development`, `preview`, `production`. Already exists. The source of truth is the EAS profile name baked into `EXPO_PUBLIC_ENVIRONMENT`. Used by Sentry + PostHog to keep events sorted.

2. **Experiment audience** — a subset of one build channel. Every experiment lives **inside** one channel; an experiment never spans channels. PostHog's experiments feature is the implementation. The contract: a variant assignment is sticky per `distinctId`, persists through restarts, and never changes for a user mid-experiment.

3. **Update channel** (only if OTA is adopted) — Expo Updates' channel concept. Maps 1:1 onto the build channel. A `production` device only ever pulls a `production` channel update. There is no cross-channel update.

A small TypeScript helper:

```ts
// src/lib/experiments.ts
type Variant = 'control' | 'a' | 'b';
function useExperiment(key: ExperimentName): {
  status: 'pending' | 'assigned' | 'unavailable';
  variant: Variant;
};
```

Like `useFlag`, the experiment names are a TS union from a registry (`src/lib/experiments.ts`).

## HOW

Two implementation tracks, decided independently:

**Track A — Experiments (recommended now):**
1. Add `src/lib/experiments.ts` registry + `useExperiment` hook.
2. Wire to PostHog `getFeatureFlagPayload` (PostHog represents experiment variants as payloaded flags).
3. Add `docs/EXPERIMENTS_PLAYBOOK.md` covering: hypothesis form, minimum sample size guidance, run length, ship-or-kill rule, post-mortem template.
4. First consumer: `#92 item 11` (AI voice/tone variants).

**Track B — OTA (deferred decision):**
1. Add `expo-updates` plugin.
2. Configure channels matching EAS profiles.
3. Write `docs/OTA_POLICY.md` listing what is allowed in an OTA payload (JS only, no native), what triggers a full rebuild instead, the rollback procedure (publish the previous bundle as the channel HEAD).
4. Wire a "channel + runtime version" stamp into the splash screen for QA visibility.

The brief recommends doing Track A first and revisiting Track B after one experiment cycle, when the team has felt the difference between "I want to push a JS-only fix today" and "I'm willing to wait for a store cycle".

## Expo / EAS considerations

- Adopting OTA means committing to a `runtimeVersion` policy in `app.json`. The simplest is `"runtimeVersion": { "policy": "appVersion" }`, which guarantees an OTA only reaches devices on a matching `expo.version`. This protects against pushing JS that depends on a native change the device doesn't have.
- `expo-updates` adds ~1 MB to the bundle. Acceptable.
- `expo-updates` requires `EXPO_UPDATES_URL` configuration — handled automatically when EAS is the host.
- Sentry release identifier (`<version>+<buildNumber|versionCode>`, see `src/services/sentry.ts`) does not change for an OTA update — meaning a JS-only crash post-OTA will look like it came from the original native build. Mitigation: include the OTA update id as a Sentry tag if/when adopted. Documented as a known issue in `docs/OTA_POLICY.md`.
- Experiments do not require any Expo/EAS change — they ride PostHog at runtime.

## Acceptance criteria

- `useExperiment('voice-tone-v1')` returns a sticky variant per `distinctId`, surviving app restart and offline cold start (after one online evaluation).
- `EXPERIMENTS_PLAYBOOK.md` is concrete enough that a PM can write a hypothesis + success metric without a 1:1 with the mobile lead.
- The experiment registry has at least one seed entry; a typo is a compile error.
- If OTA is adopted: a `production` device cannot pull a `preview` bundle (verified by deliberately mismatching channel names and confirming the device does not update).
- If OTA is adopted: the `OTA_POLICY.md` file lists at least the allowed (JS, asset) and disallowed (native module add/remove, `app.json` change) payload types.

## Rollout strategy

- **Phase 1 (Track A)**: ship registry + hook + playbook. Run one experiment with a small audience (e.g. 20% of internal `preview` users) before any `production` experiment.
- **Phase 2 (Track A)**: first `production` experiment. Document outcomes.
- **Phase 3 (Track B, optional)**: add `expo-updates`. First OTA is a no-op cosmetic change pushed to `preview` only, to validate plumbing.
- **Phase 4 (Track B)**: first `production` OTA. Only after one full preview cycle.
- Rollback: experiments are killed in PostHog. OTA adoption is reversible by removing the plugin and shipping a fresh native build.

## Tests

- Unit: `useExperiment` returns the registry default when PostHog is unavailable; assignment is sticky across two consecutive calls.
- Manual (Track A): turn on an experiment for an internal cohort, force-quit, reopen — variant unchanged.
- Manual (Track B): cross-channel update test (publish to `preview`, install `production` build, confirm no update).

## Risks

- **Experiment leakage between channels**: prevented by per-channel PostHog projects (already in `EXPO_PUBLIC_ENVIRONMENT`).
- **OTA bricking devices**: mitigated by `runtimeVersion: appVersion` and a documented rollback (publish the previous bundle as channel HEAD).
- **Experiment-driven test breakage**: tests that hit `useExperiment` need to inject a deterministic variant. Provide a `__test__` helper in `src/lib/experiments.ts`.
- **Sample-size confusion**: the playbook must say a minimum cohort size, otherwise every experiment will be underpowered. Use PostHog's built-in calculator and quote it.

## Dependencies

- PostHog (already integrated). Flag-evaluation contract from [`02-feature-flag-consumption.md`](./02-feature-flag-consumption.md).
- Backend PR **#117** (AI program builder) is the source of the AI surfaces being experimented on. The mobile-side experiment runner is independent of #117 — an experiment can wrap any code path, not just LLM ones.
- Build-channel definition from [`01-mobile-release-and-eas-readiness.md`](./01-mobile-release-and-eas-readiness.md).

## Operator handoff

- **Owning surface(s)**: `src/lib/experiments.ts`, `src/hooks/useExperiment.ts`, `docs/EXPERIMENTS_PLAYBOOK.md`, optionally `app.json` (`expo.updates`) and `docs/OTA_POLICY.md`.
- **Out-of-band steps**: define the experiment in PostHog (Experiments tab, not Flags), set traffic allocation, set primary metric. For OTA adoption only: register the project with `eas update`, configure Sentry to ingest update-id tags.
- **Done means** (Track A): a PM can launch an experiment by (a) adding a registry entry, (b) defining the experiment in PostHog with the same key, (c) the consuming engineer wraps the code path with `useExperiment`.
- **Done means** (Track B): a release captain can publish a JS-only hotfix without a store cycle by running `eas update --channel production`, with rollback well-rehearsed.
