/**
 * M3 (AUTHA-08, DATA-10, DATA-11) — the persisted query cache is sealed on
 * the phone. Real composition: real queryClient persistence, real
 * @tanstack persister, AsyncStorage jest mock, AES-GCM from jest.setup
 * (Node crypto), SecureStore jest mock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, dehydrate } from '@tanstack/react-query';

import { createIdentityPersistence, persisterKeyForUser, QUERY_CACHE_BUSTER } from '../queryClient';
import {
  QUERY_CACHE_KEY_STORE_KEY,
  SEALED_PREFIX,
  openCacheValue,
  resetQueryCacheKeyForTests,
  sealCacheValue,
} from '../queryCacheCrypto';

const KEY = persisterKeyForUser('user-A');
const WEIGHT = ['weight-logs'];
const DATA = { weightKg: 83.4, note: 'Ate crème brûlée 🍮', symptom: 'nausea' };

function legacyBlob(): string {
  const tmp = new QueryClient();
  tmp.setQueryData(WEIGHT, DATA);
  return JSON.stringify({ buster: QUERY_CACHE_BUSTER, timestamp: Date.now(), clientState: dehydrate(tmp) });
}

async function persistOnce(client: QueryClient) {
  const persistence = createIdentityPersistence('user-A', { client });
  await persistence.restore();
  client.setQueryData(WEIGHT, DATA);
  await jest.advanceTimersByTimeAsync(1500);
  persistence.retire();
  await persistence.drain();
}

const secureStore = SecureStore as unknown as { __store: Map<string, string> };

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  secureStore.__store.clear();
  resetQueryCacheKeyForTests();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('writes no health data in plain text to AsyncStorage', async () => {
  await persistOnce(new QueryClient());

  const raw = await AsyncStorage.getItem(KEY);
  expect(raw).not.toBeNull();
  expect(raw!.startsWith(SEALED_PREFIX)).toBe(true);
  expect(raw).not.toMatch(/83\.4|nausea|weight-logs|clientState/);
  // The key lives only in SecureStore, never in AsyncStorage.
  const key = secureStore.__store.get(QUERY_CACHE_KEY_STORE_KEY);
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(await AsyncStorage.getMany(await AsyncStorage.getAllKeys()))).not.toContain(key);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(QUERY_CACHE_KEY_STORE_KEY, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
});

it('restores the sealed cache after a restart, including non-ASCII text', async () => {
  await persistOnce(new QueryClient());
  resetQueryCacheKeyForTests(); // app restart: key re-read from SecureStore

  const next = new QueryClient();
  await expect(createIdentityPersistence('user-A', { client: next }).restore()).resolves.toBe('restored');
  expect(next.getQueryData(WEIGHT)).toEqual(DATA);
});

it('keeps an older plain cache working once, removes it, and seals the next write', async () => {
  await AsyncStorage.setItem(KEY, legacyBlob());

  const client = new QueryClient();
  const persistence = createIdentityPersistence('user-A', { client });
  await expect(persistence.restore()).resolves.toBe('restored');
  expect(client.getQueryData(WEIGHT)).toEqual(DATA);
  expect(await AsyncStorage.getItem(KEY)).toBeNull();

  client.setQueryData(['habits'], [{ id: 'h1' }]);
  await jest.advanceTimersByTimeAsync(1500);
  persistence.retire();
  await persistence.drain();
  const raw = await AsyncStorage.getItem(KEY);
  expect(raw!.startsWith(SEALED_PREFIX)).toBe(true);
  expect(raw).not.toContain('83.4');
});

it('drops a blob sealed with another key (for example a restored or copied app folder)', async () => {
  await persistOnce(new QueryClient());
  secureStore.__store.clear(); // key gone: a new one is generated
  resetQueryCacheKeyForTests();

  const next = new QueryClient();
  await expect(createIdentityPersistence('user-A', { client: next }).restore()).resolves.toBe('failed');
  expect(next.getQueryData(WEIGHT)).toBeUndefined();
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});

it('rejects a tampered blob', async () => {
  const sealed = await sealCacheValue('{"a":1}');
  expect(await openCacheValue(sealed)).toBe('{"a":1}');
  const [iv, b64] = sealed.slice(SEALED_PREFIX.length).split('.');
  const body = Buffer.from(b64, 'base64');
  body[body.length - 1] ^= 1;
  await expect(openCacheValue(`${SEALED_PREFIX}${iv}.${body.toString('base64')}`)).rejects.toThrow();
});

it('writes nothing when the key store is unavailable', async () => {
  jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValue(new Error('keychain locked'));
  await persistOnce(new QueryClient());
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});
