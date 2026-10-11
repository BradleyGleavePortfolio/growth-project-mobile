/**
 * B-666-1 (probe by L-666-SOL): reproduce expo-crypto 56.0.4's installed
 * Android/iOS contract. Native CiphertextOptions reads outputFormat (default
 * bytes) and silently ignores any other key such as the typed `encoding`.
 * Keeps the real AES-GCM mock, changing only how the bridge reads options.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AESSealedData } from 'expo-crypto';
import { QueryClient } from '@tanstack/react-query';
import { createIdentityPersistence, persisterKeyForUser } from '../queryClient';
import { openCacheValue, resetQueryCacheKeyForTests, sealCacheValue } from '../queryCacheCrypto';

const secureStore = SecureStore as unknown as { __store: Map<string, string> };
const QUERY_KEY = ['weight-logs'];
const DATA = { weightKg: 83.4, symptom: 'nausea' };
const STORAGE_KEY = persisterKeyForUser('native-contract-user');

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  secureStore.__store.clear();
  resetQueryCacheKeyForTests();

  const original = AESSealedData.prototype.ciphertext;
  jest.spyOn(AESSealedData.prototype, 'ciphertext').mockImplementation(function (
    this: AESSealedData,
    options?: unknown,
  ) {
    const nativeOptions = options as { includeTag?: boolean; outputFormat?: 'base64' | 'bytes' } | undefined;
    // Only the two native fields cross the bridge; anything else is dropped.
    return original.call(this, {
      includeTag: nativeOptions?.includeTag,
      outputFormat: nativeOptions?.outputFormat,
    } as never);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('round-trips a sealed value with the installed native ciphertext options', async () => {
  const json = JSON.stringify(DATA);
  const sealed = await sealCacheValue(json);
  expect(sealed.slice(sealed.indexOf('.') + 1)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  await expect(openCacheValue(sealed)).resolves.toBe(json);
});

it('restores a normal saved health cache after a native app restart', async () => {
  const first = new QueryClient();
  const persistence = createIdentityPersistence('native-contract-user', { client: first });
  await persistence.restore();
  first.setQueryData(QUERY_KEY, DATA);
  await jest.advanceTimersByTimeAsync(1500);
  persistence.retire();
  await persistence.drain();
  expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();
  resetQueryCacheKeyForTests();

  const second = new QueryClient();
  const next = createIdentityPersistence('native-contract-user', { client: second });
  try {
    await expect(next.restore()).resolves.toBe('restored');
    expect(second.getQueryData(QUERY_KEY)).toEqual(DATA);
  } finally {
    next.retire();
    await next.drain();
    first.clear();
    second.clear();
  }
});
