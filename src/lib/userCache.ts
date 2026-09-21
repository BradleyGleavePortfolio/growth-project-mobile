/**
 * userCache — persistent cache for the authenticated user object, reached
 * through `prefsStorage` (native MMKV when the optional module is present,
 * otherwise the AsyncStorage shim — which is EVERY current build, because
 * `react-native-mmkv` is intentionally undeclared).
 *
 * S6 R3 reimplementation (identity hydration / mutation generation fences).
 * The previous revision assumed a synchronous store: `readUserCache()` read
 * `prefsStorage.getString()` — which the shim can only ever answer with
 * `undefined` — and then fell straight through to the legacy AsyncStorage key,
 * so a freshly written namespaced value (`prefs:auth.user_data`) was never read
 * back and every `readUserCacheSync()` consumer saw `null`. The one-shot legacy
 * migration also deleted the legacy key before confirming the new value was
 * readable. This module now:
 *
 *   • reads the namespaced key ASYNCHRONOUSLY (`getStringAsync`) before ever
 *     consulting the legacy `user_data` key, so the shim path is truthful;
 *   • migrates the legacy key only after verifying the namespaced write reads
 *     back, and keeps the legacy key when it does not (repeatable migration);
 *   • exposes `set/patch/clear` as the async operations they really are — the
 *     shim writes over the AsyncStorage bridge and callers must await them;
 *   • keeps an in-memory mirror so `readUserCacheSync()` is a truthful
 *     "last hydrated / last written" view (null until hydrated — see
 *     `isUserCacheHydrated()`), never a hidden bridge call;
 *   • fences every read against a mutation generation counter: a hydration
 *     that started before a `set`/`patch`/`clear` can never overwrite the
 *     newer value, and a `patch` always merges against the current mirror.
 *
 * Logout / account switch: `clearUserCache()` bumps the generation and empties
 * the mirror synchronously (before its storage delete settles), so any read
 * still in flight for the previous account resolves to the post-logout truth.
 *
 * SECURITY NOTE: user_data contains email + name + role but NOT tokens.
 * Tokens live in SecureStore (via auth.service). MMKV is app-sandboxed and
 * not accessible to other apps on either platform (iOS: Data Protection class
 * CompleteUntilFirstUserAuthentication; Android: internal storage).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { prefsStorage } from '../storage/mmkv';
import type { CurrentUser } from '../hooks/useCurrentUser';

const MMKV_KEY = 'auth.user_data';
const LEGACY_AS_KEY = 'user_data';

// ── In-memory mirror + generation fence ──────────────────────────────────────

/** Last hydrated or last written user. Null until hydrated or when signed out. */
let mirror: CurrentUser | null = null;
/** True once a full read has completed or any mutation has been applied. */
let hydrated = false;
/** Bumped by every mutation; a read that started under an older generation is stale. */
let generation = 0;
/** Single-flight hydration so N boot-time consumers share one storage read. */
let inflightRead: Promise<CurrentUser | null> | null = null;

function parseUser(raw: string | null | undefined): CurrentUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as CurrentUser) : null;
  } catch {
    return null;
  }
}

/**
 * Apply the result of a read that started under `startedAt`. If a mutation
 * landed in the meantime the read is stale: keep the mirror (the newer truth)
 * and hand that back instead of the stale value.
 */
function commitRead(startedAt: number, value: CurrentUser | null): CurrentUser | null {
  hydrated = true;
  if (generation !== startedAt) return mirror;
  mirror = value;
  return value;
}

function applyMutation(next: CurrentUser | null): void {
  generation += 1;
  mirror = next;
  hydrated = true;
}

/** True once the cache has been read from storage (or written) in this process. */
export function isUserCacheHydrated(): boolean {
  return hydrated;
}

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Synchronous view of the cached user. On native MMKV this is the stored
 * value; on the AsyncStorage shim it is the in-memory mirror, which is `null`
 * until `readUserCache()` has completed once (or a write has happened). It
 * never performs a hidden bridge read — callers that need storage truth on a
 * cold start must await `readUserCache()`.
 */
export function readUserCacheSync(): CurrentUser | null {
  const raw = prefsStorage.getString(MMKV_KEY);
  if (raw !== undefined) return parseUser(raw);
  return mirror;
}

