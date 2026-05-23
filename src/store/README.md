# Store

Zustand v5 stores. Used sparingly — most data flows through React Query. The stores here own state that is either ephemeral (in-flight UI), heavily mutated (food logs across rapid input), or feature-isolated (fasting timer state shared between two screens).

## Purpose

- Hold per-screen state that needs to survive navigation but does not need to be on the server.
- Provide a single mutator surface for the Log screen so day-switching, food-logging, and water-logging stay consistent.
- Cache the coach's clients list with search / filter state attached.
- Reset cleanly on sign-out so the next user on the same device never briefly sees the previous user's state.

## Key files

| File | What it does |
| --- | --- |
| `clientStore.ts` | Day selection, food logs, daily totals, water ounces, profile macros. Action surface: `setSelectedDate`, `loadDayData`, `loadProfile`, `logFood`, `logWater`, `reset`. |
| `coachStore.ts` | Clients list, search query, status filter (`all` / `active` / `archived`). Action surface: `loadClients`, `setSearchQuery`, `setFilterStatus`, `getFilteredClients`, `reset`. |

> Removed in the nutrition P0 cleanup: `fastingStore.ts` (Zustand store
> over the orphan local `db/fastingDb`). FastingScreen now drives off
> `fastingApi` (server) directly — no intermediate store.

## Data flow

```
LogScreen ─► useClientStore.loadDayData(userId, date)
          │     ├─► logApi.getDaily(date)           ─► foodLogs, dailyTotals
          │     └─► waterApi.getDaily(date)         ─► waterOz
          │
          ├─► useClientStore.logFood({ ... })       ─► logApi.logFood ─► reload
          ├─► useClientStore.logWater(userId, ...)  ─► waterApi.log ─► reload
          └─► useClientStore.setSelectedDate(date)  ─► triggers next loadDayData

ClientsListScreen ─► useCoachStore.loadClients(coachId, status?)
                     └─► coachApi.getClients(status)
                  ─► useCoachStore.setSearchQuery / setFilterStatus
                     └─► getFilteredClients() applies in-memory filter

Sign-out path ─► clientStore.reset() + coachStore.reset()
```

The reset functions are not called automatically by `signOut` — they are wired into the screens that consume the stores so the reset happens at the right point in the navigation tree (after the unauthenticated navigator mounts). The contract: when a logout cycle completes, every store's `reset()` has run before the next signed-in user reaches the screen that reads it.

## App-store / deep-link dependencies

None. Stores are runtime-only.

## Security and tenancy

- The reset functions exist for tenant isolation. Without them, the brief render-window between sign-in and a fresh `loadDayData` shows the previous user's food logs from memory.
- Stores never persist to disk on their own. Persistence is delegated either to `services/api` (server-side truth) or to `db/*` (local cache). This keeps the surface area small for security review — there is no Zustand "persist" middleware in use here.
- The coach store's `loadClients` argument is currently unused (`_coachId`); the backend derives the coach id from the JWT. The arg is kept for symmetry and future compatibility.

## Environment variables

None.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Log screen shows stale food logs after sign-in | Store reset didn't run, or `loadDayData` didn't fire on focus | The screen calls `loadDayData` in a focus effect. Check the focus listener. |
| Coach clients list empty after a filter change | `setFilterStatus` updates filter but `loadClients` was not re-run with the new status | The screen wires both calls together; if the filter is changed without a reload, the next focus refetch reconciles. |

## Tests

```bash
npm test
```

The stores are simple enough that direct tests are not in the suite; they are exercised through the screens that consume them (Log, ClientsList).

## Release notes

- Zustand is intentionally minimal here. New features should reach for React Query first; only fall back to a store when the state is purely client-side and shared by two or more screens.
- The reset functions are part of the security contract. Adding a new field to a store means adding it to `initialClientState` / `initialCoachState` — otherwise a sign-out leaves it dangling.
- The Log store does not write to the offline queue directly; that path lives in `services/foodLogQueue` and is invoked by the screen. If a future round moves queueing into the store, the responsibility for flush-on-network-up moves with it.
