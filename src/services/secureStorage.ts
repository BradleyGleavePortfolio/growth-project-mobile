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

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

// Keys that should migrate from AsyncStorage → SecureStore on first read.
// Kept stable so existing installs don't lose their session on upgrade.
const SECURE_KEYS = ['supabase_token', 'supabase_refresh_token'] as const;
type SecureKey = (typeof SECURE_KEYS)[number] | string;

async function migrateFromAsyncStorageIfPresent(key: SecureKey): Promise<string | null> {
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

export const secureStorage = {
  async getItem(key: SecureKey): Promise<string | null> {
    if (isWeb) return AsyncStorage.getItem(key);
    try {
      const existing = await SecureStore.getItemAsync(key);
      if (existing) return existing;
      // Not in SecureStore yet — try to migrate from AsyncStorage.
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
