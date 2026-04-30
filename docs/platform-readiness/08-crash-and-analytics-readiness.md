# 08 — Crash & analytics readiness

> Pre-build brief. Sets the conventions for Sentry + PostHog usage so every expansion-pack feature reports the right events with consistent properties, and so PII/PHI never leaks.

## WHY

Sentry and PostHog are both wired up (`src/services/sentry.ts`, `App.tsx`). What is **not** standardised:

- The catalogue of analytic events the next features should emit, and their property schemas.
- The redaction rules for what cannot leave the device (food log entries, weight, body measurements, free-text from the AI chat).
- The opt-out path the user takes if they want analytics off — currently the app respects PostHog being absent (no key) but does not expose a per-user opt-out.
- The crash-context conventions — what tags Sentry events should carry (`role`, `screen`, `feature_flag.X`).

The expansion features include sensitive surfaces (#92 item 5: weekly check-ins; #92 item 11: AI voice/tone editor). Without redaction rules and an event schema, two failure modes are likely:

- Analytics is so cautious that no useful behavioural insight comes out, so PMs ignore it.
- Analytics is so verbose that PHI ends up in PostHog logs, which is a compliance issue.

## WHEN

Land this brief before the first analytics-instrumented expansion feature ships. That is currently #92 item 5 (the first one with a meaningful client journey to instrument).

## WHERE

When implemented:

- `src/lib/analytics.ts` (new) — typed wrapper over PostHog `capture()`, with the event registry.
- `src/lib/analytics/events.ts` (new) — event name + properties registry.
- `src/services/sentry.ts` — extended to attach standard tags from a single context source.
- `src/lib/analytics/redaction.ts` (new) — the redaction allow-list / deny-list.
- `docs/ANALYTICS_PLAYBOOK.md` (new) — the rules a PM/engineer reads before adding an event.
- A user-facing settings toggle "Help us improve the app" lives under Settings (the More stack) — wires up to `posthog.optOut()`.

## WHO

- **Engineer**: emits events via `track('event-name', props)`. Never calls PostHog directly. Never includes free-text user content.
- **Mobile lead**: reviews additions to the event registry. New events without a registry entry are CR blocks.
- **Operator/PM**: defines the event hypothesis ("we want to know X about Y"), names the event, names the properties, in PostHog dashboard before the registry entry is added.
- **Compliance/legal** (when relevant): reviews the redaction list at least once per quarter.

## WHAT

Three artefacts:

### 1. Event registry

```ts
// src/lib/analytics/events.ts
export const events = {
  'checkin.client.opened': {
    properties: { source: ['home', 'tab', 'deeplink'] as const },
    description: 'Client opened the weekly check-in screen.',
    pii: false,
  },
  'checkin.client.submitted': {
    properties: { metricsCount: 'number', sentiment: ['low', 'neutral', 'high'] as const },
    description: 'Client submitted a check-in. Free-text field is NOT sent.',
    pii: false,
  },
  // ...
} as const;
```

`track()` is typed against this registry. Wrong event name = compile error. Wrong property = compile error.

### 2. Redaction rules

A short list of what **never** leaves the device:

- Free-text from any user input (notes, messages, AI prompts, recipe customisations).
- Numeric body measurements (weight, body fat %).
- Food log items (specific foods).
- Coach notes about clients.
- Email addresses (already not sent — Supabase user id is the analytics key).

What is allowed (and useful):

- Screen names, navigation transitions.
- Feature flags evaluated for the user.
- Counts (e.g. "client logged 3 meals today").
- Timing (e.g. "onboarding step 4 took 12s").
- Aggregates (e.g. "weight delta bucket: -2 to +2 kg").

The allow-list / deny-list lives in `src/lib/analytics/redaction.ts` as a helper used by `track()`. A property name on the deny-list throws in `__DEV__` and is silently dropped in production (with a Sentry breadcrumb saying so).

### 3. Sentry tags

Every Sentry event carries:

- `role` — current user role (`coach` / `student` / etc — see [brief 04](./04-role-based-navigation-architecture.md)).
- `screen` — current navigation route name.
- `flag.<name>` — for any flag that materially affects the screen (e.g. `flag.team-mode = enabled`).
- `app_version`, `build_number` — already attached by `@sentry/react-native`.

A `setSentryUserContext()` helper in `src/services/sentry.ts` sets these once per role/screen change.

## HOW

1. Build the registry + typed `track()`.
2. Add the redaction helper + dev-mode throw.
3. Wire `setSentryUserContext()` to the auth state machine + the navigation focus event.
4. Add the user-facing opt-out toggle under Settings → "Help improve the app".
5. Write `docs/ANALYTICS_PLAYBOOK.md` covering: how to propose a new event, the property naming rules (snake_case, no PII), the dashboard handoff to the PM.
6. Migrate any existing `posthog.capture()` calls (if any) to `track()`.

## Expo / EAS considerations

- PostHog and Sentry are already config-plugin-installed for EAS (see `app.json`). No new native config.
- Sentry source-map upload depends on `SENTRY_AUTH_TOKEN` (an EAS Secret per `README.md`). No change needed for crash readiness, but verify it's still set before relying on Sentry stack traces.
- Opt-out persistence uses AsyncStorage; tested across cold start.
- Bundle size: the typed registry is dead-stripped in production builds.

## Acceptance criteria

- `track('event-name', props)` is the only call site path. A grep for `posthog.capture(` in `src/screens/` returns zero.
- Event names not in the registry are TypeScript errors.
- Property names on the deny-list throw in `__DEV__`.
- Sentry events tagged with `role`, `screen`, and at least one `flag.*` when relevant.
- A user-facing opt-out exists in Settings; toggling it calls `posthog.optOut()` and hides the toggle's confirmation copy until next launch.
- `docs/ANALYTICS_PLAYBOOK.md` exists and is self-contained enough that a PM can propose an event without help.

## Rollout strategy

- **Phase 1**: ship registry + `track()` + redaction. No new events emitted yet.
- **Phase 2**: instrument one screen (proposed: HomeScreen) as the canonical example.
- **Phase 3**: each expansion feature adds its events as part of its PR.
- **Phase 4**: opt-out toggle + the docs go live.
- Rollback: registry/track is a tooling layer; reverting it is one PR, no data is lost.

## Tests

- Unit (`analytics.test.ts`): `track()` rejects an unknown event; rejects an unknown property; calls `posthog.capture` with redacted output for deny-listed properties; no-ops if PostHog absent.
- Unit (`sentry.test.ts`): `setSentryUserContext()` sets the right tags.
- Manual: opt out → emit an event → confirm nothing reaches PostHog (use the PostHog dashboard's live events view).

## Risks

- **PHI leakage via free-text properties**: deny-list throws in dev; review at code-review time.
- **Event name collision with backend events**: prefix every mobile event with the feature domain (e.g. `checkin.*`, `coach.*`).
- **Opt-out doesn't persist**: AsyncStorage failure mode; mitigated by reading the toggle on app boot before PostHog initialises.
- **Sentry tag cardinality blow-up** if a tag value is unbounded (e.g. raw URLs): the standard tag list is closed; new tags need lead approval.

## Dependencies

- [`02-feature-flag-consumption.md`](./02-feature-flag-consumption.md) — flag evaluations are a Sentry tag.
- [`04-role-based-navigation-architecture.md`](./04-role-based-navigation-architecture.md) — `role` tag source.
- Sentry + PostHog already integrated; no new packages.
- No backend dependency.

## Operator handoff

- **Owning surface(s)**: `src/lib/analytics.ts`, `src/lib/analytics/events.ts`, `src/lib/analytics/redaction.ts`, `src/services/sentry.ts`, `docs/ANALYTICS_PLAYBOOK.md`, `src/screens/client/SettingsScreen.tsx` (opt-out toggle).
- **Out-of-band steps**: define every event in PostHog → Insights with the same name; configure dashboards. Verify Sentry projects per env (`development`, `preview`, `production`) ingest stack traces correctly.
- **Done means**: an engineer adds a new event by (a) adding a registry entry, (b) calling `track()`, (c) confirming the event lands in PostHog under the right environment. PHI does not leave the device.
