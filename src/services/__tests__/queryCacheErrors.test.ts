/**
 * TOKEN-CACHE-M — the phone's offline query cache never saves the sign-in
 * token. A failed query keeps its error in the cache, and an AxiosError's
 * JSON carries its request config: the `Authorization: Bearer <token>` header
 * and the URL (a signed one for voice uploads). App errors keep the
 * AxiosError as their `cause`.
 *
 * Real composition, as in queryCacheEncryption.test.ts: real queryClient
 * persistence, real @tanstack persister, AsyncStorage jest mock, AES-GCM from
 * jest.setup (Node crypto), SecureStore jest mock. Each test opens the sealed
 * blob and reads the JSON the persister wrote.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { QueryClient, dehydrate } from '@tanstack/react-query';

import {
  createIdentityPersistence,
  persistableError,
  persisterKeyForUser,
  QUERY_CACHE_BUSTER,
} from '../queryClient';
import { openCacheValue, resetQueryCacheKeyForTests, sealCacheValue } from '../queryCacheCrypto';
import { CommunityApiError, classify } from '../../api/apiCall';

const KEY = persisterKeyForUser('user-A');
const TOKEN = 'FAKE.TEST.TOKEN';
const SIGNATURE = 'FAKESIGNATURE0123456789';
const SIGNED_URL = `https://storage.example.test/voice/n1.m4a?X-Amz-Credential=FAKECRED&X-Amz-Signature=${SIGNATURE}`;
const REQUEST_ID = '9b2f1c4e-0000-4000-8000-000000000001';

/** An AxiosError as the app's api instance builds it on main (no `redact`). */
function axiosFailure(status: number | null, url = SIGNED_URL): AxiosError {
  const config = {
    url,
    method: 'put',
    headers: new AxiosHeaders({
      Authorization: `Bearer ${TOKEN}`,
      'X-Request-Id': REQUEST_ID,
      'Content-Type': 'audio/m4a',
    }),
  } as InternalAxiosRequestConfig;
  if (status === null) return new AxiosError('Network Error', 'ERR_NETWORK', config, {});
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code: 'community.voice.gone', upload_url: SIGNED_URL },
  });
}

/** The CommunityApiError call() builds from that AxiosError (apiCall.ts:61-81). */
function communityFailure(status: number): CommunityApiError {
  return new CommunityApiError(
    classify(status),
    status,
    `community voice request failed (${status || 'network'})`,
    axiosFailure(status || null),
  );
}

/** Every way the credential or the signed URL could show in saved JSON. */
function expectNoCredential(json: string) {
  expect(json).not.toContain('Bearer');
  expect(json).not.toContain(TOKEN);
  expect(json).not.toMatch(/authorization/i);
  expect(json).not.toContain(SIGNATURE);
  expect(json).not.toContain('X-Amz');
  expect(json).not.toContain('storage.example.test');
}

async function save(client: QueryClient, change: () => Promise<unknown> | void): Promise<string> {
  const persistence = createIdentityPersistence('user-A', { client });
  await persistence.restore();
  await change();
  await jest.advanceTimersByTimeAsync(1500);
  persistence.retire();
  await persistence.drain();
  const raw = await AsyncStorage.getItem(KEY);
  expect(raw).not.toBeNull();
  return openCacheValue(raw!);
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
});

