# Offline Architecture — The Growth Project Mobile

This document explains the offline-first data strategy introduced in Phase 11 / Track 10. It covers the three layers of the system and provides a migration playbook for engineers adding offline support to a new screen.

---

## Overview

Three complementary systems form the offline stack:

| Layer | Technology | Purpose |
|---|---|---|
| Relational offline store | WatermelonDB (`@nozbe/watermelondb`) | Write-then-sync for structured per-user records (workouts, sets, habits) |
| Key-value cache | MMKV (`react-native-mmkv`) | User prefs, last-sync timestamps, ephemeral cache, encrypted PIN hash |
| Biometric lock | `expo-local-authentication` | App-level gate on foreground resume; sensitive-action guard |

---

## 1. WatermelonDB — relational offline data

### Why WatermelonDB?

- Fully lazy (models are only loaded when observed), which keeps startup fast.
- Built-in React integration via `withObservables` and `useQuery`.
- Adapter swappable: `ExpoSQLiteAdapter` on device, `LokiJSAdapter` in tests and Expo web.
- Explicit sync API — no magic merging, full control over conflict policy.

### Adapter selection

| Environment | Adapter |
|---|---|
| iOS / Android (device or EAS build) | `ExpoSQLiteAdapter` — wraps `expo-sqlite`, already in the project |
| Web / Jest | `LokiJSAdapter` — in-memory, zero native deps |

The adapter selection is handled automatically in `src/offline/database.ts` based on `Platform.OS` and `NODE_ENV`.

### Schema (`src/offline/schema.ts`)

Current version: **1**

| Table | Purpose |
|---|---|
| `workout_logs` | One row per exercise group per session |

Workout log columns:

| Column | Type | Notes |
|---|---|---|
| `exercise_id` | string | ID or name of the exercise |
| `sets_data` | string | JSON array of `{reps, weight, completed}` |
| `sync_status` | string | `pending` / `synced` / `conflict` |
| `logged_at` | number | Epoch ms — set by WatermelonDB `createdAt` |
| `server_id` | string? | Populated after a successful push |
| `session_name` | string? | Routine / session name |
| `duration_minutes` | number? | Session duration |

### Sync engine (`src/offline/sync/sync-engine.ts`)

The engine runs a push-then-pull cycle:

1. **Push**: query all `pending` records, POST each to `/workouts`.
   - Success → `markSynced(serverId)` — status flips to `synced`.
   - HTTP 409 → `markConflict()` — server-wins policy; a toast event is emitted via `conflictToastEvents`.
   - Network error / 5xx → record stays `pending`, retried next cycle.

2. **Pull**: fetch the last 20 workouts from `/workouts` and insert any that are not already in the local DB (by `server_id`). Records currently `pending` are not overwritten.

**Conflict policy**: server wins. The local `conflict` record is surfaced as a non-blocking toast so the user is aware, but the server copy is the authoritative version.

**Trigger points**:
- After successful biometric unlock / login: `triggerSync()`.
- When `useNetworkStatus` transitions from offline to online: call `triggerSync()` in the consumer.
- After `finishWorkout` in `ActiveWorkoutScreen`.

### Write path

Always write via `writeWorkoutLog()` from `src/offline/index.ts`, never via raw WatermelonDB database calls. This ensures the `sync_status` is always set correctly.

```typescript
import { writeWorkoutLog, triggerSync } from '../offline';

await writeWorkoutLog({
  exerciseId: 'bench-press',
  setsData: JSON.stringify(completedSets),
  sessionName: 'Chest Day',
  durationMinutes: 45,
});

// After network call succeeds:
triggerSync().catch(() => {/* non-fatal */});
```

### Read path

Use WatermelonDB's reactive queries as the source of truth. When `sync_status` is `pending`, show a subtle indicator (e.g. a clock icon) so the user knows the record hasn't reached the server yet.

```typescript
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { Q } from '@nozbe/watermelondb';
import WorkoutLog from '../offline/models/WorkoutLog';

const db = useDatabase();
const pendingLogs = await db.get<WorkoutLog>('workout_logs')
  .query(Q.where('sync_status', 'pending'))
  .observe();
```

---

## 2. MMKV — key-value cache

### Why MMKV?

- Synchronous reads (no `await`) — avoids async waterfalls in hot render paths.
- ~30x faster than AsyncStorage on benchmarks.
- Native encryption (AES-256-GCM via OS keychain key) for the `secureStorage` instance.

### Dev-client requirement

`react-native-mmkv` ships a native module and **cannot run in Expo Go**. During development with Expo Go or in CI, the module falls back transparently to an `AsyncStorage`-backed shim with the same API surface. The shim's `getString()` always returns `undefined` (synchronous reads not possible without the native module); use `getStringAsync()` in those environments.

To use the real MMKV in development, build a custom dev client:

```bash
eas build --profile development --platform ios
# or
eas build --profile development --platform android
```

### Three namespaced instances (`src/storage/mmkv.ts`)

| Instance | Namespace | Encrypted | Contents |
|---|---|---|---|
| `prefsStorage` | `prefs` | No | Theme, notification toggles, onboarding flags |
| `cacheStorage` | `cache` | No | Last-sync timestamps, API pagination cursors |
| `secureStorage` | `secure` | Yes | PIN hash (SHA-256), biometric timeout preference |

