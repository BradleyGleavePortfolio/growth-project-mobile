# 02 — Feature flag consumption

> Pre-build brief. Defines a single `useFlag()` contract every new feature in the expansion pack consumes, so we don't grow N bespoke gates as the surface area doubles.

## WHY

Today the app already loads PostHog (`App.tsx` mounts `PostHogProvider` when `EXPO_PUBLIC_POSTHOG_KEY` is set). It is plumbed for analytics events but **flag consumption is ad-hoc** — there is no `src/hooks/useFlag.ts`, no agreed convention for default values when PostHog is disabled, and no contract for what a flag means when offline.

The expansion features (#92 — items 5, 6, 8, 10, 11, 12, 14, 16, 18, 19, 20) are explicitly designed to be flag-gated. If each feature defines its own gate, we will:

- duplicate the "flag missing → default" branch logic per feature,
- have inconsistent behaviour offline (some features fail-open, some fail-closed),
- have no central log of what flags exist, who owns them, and when they expire.

A single consumption contract keeps every feature's gate readable, removable, and consistent.

## WHEN

Land this brief before the **first flag-gated feature** from the expansion pack starts implementation. That is currently #92's item 5 (weekly check-ins client). Until that feature begins, the brief is aspirational; the moment it begins, the brief becomes the contract that PR follows.

## WHERE

When implemented (not in this PR):

- `src/hooks/useFlag.ts` (new) — the public hook.
- `src/lib/flags.ts` (new) — the flag registry: a single TypeScript object that lists every flag name, its default, its owner, its expected expiry, and a one-line description.
- `src/__tests__/useFlag.test.tsx` (new) — unit tests for the four flag states (enabled / disabled / loading / posthog-disabled).
- `src/components/FlagGate.tsx` (new, optional) — declarative wrapper for screens whose entire body is gated.
- `App.tsx` — no change to PostHog provider mounting; the hook reads the same client.
- `docs/HANDOFF.md` — gets a small new section pointing at `src/lib/flags.ts` as the registry.

## WHO

- **Mobile engineer** consuming a flag: imports `useFlag('flag-name')`. Never reads `posthog.getFeatureFlag` directly.
- **Mobile lead**: reviews additions to `src/lib/flags.ts`. A new flag without a registry entry is a CR block.
- **Operator/PM**: defines the flag in PostHog (UI dashboard) before the registry entry is added.

## WHAT

A four-state hook signature:

```ts
type FlagState =
  | { status: 'enabled'; payload?: unknown }
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'unavailable' }; // PostHog disabled (no key) or never loaded

function useFlag(name: FlagName): FlagState;
```

`FlagName` is a TypeScript union derived from the registry, so a typo is a compile error.

A registry entry:

```ts
// src/lib/flags.ts
export const flags = {
  'weekly-checkins-client': {
    default: false,
    owner: 'mobile',
    description: 'Gates the client-side weekly check-in screen (#92 item 5).',
    expires: '2026-09-30',
  },
  // ...
} as const;
```

The `default` value is what `useFlag` returns when status would otherwise be `unavailable` (no PostHog key, offline before first load, evaluation failed). It is **always boolean** — payloads are an explicit second feature and are not consumed by default.

The `expires` field is a soft deadline. CI does not fail when a flag is past its expiry, but `npm run flags:audit` (a new script) prints a warning. A flag should be removed (along with the now-unconditional code) by its expiry — long-lived flags are a maintenance smell.

## HOW

1. Add `src/lib/flags.ts` with one or two seed entries (real ones from the expansion pack — `weekly-checkins-client`, `ai-voice-tone`).
2. Add `src/hooks/useFlag.ts`:
   - Reads `usePostHog()` from `posthog-react-native`.
   - Returns `{ status: 'unavailable' }` if `posthog` is null (no key).
   - Returns `{ status: 'loading' }` until PostHog has finished its first `reloadFeatureFlags()`.
   - Maps `posthog.isFeatureEnabled(name)` to `enabled` / `disabled`.
   - Falls back to the registry default if PostHog throws.
3. Add `src/components/FlagGate.tsx` for the common "render `<Children>` if enabled, render nothing or a fallback otherwise" pattern.
4. Add unit tests covering all four states and the registry-default fallback.
5. Add `npm run flags:audit` (script under `scripts/flags-audit.js`) that scans the registry for expired entries.
6. Document the contract in `docs/HANDOFF.md` and link this brief.

## Expo / EAS considerations

- PostHog is already an Expo-compatible managed-workflow library; no native config changes needed.
- Flags **must not** be embedded into the native bundle via `expo-constants` — that defeats the point. They live in PostHog and refresh at runtime.
- A flag that controls a code path requiring a native module (none exist in the current expansion pack, but in principle) is out of scope for this contract — those code paths must live behind a build-time `Platform`/`__DEV__` check, not a runtime flag.
- Build profiles (`development` / `preview` / `production`) get separate PostHog projects so a `production` flag rollout cannot leak into a `preview` build. PostHog project IDs differ per env, fed through `EXPO_PUBLIC_POSTHOG_KEY`. (See [`03-experiment-and-update-channels.md`](./03-experiment-and-update-channels.md) for the channel boundary.)

## Acceptance criteria

- `useFlag('weekly-checkins-client')` returns `{ status: 'unavailable' }` in tests where PostHog is disabled.
- A flag name not in the registry causes a TypeScript compile error at the call site.
- `FlagGate` correctly renders children when enabled, fallback otherwise; renders fallback while loading by default (configurable).
- `npm run flags:audit` exits 0 with no expired flags, exits 1 with a clear message when one is past its expiry.
- The registry has at least the two seed entries listed above and a README block at the top of `flags.ts` explaining the convention.

## Rollout strategy

- **Phase 1**: ship the hook + registry + audit script, behind no flag (it is itself the flag system).
- **Phase 2**: first feature consumer migrates to it.
- **Phase 3**: any pre-existing ad-hoc flag check (none exist today, but if any sneak in before this brief lands) is rewritten to use the hook.
- Rollback: revert the PR. No data loss; flags continue to live in PostHog regardless.

## Tests

- Unit: the four-state matrix above + the registry-default fallback when PostHog throws.
- Component: `FlagGate` with `enabled`, `disabled`, `loading`, `unavailable`.
- Audit: `npm run flags:audit` against a fixture registry with one expired and one fresh entry.
- Manual: open a build with a flag enabled in PostHog, force-quit, reopen offline — flag stays at last-known value, falls back to default after cache expiry.

## Risks

- **PostHog's first-load latency** can leave the UI in `loading` for longer than expected on cold start. Mitigation: registry default is what `FlagGate` shows during `loading` unless a feature explicitly opts to show a spinner.
- **Flag evaluation drift between web and mobile**: not in scope for this brief. We do not promise that web and mobile see the same flag value at the same moment; PostHog's per-platform refresh delay is acceptable.
- **Registry rot**: flags accumulate. The audit script + `expires` field address this only weakly. Hard mitigation is a quarterly mobile-lead review of the registry.

## Dependencies

- PostHog already mounted in `App.tsx`. No new dependency.
- No backend dependency. Flags are evaluated client-side via PostHog; the backend does not need to know.
- Cross-link with [`03-experiment-and-update-channels.md`](./03-experiment-and-update-channels.md) for the boundary between flags and experiments.
- Cross-link with [`08-crash-and-analytics-readiness.md`](./08-crash-and-analytics-readiness.md) for what gets emitted when a flag flips a feature.

## Operator handoff

- **Owning surface(s)**: `src/hooks/useFlag.ts`, `src/lib/flags.ts`, `src/components/FlagGate.tsx`, `scripts/flags-audit.js`.
- **Out-of-band steps**: define each new flag in PostHog → Feature Flags → New, with the exact name from the registry. Wire its rollout (% rollout, cohort, allow-list) in PostHog. Set the same name in the registry.
- **Done means**: an engineer can add a new gated feature by (a) adding one registry entry, (b) calling `useFlag(...)`, (c) defining the flag in PostHog. No bespoke gate code per feature.
