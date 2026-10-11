/**
 * M3 (AUTHA-08, DATA-10, DATA-11) — the persisted React Query cache holds
 * health, body and food data, and AsyncStorage is a plain SQLite file on
 * Android and plain files on iOS. Every blob is sealed with AES-256-GCM
 * (expo-crypto, already shipped) before it reaches AsyncStorage. The key is
 * generated on this phone and kept only in expo-secure-store (Keychain /
 * Keystore, this-device-only), so a copied app-data folder or backup cannot
 * be read.
 *
 * Existing caches keep working: a value without the sealed prefix is a cache
 * from an older build. It is returned once (so the first screen still paints
 * from cache) and the caller removes it; the next cache write stores it
 * sealed. The cache never holds unsent offline logs (those live in the food
 * queue), so dropping or re-fetching it loses nothing.
 */
import * as SecureStore from 'expo-secure-store';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

export const SEALED_PREFIX = 'tgp-aes1:';
export const QUERY_CACHE_KEY_STORE_KEY = 'tgp_rq_cache_aes_key_v1';

// After first unlock, so a cache write while the phone is locked still works;
// this-device-only, so the key never leaves the phone in a backup or transfer.
const KEY_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let keyPromise: Promise<AESEncryptionKey> | null = null;

async function loadOrCreateKey(): Promise<AESEncryptionKey> {
  const stored = await SecureStore.getItemAsync(QUERY_CACHE_KEY_STORE_KEY, KEY_OPTS);
  if (stored) return AESEncryptionKey.import(stored, 'hex');
  const key = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(QUERY_CACHE_KEY_STORE_KEY, await key.encoded('hex'), KEY_OPTS);
  return key;
}

function getKey(): Promise<AESEncryptionKey> {
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().catch((err: unknown) => {
      keyPromise = null; // a failed Keychain read is retried on the next write
      throw err;
    });
  }
  return keyPromise;
}

/** Test hook: forget the in-memory key (as after an app restart). */
export function resetQueryCacheKeyForTests(): void {
  keyPromise = null;
}

// The persister hands over JSON text. Escaping every non-ASCII character as
// \uXXXX (legal anywhere non-ASCII can appear in JSON: inside strings) keeps
// the text pure ASCII, so it maps 1:1 to bytes without TextEncoder/Decoder.
function jsonToBytes(json: string): Uint8Array {
  const ascii = json.replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  const bytes = new Uint8Array(ascii.length);
  for (let i = 0; i < ascii.length; i += 1) bytes[i] = ascii.charCodeAt(i);
  return bytes;
}

function bytesToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
  }
  return out;
}

/**
 * Seal one cache blob as `<prefix><iv base64>.<ciphertext+tag base64>`.
 * (Parts, not `combined`: Android's native fromCombined takes bytes only,
 * while fromParts takes base64 on every platform.) Throws if the key or
 * cipher is unavailable.
 */
export async function sealCacheValue(json: string): Promise<string> {
  const sealed = await aesEncryptAsync(jsonToBytes(json), await getKey());
  const iv = await sealed.iv('base64');
  const body = await sealed.ciphertext({ includeTag: true, encoding: 'base64' });
  return `${SEALED_PREFIX}${iv}.${body}`;
}

export function isSealedCacheValue(stored: string): boolean {
  return stored.startsWith(SEALED_PREFIX);
}

/** Open a sealed blob. Throws on a wrong key or tampered data. */
export async function openCacheValue(stored: string): Promise<string> {
  const [iv, body] = stored.slice(SEALED_PREFIX.length).split('.');
  const sealed = AESSealedData.fromParts(iv, body);
  const bytes = await aesDecryptAsync(sealed, await getKey(), { output: 'bytes' });
  return bytesToString(bytes);
}
