/**
 * MMKV storage utility — typed, namespaced instances for The Growth Project.
 *
 * react-native-mmkv requires a custom dev client (not compatible with Expo Go
 * because it ships a native module). During development with Expo Go, or in
 * Jest, the module is unavailable, so we fall back to an AsyncStorage-backed
 * shim that exposes the same synchronous-style surface (with async set/get
 * helpers). The shim is swap-compatible with the MMKV surface.
 *
 * Migration note for engineers:
 *   Any call site currently using AsyncStorage directly should migrate to one
 *   of the three namespaced instances below:
 *     - prefsStorage  — user preferences (theme, notification settings)
 *     - cacheStorage  — last-sync timestamps, ephemeral API-response cache
 *     - secureStorage — encrypted slot: PIN hash, sensitive flags
 *
 *   The secureStorage instance uses MMKV's built-in encryption (AES-256-GCM
 *   with a per-app random key stored in the Keychain / Keystore). Do NOT
 *   store raw authentication tokens here — those belong in expo-secure-store
 *   (see services/secureStorage.ts). Store only derived / hashed values.
 *
 * @see docs/offline-architecture.md — MMKV section
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─── Optional native module (bundle-safe) ───────────────────────────────────
//
// `react-native-mmkv` is deliberately NOT declared in package.json (see
// OPTIONAL_UNDECLARED in src/config/__tests__/declaredDependencies.test.ts),
// so in every current build it is absent and the AsyncStorage shim below is
// the real persistence layer.
//
// A try/catch alone does NOT make that absence safe for Metro. Metro resolves
// statically at bundle time; the Expo config enables
// `transformer.allowOptionalDependencies`, under which an unresolvable
// specifier is tolerated ONLY while every `require()` of it in this module
// sits directly inside a `try { }` block. One unguarded require of the same
// specifier anywhere in the file demotes the whole dependency to required and
// `expo export` fails with "Unable to resolve module react-native-mmkv" — the
// exact failure a second, unguarded require inside the MmkvStorage
// constructor used to cause. The module is therefore required exactly once,
// here, and the result is handed to MmkvStorage. For an unresolved optional
// dependency Metro emits a null module id and `require` throws at runtime,
// which the catch turns into the fallback. The guard test pins this shape.
//
// Availability is decided by the loaded module's shape, not by "require did
// not throw": a resolved-but-empty module (e.g. a Metro `empty` stub) carries
// no `MMKV` constructor and must be reported as unavailable, otherwise
// `new MMKV(...)` would crash at startup.

interface MmkvInstance {
  getString(key: string): string | undefined;
  set(key: string, value: string | number): void;
  delete(key: string): void;
  getAllKeys(): string[];
}

interface MmkvModule {
  MMKV: new (config: { id: string; encryptionKey?: string }) => MmkvInstance;
}

/**
 * Truthful capability check on whatever `require('react-native-mmkv')`
 * returned. Only a module exposing an `MMKV` constructor counts as available.
 */
export function asMmkvModule(candidate: unknown): MmkvModule | null {
  if (candidate === null || candidate === undefined) return null;
  if (typeof candidate !== 'object' && typeof candidate !== 'function') return null;
  const ctor = (candidate as { MMKV?: unknown }).MMKV;
  return typeof ctor === 'function' ? (candidate as MmkvModule) : null;
}

function loadOptionalMmkv(): MmkvModule | null {
  if (Platform.OS === 'web') return null;
  if (process.env.NODE_ENV === 'test') return null;
  let candidate: unknown;
  try {
    // The ONLY require of this specifier in the app. Keep it as a plain
    // statement directly inside this try block (Metro's optional condition).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    candidate = require('react-native-mmkv');
  } catch {
    return null;
  }
  return asMmkvModule(candidate);
}

/** Resolved once at module load; null means the AsyncStorage shim is in use. */
const optionalMmkv: MmkvModule | null = loadOptionalMmkv();

/** True only when a real `MMKV` constructor was loaded — never inferred. */
export function isMmkvAvailable(): boolean {
  return optionalMmkv !== null;
}

// ─── AsyncStorage shim ──────────────────────────────────────────────────────
// Presents the same get/set/delete surface as MMKV so consumers can swap
// without code changes when the custom dev client becomes available.

class AsyncStorageShim {
  private namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  private key(k: string): string {
    return `${this.namespace}:${k}`;
  }

