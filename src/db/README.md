# Local database layer

`expo-sqlite` (async) plus a small AsyncStorage-backed chat store. Everything in this directory is **client-local**; the backend is the source of truth for any data that needs to be visible across devices or to a coach.

## Purpose

- Cache reference data (foods, recipes, exercises, lessons) so common screens render without a network round-trip.
- Hold per-user UI state that doesn't need to be on the server (collapsed sections, last-used filters, local notification schedule).
- Persist the AI Guide chat history locally so the conversation panel doesn't blank out when the app is offline.
- Initialise schema lazily in `getDatabase()`; idempotent `CREATE TABLE IF NOT EXISTS` makes re-init safe across upgrades.

## Key files

| File | What it does |
| --- | --- |
| `database.ts` | Opens `growthproject.db` once, sets WAL, runs `initDatabase` which executes every module's table-init function and seeds reference data. |
| `chatDb.ts` | AsyncStorage-backed chat history keyed by user id. Trims to the last 50 messages on every write. |
| `workoutDb.ts` | Routines, sessions, exercise library; seeds the exercise list. |
| `habitsDb.ts` | Habit definitions + daily logs for offline-tolerant check-ins. |
| `notificationsDb.ts` | Locally scheduled notification metadata so cancellation is possible after restart. |
| `educationDb.ts` | Lessons content + completion state. Seeds the lessons library. |
| `communityDb.ts` | Local cache of leaderboard / wins; refreshed on focus. |

> Removed in the nutrition P0 cleanup: `recipesDb.ts`, `mealPlanDb.ts`,
> `fastingDb.ts`, `shoppingListDb.ts`. All four were orphan: foods/recipes
> are now fetched live via `recipesApi`, meal plans via `mealTemplatesApi`
> + `mealPlansApi`, fasting via `fastingApi`, and grocery/shopping lists
> via `listsApi`.

## Data flow

```
App.tsx ─► initDatabase()
            ├─► getDatabase()  ─► openDatabaseAsync('growthproject.db')
            │                  ─► PRAGMA journal_mode=WAL
            ├─► seed reference tables (foods, recipes, exercises, lessons)
            └─► init feature tables (workouts, habits, education, community, notifications)

Screens ──► dbModule.<read|write>()
        └─ READ: hot path — render immediately, refresh in background via React Query
        └─ WRITE: local-first for non-tenant data; writes that need to land on the
                  server go through `services/api.ts` and update SQLite as a cache.

Chat:
  AIGuideScreen ─► chatDb.getChatHistory(userId)        // AsyncStorage('gp_chat_<userId>')
                ─► chatDb.saveChatMessage(userId, msg)
                └─ keeps last 50 messages, JSON blob
```

## App-store / deep-link dependencies

None. The local DB is opaque to deep links and the app store. The seeded reference data is shipped inside the app bundle, so no first-launch download is required for foods / exercises / lessons.

## Security and tenancy

- The SQLite file is per-app sandbox. On Android it lives under `/data/data/com.growthproject.app/`; on iOS under the app's documents directory. Other apps cannot read it without root / jailbreak.
- The DB is **not** encrypted at rest. Only non-sensitive cached data lives here. Auth tokens go to SecureStore (`services/secureStorage`), not SQLite.
- Tenancy is by `userId`. Every write that could leak across users (chat, habits, food logs, fasting history) is keyed on the current user's id. `clientStore.reset()` and the sign-out path do not delete the SQLite contents — the next signed-in user reads only their own keyed rows.
- If a device is shared and a previous user's cached lookups should not be visible, a future round can wire a "clear local cache on sign-out" toggle. Today we accept the cache surviving sign-out because it carries no PII (just food/exercise reference data and the previous user's chat history under their id).
- The chat key in `chatDb.ts` is `gp_chat_<userId>`. Reading without the right id returns nothing; there is no "all chats" surface.

## Environment variables

None.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| `initDatabase` throws on cold start | A migration was added without an `IF NOT EXISTS` guard, or a seed file is corrupted | The error reaches Sentry; users on the affected version need a re-install. Schema changes must be additive. |
| Chat history empty after upgrade | The storage key changed (or `MAX_MESSAGES` was reduced and the file was rewritten) | Acceptable — the conversation continues; missing context is replayed from `aiApi.getStructuredContext` on the next message. |
| Foods search returns nothing | Seed didn't run, or the seed call threw and was caught | `seedFoodsIfNeeded` is idempotent; clearing app data and reopening reseeds. |
| Recipes / exercises / lessons stale | Seed only runs when the table is empty — updated bundle data won't replace existing rows | Bump the seed-version sentinel in the relevant module to force a refresh. |

## Tests

```bash
npm test
```

There are unit tests for the helpers in `utils/__tests__` that consume DB fixtures (e.g. nutrition math). Direct DB tests are not part of the suite — `expo-sqlite` is exercised by integration runs and the smoke matrix.

## Release notes

- The DB file name is `growthproject.db`. Renaming it would orphan every existing install — don't.
- WAL mode is on. The `-wal` and `-shm` sidecar files are part of the working set; the OS handles them.
- Local data is *not* part of the Data Safety form's "data shared off device" categories. Anything in this directory stays on device unless `services/api.ts` mirrors it to the server.
- Chat history is intentionally local-only. If a future release moves chat history to the server, update the data-safety declaration and the Trust Center copy together — they are the source of truth pair.
