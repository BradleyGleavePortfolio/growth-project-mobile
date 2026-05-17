/**
 * userCache — MMKV-backed persistent cache for the authenticated user object.
 *
 * Previously stored in plain AsyncStorage under 'user_data'. Migrated to
 * MMKV (prefsStorage) for:
 *  - Synchronous reads (no async waterfall on boot)
 *  - No serialization to the AsyncStorage RN bridge
 *  - No data loss on AsyncStorage corruption (separate storage domain)
 *
 * Migration: on first read, if the MMKV key is absent but the old AsyncStorage
 * key is present, we migrate the value and delete the old key. This is a
 * one-time no-op migration that requires no manual operator action.
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

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Read the cached user synchronously. Returns null if not present or unparseable.
 * No async / no bridge call on the happy path.
 */
export function readUserCacheSync(): CurrentUser | null {
  const raw = prefsStorage.getString(MMKV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

/**
 * Async read — identical result to readUserCacheSync but also runs the
 * one-time AsyncStorage migration if the MMKV key is empty and the legacy
 * key is present.
 */
export async function readUserCache(): Promise<CurrentUser | null> {
  const mmkvRaw = prefsStorage.getString(MMKV_KEY);
  if (mmkvRaw) {
    try {
      return JSON.parse(mmkvRaw) as CurrentUser;
    } catch {
      return null;
    }
  }

  // One-time migration from legacy AsyncStorage key.
  try {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_AS_KEY);
    if (legacyRaw) {
      // Write to MMKV and delete legacy key atomically (best-effort).
      prefsStorage.set(MMKV_KEY, legacyRaw);
      await AsyncStorage.removeItem(LEGACY_AS_KEY).catch(() => {
        // Non-fatal: the MMKV value is already written; the legacy key will
        // be overwritten on the next setUserCache call.
      });
      return JSON.parse(legacyRaw) as CurrentUser;
    }
  } catch {
    // Migration failure is non-fatal.
  }
  return null;
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Persist a user object. Synchronous — no async bridge call.
 */
export function setUserCache(user: CurrentUser): void {
  prefsStorage.set(MMKV_KEY, JSON.stringify(user));
}

/**
 * Merge new fields into the existing cached user without overwriting fields
 * not present in `patch`. Safe to call with a partial object.
 */
export function patchUserCache(patch: Partial<CurrentUser>): void {
  const existing = readUserCacheSync();
  if (!existing) {
    // If there's no user yet, just write what we have.
    prefsStorage.set(MMKV_KEY, JSON.stringify(patch));
    return;
  }
  const merged: CurrentUser = {
    ...existing,
    ...patch,
    // Deep-merge profile so a partial profile update doesn't wipe fields.
    profile:
      patch.profile !== undefined
        ? { ...existing.profile, ...patch.profile }
        : existing.profile,
  };
  prefsStorage.set(MMKV_KEY, JSON.stringify(merged));
}

// ── Delete ──────────────────────────────────────────────────────────────────

/**
 * Clear the user cache on logout. Synchronous.
 */
export function clearUserCache(): void {
  prefsStorage.delete(MMKV_KEY);
}