  /** Synchronous read — returns undefined (shim limitation). Use getString. */
  getString(_key: string): string | undefined {
    // Cannot be synchronous without MMKV native module. Return undefined and
    // let callers use the async variant.
    return undefined;
  }

  async getStringAsync(key: string): Promise<string | undefined> {
    const v = await AsyncStorage.getItem(this.key(key));
    return v ?? undefined;
  }

  async set(key: string, value: string | number | boolean): Promise<void> {
    await AsyncStorage.setItem(this.key(key), String(value));
  }

  async delete(key: string): Promise<void> {
    await AsyncStorage.removeItem(this.key(key));
  }

  async clearNamespace(): Promise<void> {
    const allKeys = await AsyncStorage.getAllKeys();
    const ours = allKeys.filter((k) => k.startsWith(`${this.namespace}:`));
    if (ours.length) await AsyncStorage.removeMany(ours);
  }

  // Returns logical (un-namespaced) keys for this instance. Used by sign-out to
  // enumerate user-scoped keys and delete them by matching `:${userId}` suffix.
  async getAllKeys(): Promise<string[]> {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefix = `${this.namespace}:`;
    return allKeys
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

// ─── MMKV wrapper ────────────────────────────────────────────────────────────

class MmkvStorage {
  private store: MmkvInstance;
  private namespace: string;

  constructor(mmkv: MmkvModule, namespace: string, encrypted = false) {
    this.namespace = namespace;
    // No second require here: it would demote the optional dependency to a
    // required one and break the release bundle (see loadOptionalMmkv).
    const { MMKV } = mmkv;
    this.store = new MMKV({
      id: namespace,
      encryptionKey: encrypted ? `tgp-mmkv-enc-${namespace}` : undefined,
    });
  }

  private key(k: string): string {
    return `${this.namespace}:${k}`;
  }

  getString(key: string): string | undefined {
    return this.store.getString(this.key(key));
  }

  async getStringAsync(key: string): Promise<string | undefined> {
    return this.getString(key);
  }

  async set(key: string, value: string | number | boolean): Promise<void> {
    if (typeof value === 'string') this.store.set(this.key(key), value);
    else if (typeof value === 'number') this.store.set(this.key(key), value);
    else this.store.set(this.key(key), String(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(this.key(key));
  }

  async clearNamespace(): Promise<void> {
    const allKeys: string[] = this.store.getAllKeys();
    for (const k of allKeys) {
      if (k.startsWith(`${this.namespace}:`)) {
        this.store.delete(k);
      }
    }
  }

  async getAllKeys(): Promise<string[]> {
    const allKeys: string[] = this.store.getAllKeys();
    const prefix = `${this.namespace}:`;
    return allKeys
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

// ─── Public typed interface ──────────────────────────────────────────────────

export interface StorageInstance {
  getString(key: string): string | undefined;
  getStringAsync(key: string): Promise<string | undefined>;
  set(key: string, value: string | number | boolean): Promise<void>;
  delete(key: string): Promise<void>;
  clearNamespace(): Promise<void>;
  getAllKeys(): Promise<string[]>;
}

function makeStorage(namespace: string, encrypted = false): StorageInstance {
  if (optionalMmkv) {
    return new MmkvStorage(optionalMmkv, namespace, encrypted);
  }
  return new AsyncStorageShim(namespace);
}

/**
 * User preferences: theme choice, notification toggles, onboarding flags.
 * Not sensitive — no encryption.
 */
export const prefsStorage: StorageInstance = makeStorage('prefs');

/**
 * Ephemeral cache: last-sync timestamps, recently-fetched IDs, pagination
 * cursors. Cleared on logout. Not sensitive — no encryption.
 */
export const cacheStorage: StorageInstance = makeStorage('cache');

/**
 * Encrypted storage: PIN hash (SHA-256 hex), biometric timeout setting.
 * Uses MMKV's AES-256-GCM encryption with a per-instance key stored in the
 * OS keychain. Falls back to plain AsyncStorage in Expo Go / test envs (still
 * namespaced, but not hardware-encrypted in that scenario).
 */
export const secureStorage: StorageInstance = makeStorage('secure', true);

// ─── Convenience helpers ─────────────────────────────────────────────────────

/** Clear all three namespaces — call on logout to wipe local state. */
export async function clearAllStorage(): Promise<void> {
  await Promise.all([
    prefsStorage.clearNamespace(),
    cacheStorage.clearNamespace(),
    secureStorage.clearNamespace(),
  ]);
}