/**
 * Hydrating read. Order: synchronous native value → asynchronous namespaced
 * value (the shim's real answer) → legacy `user_data` migration. Always
 * consults storage (legacy writers such as Google/Apple sign-in still write
 * the raw `user_data` key), and is fenced so a mutation that lands while the
 * read is outstanding wins.
 */
export async function readUserCache(): Promise<CurrentUser | null> {
  if (inflightRead) return inflightRead;
  const run = (async (): Promise<CurrentUser | null> => {
    const startedAt = generation;

    const syncRaw = prefsStorage.getString(MMKV_KEY);
    if (syncRaw !== undefined) return commitRead(startedAt, parseUser(syncRaw));

    let namespacedRaw: string | undefined;
    try {
      namespacedRaw = await prefsStorage.getStringAsync(MMKV_KEY);
    } catch {
      namespacedRaw = undefined;
    }
    if (namespacedRaw !== undefined) return commitRead(startedAt, parseUser(namespacedRaw));

    // Legacy AsyncStorage key → namespaced key. Verified before the legacy key
    // is removed, so an interrupted or failed migration is simply retried on
    // the next read instead of losing the only copy.
    try {
      const legacyRaw = await AsyncStorage.getItem(LEGACY_AS_KEY);
      const legacyUser = parseUser(legacyRaw);
      if (legacyRaw && legacyUser) {
        if (generation !== startedAt) return commitRead(startedAt, legacyUser);
        await prefsStorage.set(MMKV_KEY, legacyRaw);
        const verify = await prefsStorage.getStringAsync(MMKV_KEY);
        if (verify === legacyRaw) {
          await AsyncStorage.removeItem(LEGACY_AS_KEY).catch(() => {
            // Non-fatal: the namespaced copy is authoritative from here on;
            // the stale legacy key is swept by signOut.
          });
        }
        return commitRead(startedAt, legacyUser);
      }
    } catch {
      // Migration failure is non-fatal: report "no user" for this read.
    }
    return commitRead(startedAt, null);
  })();
  inflightRead = run;
  try {
    return await run;
  } finally {
    if (inflightRead === run) inflightRead = null;
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Persist a user object. The mirror is updated synchronously (so subsequent
 * `readUserCacheSync()` calls see it at once); the returned promise settles
 * when the storage write has landed. Rejections propagate — a sign-in that
 * could not persist its identity must not look successful.
 */
export async function setUserCache(user: CurrentUser): Promise<void> {
  applyMutation(user);
  await prefsStorage.set(MMKV_KEY, JSON.stringify(user));
}

/**
 * Merge new fields into the existing cached user without overwriting fields
 * not present in `patch`. Hydrates first when needed so a patch can never
 * wipe fields it has not seen; merges against the CURRENT mirror at merge
 * time, so a patch that raced a newer `set`/`clear` respects it.
 */
export async function patchUserCache(patch: Partial<CurrentUser>): Promise<void> {
  if (!hydrated) await readUserCache();
  const existing = mirror;
  const merged: CurrentUser = existing
    ? {
        ...existing,
        ...patch,
        // Deep-merge profile so a partial profile update doesn't wipe fields.
        profile:
          patch.profile !== undefined
            ? { ...existing.profile, ...patch.profile }
            : existing.profile,
      }
    : // Pre-existing contract: with no cached user, persist what we have.
      (patch as CurrentUser);
  applyMutation(merged);
  await prefsStorage.set(MMKV_KEY, JSON.stringify(merged));
}

// ── Delete ──────────────────────────────────────────────────────────────────

/**
 * Clear the user cache on logout / before an account switch. The mirror is
 * emptied and the generation bumped synchronously, so an in-flight hydration
 * for the previous account cannot resurrect it; the namespaced and legacy
 * keys are then removed (best-effort for the legacy key).
 */
export async function clearUserCache(): Promise<void> {
  applyMutation(null);
  await prefsStorage.delete(MMKV_KEY);
  await AsyncStorage.removeItem(LEGACY_AS_KEY).catch(() => {
    // Non-fatal: signOut also sweeps the legacy key.
  });
}
