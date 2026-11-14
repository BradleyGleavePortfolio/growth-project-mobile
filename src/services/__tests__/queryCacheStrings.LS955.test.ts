import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AxiosError } from 'axios';
import { QueryClient } from '@tanstack/react-query';
import { createIdentityPersistence, persisterKeyForUser } from '../queryClient';
import { isSealedCacheValue, openCacheValue, resetQueryCacheKeyForTests } from '../queryCacheCrypto';

// Synthetic values only. The security boundary must not depend on a string's field name.
const CREDENTIAL = 'LS955_FAKE_STRING_CREDENTIAL';
const ADDRESS = `https://storage.example.test/object?token=${CREDENTIAL}&signature=${CREDENTIAL}`;
const SHAPES: Array<[string, unknown]> = [
  ['AxiosError message', new AxiosError(`Could not load ${ADDRESS}`, 'ERR_BAD_RESPONSE')],
  ['plain string field', { status: 500, detail: `Could not load ${ADDRESS}` }],
  ['array-valued string field', { reasons: [`Could not load ${ADDRESS}`] }],
  ['top-level array', [ADDRESS]],
  ['thrown primitive string', `Could not load ${ADDRESS}`],
  ['toJSON string', { toJSON: () => ADDRESS }],
  ['toJSON record string', { toJSON: () => ({ detail: ADDRESS }) }],
];

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
  resetQueryCacheKeyForTests();
});
afterEach(() => jest.useRealTimers());

it.each(SHAPES)('LS-955 B1: drops URL credentials from all four saved error slots: %s', async (_label, error) => {
  const client = new QueryClient();
  const persistence = createIdentityPersistence('ls955-strings', { client });
  await persistence.restore();
  try {
    await client.prefetchQuery({
      queryKey: ['string-error'], queryFn: () => Promise.reject(error), retry: false,
    });
    client.getMutationCache().build(client, { mutationKey: ['string-error'] }, {
      context: undefined, data: undefined, error, failureCount: 1, failureReason: error,
      isPaused: true, status: 'pending', variables: { id: 'one' }, submittedAt: 1,
    });
    await jest.advanceTimersByTimeAsync(1500);
    persistence.retire();
    await persistence.drain();
    const raw = await AsyncStorage.getItem(persisterKeyForUser('ls955-strings'));
    expect(raw).not.toBeNull();
    expect(isSealedCacheValue(raw!)).toBe(true);
    const json = await openCacheValue(raw!);
    const saved = JSON.parse(json).clientState;
    expect(saved.queries).toHaveLength(1);
    expect(saved.mutations).toHaveLength(1);
    const slots = [
      saved.queries[0].state.error,
      saved.queries[0].state.fetchFailureReason,
      saved.mutations[0].state.error,
      saved.mutations[0].state.failureReason,
    ];
    expect(slots).toHaveLength(4);
    for (const slot of slots) expect(JSON.stringify(slot) ?? '').not.toContain(CREDENTIAL);
  } finally {
    persistence.retire();
    await persistence.drain();
    client.clear();
  }
});
