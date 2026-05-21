// Secure token storage adapter.
//
// Security: JWT access/refresh tokens were previously stored in plain
// AsyncStorage, which is an unencrypted SQLite file on Android and a plain
// plist on iOS. Root/jailbroken devices — or any package with storage access —
// could read them. We now store sensitive tokens in expo-secure-store, which
// uses the iOS Keychain and Android Keystore.
//
// SecureStore is native-only; on web we fall back to AsyncStorage. The mobile
// app is the primary target so this is acceptable (web builds are used for
// developer preview only).
//
// Migration: on first call, any token already present in AsyncStorage under the
// same key is copied into SecureStore and then deleted from AsyncStorage so
// existing logged-in users aren't forced to re-authenticate.
//
// Single-flight migration: the request interceptor in api.ts calls
// `getItem('supabase_token')` once per outgoing request. On a cold start with
// queued requests (e.g. HomeScreen's Promise.all), the first run after an
// upgrade can fan out N parallel `getItem` calls before either has finished
// writing to SecureStore + clearing AsyncStorage. Without coordination, one
// caller writes the legacy value into SecureStore while a sibling has already
// observed the cleared AsyncStorage and returns null → that request fires with
// no Authorization header → 401 cascade. We coalesce concurrent migrations
// for the same key behind a per-key promise so the legacy read+copy+delete
// happens exactly once, and every parallel caller awaits the same result.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

// Keys that should migrate from AsyncStorage → SecureStore on first read.
// Kept stable so existing installs don't lose their session on upgrade.
const SECURE_KEYS = ['supabase_token', 'supabase_refresh_token'] as const;
type SecureKey = (typeof SECURE_KEYS)[number] | string;

// In-flight migration promises keyed by storage key. While a migration is in
// progress, every other caller for that same key awaits the same promise
// instead of racing on SecureStore.setItemAsync + AsyncStorage.removeItem.
const migrationPromises: Map<string, Promise<string | null>> = new Map();

async function doMigration(key: SecureKey): Promise<string | null> {
  try {
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) {
      await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
      return legacy;
    }
  } catch {
    // Migration is best-effort — if it fails, user will just log in once more.
  }
  return null;
}

function migrateFromAsyncStorageIfPresent(key: SecureKey): Promise<string | null> {
  const existing = migrationPromises.get(key);
  if (existing) return existing;
  const promise = doMigration(key).finally(() => {
    // Clear the slot AFTER the migration settles so a later cold-start path
    // (e.g. signOut then re-login) can re-run the migration if needed. By the
    // time finally() runs the legacy AsyncStorage value is either copied or
    // confirmed absent — subsequent getItem calls hit SecureStore directly.
    migrationPromises.delete(key);
  });
  migrationPromises.set(key, promise);
  return promise;
}

export const secureStorage = {
  async getItem(key: SecureKey): Promise<string | null> {
    if (isWeb) return AsyncStorage.getItem(key);
    try {
      const existing = await SecureStore.getItemAsync(key);
      if (existing) return existing;
      // Not in SecureStore yet — try to migrate from AsyncStorage. The helper
      // single-flights concurrent migrations for the same key.
      return await migrateFromAsyncStorageIfPresent(key);
    } catch {
      return null;
    }
  },

  async setItem(key: SecureKey, value: string): Promise<void> {
    if (isWeb) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },

  async removeItem(key: SecureKey): Promise<void> {
    if (isWeb) {
      await AsyncStorage.removeItem(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // deleteItemAsync throws if the key doesn't exist — safe to ignore.
    }
    // Also clear any stale AsyncStorage copy so the migration path can't
    // resurrect an old token on a later read.
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};

// Test-only: clear the in-flight migration map between cases. Not part of the
// public surface — the leading underscores keep it out of normal call sites.
export function __resetSecureStorageForTests(): void {
  migrationPromises.clear();
}