### Migration from AsyncStorage

Any `AsyncStorage.getItem` / `setItem` call should be migrated to one of the three instances above. The migration is incremental — the shim ensures no breakage before the custom dev client is adopted.

```typescript
// Before
await AsyncStorage.setItem('theme', 'dark');
const theme = await AsyncStorage.getItem('theme');

// After
import { prefsStorage } from '../storage/mmkv';
await prefsStorage.set('theme', 'dark');
const theme = await prefsStorage.getStringAsync('theme');
```

---

## 3. Biometric lock

### Existing gate (pre-Phase 11)

`src/hooks/useBiometricGate.ts` + `src/components/BiometricUnlockGate.tsx` already handle:
- Cold-start biometric prompt when the user has opted in.
- Background→foreground re-prompt after a configurable timeout.
- `expo-local-authentication` for Face ID / Touch ID / fingerprint.

These are retained unchanged.

### New service (`src/security/biometric-lock.service.ts`)

Added in Phase 11 to extend the existing gate with:

| Feature | Detail |
|---|---|
| `requireAuth(promptMessage)` | Imperative call for sensitive in-app actions. Returns `AuthResult`. |
| Lock timeout preference | 1 / 5 / 15 / never minutes. Stored in `secureStorage`. |
| PIN fallback | SHA-256 hash stored in encrypted MMKV. Devices without biometrics can use a 6-digit PIN. |
| Lockout after 5 failures | Clears JWT tokens + emits `authEvents.logout`. |

### PIN hash storage

The PIN is never stored in plaintext. On `setPinHash(pin)`:

```
hash = SHA-256(pin)         // via expo-crypto
secureStorage.set('secure:biometric_pin_hash', hash)
```

On `verifyPin(pin)`:

```
attempt = SHA-256(pin)
match = attempt === stored
if (!match) incrementFailCount()
```

### Timeout preference

The user can choose how long the app waits before re-prompting on foreground:

```typescript
import { setBiometricTimeout, getBiometricTimeout } from '../security/biometric-lock.service';
await setBiometricTimeout(15); // 1 | 5 | 15 | 0 (never)
```

The `useBiometricGate` hook reads this value (follow-up: wire the preference read into the hook's `BACKGROUND_TIMEOUT_MS` calculation).

---

## Migration playbook: adding offline support to a new screen

Follow these steps to bring a new screen into the offline-first pattern:

### Step 1 — Define a schema table

Add a `tableSchema` to `src/offline/schema.ts` and bump the `version` number. Add a corresponding migration in a `migrations` file (see WatermelonDB docs for addMigrations).

### Step 2 — Create a Model class

Create `src/offline/models/YourModel.ts` extending `Model`. Annotate columns with `@field`, `@date`, etc. Add a `toServerPayload()` method for the sync engine.

### Step 3 — Register the model

Add the new model class to the `modelClasses` array in `src/offline/database.ts`.

### Step 4 — Add write/push logic to the sync engine

In `src/offline/sync/sync-engine.ts`, add:
1. A `writeYourRecord(payload)` function that writes with `sync_status='pending'`.
2. Push logic in `pushPending()` (or a separate `pushPendingYourRecords()` called from `triggerSync()`).
3. Pull logic in `pullFromServer()` if the screen needs server-seeded data on login.

Export the write function from `src/offline/index.ts`.

### Step 5 — Update the screen

Replace the direct API mutation with:
1. `await writeYourRecord(...)` — local write.
2. `yourApi.create(...)` — server attempt (fails gracefully when offline).
3. `triggerSync()` after success to mark records synced.

For the read path, use WatermelonDB `observe()` or `fetch()` as the source of truth. Show a pending indicator when `sync_status === 'pending'`.

### Step 6 — Add tests

Add a test file in `src/__tests__/yourSync.test.ts` covering:
- Write creates a `pending` record.
- Successful API call flips status to `synced`.
- Network error leaves record as `pending`.
- (If applicable) 409 flips to `conflict` and emits toast.

### Screens queued as follow-up PRs

The following screens are identified for offline migration but are out of scope for this foundation PR:

| Screen | Current write path | Planned offline table |
|---|---|---|
| `LogScreen` (food log) | `foodLogQueue.ts` (AsyncStorage queue) | `food_logs` |
| `HabitsScreen` | Direct API mutation | `habit_completions` |
| `ProgressScreen` (body weight) | Direct API mutation | `body_weight_entries` |
| `FastingScreen` | Direct API mutation | `fasting_sessions` |

---

## File map

```
src/
  offline/
    database.ts          — DB singleton + adapter selection
    schema.ts            — WatermelonDB schema (version 1)
    index.ts             — barrel exports
    models/
      WorkoutLog.ts      — workout_logs model
    sync/
      sync-engine.ts     — push/pull + writeWorkoutLog()
  storage/
    mmkv.ts              — typed MMKV wrapper (prefsStorage / cacheStorage / secureStorage)
  security/
    biometric-lock.service.ts  — requireAuth(), PIN, timeout, lockout
  __tests__/
    syncEngine.test.ts          — sync engine unit tests
    biometricLockService.test.ts — biometric service unit tests
docs/
  offline-architecture.md  — this file
```
