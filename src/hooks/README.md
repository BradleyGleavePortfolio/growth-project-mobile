# Hooks

React hooks shared across screens. Two flavours: thin `useQuery` / `useMutation` wrappers around `services/api` (the React Query layer) and small platform / state hooks that screens lean on.

## Purpose

- Centralise data-fetching with consistent cache keys, stale times, and invalidation rules — the rules of engagement live in `useApi.ts`.
- Read the current authenticated user from AsyncStorage and keep Sentry user binding in sync.
- Surface platform state (network connectivity, haptic press feedback) as ergonomic hooks.
- Wrap one-off backend reads (founding rank, circle stats, identity, settings, preferences) with sensible "fail closed" semantics so a network blip never crashes a screen.

## Key files

### Auth and identity

| File | What it does |
| --- | --- |
| `useCurrentUser.ts` | Reads `user_data` from AsyncStorage. Listens to `authEvents` so logout / login re-runs the read. Tags Sentry with the user id. |
| `useIdentity.ts` | `useFoundingNumber` and `useCircleStats` — both degrade to `null` data on any failure. |
| `useSettings.ts` | Generic settings hook backed by AsyncStorage. |
| `usePreferences.ts` | Reads / writes the `/users/me/preferences` surface (Psych #4 personalisation toggles). |

### React Query layer

| File | What it does |
| --- | --- |
| `useApi.ts` | The big one — every backend-backed feature has a hook here. Convention: `['feature', 'sub', ...args]` query keys; mutations invalidate the broadest reasonable prefix. Migrated from local-SQLite-direct calls under Fix #2. |
| `useClientData.ts` | Aggregated client-side reads used by Home / Progress screens. |
| `useCoachData.ts` | Aggregated coach-side reads used by ClientDetail / Dashboard. |

### Logging helpers

| File | What it does |
| --- | --- |
| `useFoodBrowse.ts` | "Recent" and "frequent" food rows for the Log search modal — derived from `logApi.getDaily`. Keeps state local to the hook. |
| `useMacroTargets.ts` | Resolves the current user's macro targets (profile + override). |

### Platform

| File | What it does |
| --- | --- |
| `useNetworkStatus.ts` | NetInfo wrapper + `isEffectivelyOnline` helper. Source of truth for `OfflineBanner` and the food-log queue flush. |
| `usePressFeedback.ts` | Animated press feedback (scale + opacity) for taps that don't otherwise haptic. |
| `useFirstWinCelebration.ts` | One-shot orchestrator for the first-win modal — locks behind AsyncStorage so it only ever shows once. |

## Data flow

```
useCurrentUser()
   ├─ AsyncStorage('user_data')
   ├─ setSentryUser({ id, email })
   └─ authEvents.on('logout' | 'login') ─► re-read

useApi hooks
   ├─ services/api.<surface>.<method>()
   └─ services/queryClient (shared QueryClient)

useNetworkStatus()
   ├─ NetInfo.fetch() once
   └─ NetInfo.addEventListener
```

The query keys in `useApi.ts` are part of the public contract — invalidations from screens depend on them. If you change a key shape, update both the `useQuery` and the `invalidateQueries` callers in the same change.

## App-store / deep-link dependencies

None. Hooks are runtime-only.

## Security and tenancy

- `useCurrentUser` is the only place screens read identity from. The id is consumed by local storage keys (chat history, fasting history) and is **not** sent as a parameter to backend calls — the backend re-derives identity from the JWT.
- `useIdentity` swallows all errors and returns `null`. This is deliberate: the founding badge should never crash a screen because of a flaky network.
- React Query is configured with no focus refetch and a 30 s stale window (`services/queryClient`). A user who has just signed out and signed back in will see the fresh user's data on the next focus, not stale cached rows — `clientStore.reset` and `coachStore.reset` are paired with sign-out.

## Environment variables

None directly. Hooks call `services/api`, which is the env-aware layer.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| `useCurrentUser` returns `null` after sign-in | Sign-in path didn't write `user_data`, or `authEvents.emit('login')` did not fire | The Login / Google paths both write `user_data` before navigating. If the hook stays `null`, check that the writer is awaited. |
| `useNetworkStatus` flickers between online/offline | NetInfo emits a brief "no internet" during VPN handoff | Treat `isInternetReachable: null` as online (the helper does). |
| Founding badge missing after a successful fetch | `useFoundingNumber` returned `null` due to a 404/401 | Expected when the user is brand new and the rank hasn't been computed yet — the badge renders nothing. |
| First-win celebration repeats | `useFirstWinCelebration` failed to write the AsyncStorage flag | The flag key is `first_win_celebrated_<userId>`; clearing it re-triggers the modal on next qualifying log. |

## Tests

```bash
npm test
```

`hooks/__tests__/` contains unit tests for the pure-data hooks (week math, macro target derivation). React Query hooks are exercised through screen tests where present.

## Release notes

- `useApi.ts` is the migration boundary from the old local-SQLite-direct era to the API-first model. New features should add a hook here rather than calling `services/api` directly from a screen — that keeps cache invalidation consistent.
- The query key shape `['feature', 'sub', ...args]` is convention, not enforcement. Mutations use `queryClient.invalidateQueries({ queryKey: ['feature'] })` — a broader prefix than the list query, so both list and detail refetch.
- `useCurrentUser` writes to Sentry on every read. If a future change adds another consumer of `user_data`, do not duplicate the Sentry binding — share the hook.
| `useBiometricGate.ts` | Drives `BiometricUnlockGate`. Reads the SecureStore opt-in flag (`biometric_unlock_enabled`), prompts on cold start, and re-prompts when the app returns from background after >5 min. Exports `getBiometricOptIn` / `setBiometricOptIn` / `isBiometricSupportedOnDevice` for the Settings toggle. Never locks out a user without enrolled biometrics. |