describe('a failed query saved through the real persister path', () => {
  it('(a) an AxiosError with Authorization and a signed URL: no Bearer, token or Authorization in the saved JSON', async () => {
    const client = new QueryClient();
    const err = axiosFailure(404);
    // Control: the default JSON of this error carries the token and the signed URL (main's save path).
    expect(JSON.stringify(err)).toContain(`Bearer ${TOKEN}`);
    expect(JSON.stringify(err)).toContain(SIGNATURE);

    const json = await save(client, () =>
      client.prefetchQuery({ queryKey: ['community', 'voice', 'n1'], queryFn: () => Promise.reject(err), retry: false }),
    );

    expectNoCredential(json);
    const [saved] = JSON.parse(json).clientState.queries;
    expect(saved.state.status).toBe('error');
    // The plain fields readers use are kept, as they were saved before.
    expect(saved.state.error).toEqual({
      message: 'Request failed with status code 404',
      name: 'AxiosError',
      code: 'ERR_BAD_REQUEST',
      status: 404,
    });
    expect(saved.state.fetchFailureReason).toEqual(saved.state.error);
  });

  it('(b) the same for a CommunityApiError with that AxiosError as its cause', async () => {
    const client = new QueryClient();
    const err = communityFailure(404);
    expect(JSON.stringify(err)).toContain(`Bearer ${TOKEN}`);

    const json = await save(client, () =>
      client.prefetchQuery({ queryKey: ['community', 'voice', 'n1'], queryFn: () => Promise.reject(err), retry: false }),
    );

    expectNoCredential(json);
    const [saved] = JSON.parse(json).clientState.queries;
    expect(saved.state.status).toBe('error');
    expect(saved.state.error).toEqual({ kind: 'unknown', status: 404, name: 'CommunityApiError' });
    expect(saved.state.fetchFailureReason).toEqual(saved.state.error);
  });

  it('keeps the data of a query whose refetch failed, and cuts its raw AxiosError down', async () => {
    const client = new QueryClient();
    const json = await save(client, async () => {
      client.setQueryData(['community', 'safety', 'blocks'], [{ user_id: 'u1' }]);
      await client.prefetchQuery({
        queryKey: ['community', 'safety', 'blocks'],
        queryFn: () => Promise.reject(axiosFailure(null, '/v1/community/blocks')),
        retry: false,
        staleTime: 0,
      });
    });

    expectNoCredential(json);
    const [saved] = JSON.parse(json).clientState.queries;
    expect(saved.state.status).toBe('error');
    expect(saved.state.data).toEqual([{ user_id: 'u1' }]);
    expect(saved.state.error).toEqual({ message: 'Network Error', name: 'AxiosError', code: 'ERR_NETWORK' });
  });

  it('cuts down the failure reason of a saved paused mutation', async () => {
    const client = new QueryClient();
    const json = await save(client, () => {
      client.getMutationCache().build(client, { mutationKey: ['voice-upload'] }, {
        context: undefined,
        data: undefined,
        error: null,
        failureCount: 1,
        failureReason: communityFailure(0),
        isPaused: true,
        status: 'pending',
        variables: { noteId: 'n1' },
        submittedAt: 1,
      });
    });

    expectNoCredential(json);
    const [saved] = JSON.parse(json).clientState.mutations;
    expect(saved.state.failureReason).toEqual({ kind: 'network', status: 0, name: 'CommunityApiError' });
  });

  it('rewrites a blob saved before this fix at the next save', async () => {
    const before = new QueryClient();
    await before.prefetchQuery({
      queryKey: ['community', 'voice', 'n1'],
      queryFn: () => Promise.reject(communityFailure(404)),
      retry: false,
    });
    const oldBlob = JSON.stringify({
      buster: QUERY_CACHE_BUSTER,
      timestamp: Date.now(),
      clientState: dehydrate(before, { shouldDehydrateQuery: () => true }),
    });
    expect(oldBlob).toContain(`Bearer ${TOKEN}`);
    await AsyncStorage.setItem(KEY, await sealCacheValue(oldBlob));

    const client = new QueryClient();
    const persistence = createIdentityPersistence('user-A', { client });
    await expect(persistence.restore()).resolves.toBe('restored');
    client.setQueryData(['habits'], [{ id: 'h1' }]); // any change saves the whole cache again
    await jest.advanceTimersByTimeAsync(1500);
    persistence.retire();
    await persistence.drain();

    const json = await openCacheValue((await AsyncStorage.getItem(KEY))!);
    expectNoCredential(json);
    const saved = JSON.parse(json).clientState.queries.find(
      (q: { queryHash: string }) => q.queryHash === JSON.stringify(['community', 'voice', 'n1']),
    );
    expect(saved.state.error).toEqual({ kind: 'unknown', status: 404, name: 'CommunityApiError' });
  });
});

describe('persistableError keeps only plain fields, for every error shape (R24 table)', () => {
  class WithResponse extends Error {
    constructor(public readonly response: unknown) {
      super('payload invalid');
      this.name = 'WithResponse';
    }
  }
  const credentialNamed = Object.assign(new Error('x'), {
    code: 'E1',
    accessToken: TOKEN,
    signedUrl: SIGNED_URL,
    requestedRecordTypes: ['Steps', 'HeartRate'],
    refusal: { message: 'no' },
  });

  it.each<[string, unknown, unknown]>([
    ['a raw AxiosError', axiosFailure(500), {
      message: 'Request failed with status code 500',
      name: 'AxiosError',
      code: 'ERR_BAD_REQUEST',
      status: 500,
    }],
    ['a CommunityApiError wrapping one', communityFailure(0), { kind: 'network', status: 0, name: 'CommunityApiError' }],
    ['a plain Error (its message is not enumerable, so it was never saved)', new Error('boom'), {}],
    ['an error that keeps a response object', new WithResponse({ status: 502, headers: { Authorization: `Bearer ${TOKEN}` } }), {
      name: 'WithResponse',
    }],
    ['an error with credential-named and object fields', credentialNamed, {
      code: 'E1',
      requestedRecordTypes: ['Steps', 'HeartRate'],
    }],
    ['a saved record restored from an old blob', JSON.parse(JSON.stringify(communityFailure(404))), {
      kind: 'unknown',
      status: 404,
      name: 'CommunityApiError',
    }],
    ['a thrown string', 'offline', 'offline'],
    ['null', null, null],
    ['undefined', undefined, undefined],
  ])('%s', (_label, error, expected) => {
    const kept = persistableError(error);
    expect(kept).toEqual(expected);
    expectNoCredential(JSON.stringify(kept) ?? '');
  });
});
