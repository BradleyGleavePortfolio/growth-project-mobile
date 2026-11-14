/**
 * LS-972R2 B1: the owner check must cover the real API credential await.
 * Real queue, identity mirror, session generation and Axios interceptors run.
 * Only secure-device storage and the final transport are doubled. Synthetic
 * unsigned JWTs identify the transport's account; no network request is made.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AxiosAdapter } from 'axios';

jest.mock('../secureStorage', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    secureStorage: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
      removeItem: jest.fn(async (key: string) => { store.delete(key); }),
    },
  };
});

import api, { __resetRefreshStateForTests } from '../api';
import { enqueueWaterWeight, flush } from '../foodLogQueue';
import { clearUserCache, setUserCache } from '../../lib/userCache';
import { credentialSubject } from '../accountBinding';
import { runSessionWrite } from '../sessionFence';
import { secureStorage } from '../secureStorage';
import { authEvents } from '../../utils/authEvents';

const secure = jest.requireMock('../secureStorage') as { __store: Map<string, string> };
const token = (id: string) => {
  const encode = (s: string) => Buffer.from(s).toString('base64url');
  return `${encode('{"alg":"none"}')}.${encode(JSON.stringify({ sub: id }))}.sig`;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const DAY = '2026-11-13';
const SAVES = [
  { kind: 'water', log: { date: DAY, amount_ml: 237 }, path: '/nutrition/water' },
  { kind: 'weight', log: { date: DAY, weight_lbs: 181.4 }, path: '/weight' },
] as const;
let posted: Array<{ path: string; account: string | null; key: string }>;
const adapter: AxiosAdapter = async (config) => {
  const data = JSON.parse(config.data);
  const bearer = String(config.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  posted.push({ path: config.url ?? '', account: credentialSubject(bearer), key: data.client_uuid });
  return { config, status: 201, statusText: 'Created', headers: {}, data: { id: 'stored-row' } };
};

async function signInAs(id: string) {
  await clearUserCache();
  authEvents.emit('logout');
  await runSessionWrite(undefined, async () => {
    secure.__store.set('supabase_token', token(id));
    secure.__store.set('supabase_refresh_token', `synthetic-refresh-${id}`);
  });
  await setUserCache({ id, email: '' });
  authEvents.emit('login');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetRefreshStateForTests();
  jest.mocked(secureStorage.getItem).mockReset().mockImplementation(async (key) => secure.__store.get(key) ?? null);
  api.defaults.adapter = adapter;
  posted = [];
  await signInAs('owner-a');
});

describe.each(SAVES)('$kind queue ownership at transport', ({ kind, log, path }) => {
  it('control: a stable account sends its own queued save', async () => {
    await enqueueWaterWeight('owner-a', { kind, log } as Parameters<typeof enqueueWaterWeight>[1], 'queued-for-a');
    await flush();
    expect(posted).toEqual([{ path, account: 'sub:owner-a', key: 'queued-for-a' }]);
  });

  it('never sends A queued health data using B credential after a session change during token loading', async () => {
    await enqueueWaterWeight('owner-a', { kind, log } as Parameters<typeof enqueueWaterWeight>[1], 'queued-for-a');
    const started = deferred();
    const resume = deferred();
    jest.mocked(secureStorage.getItem).mockImplementationOnce(async (key) => {
      expect(key).toBe('supabase_token');
      started.resolve();
      await resume.promise;
      return secure.__store.get(key) ?? null;
    });

    const sending = flush();
    await started.promise; // Queue already captured A and passed its last owner check.
    await signInAs('owner-b'); // Real identity and session-generation changes.
    resume.resolve();
    await sending;

    expect(JSON.parse((await AsyncStorage.getItem('pending_food_logs_owner-a')) ?? '[]'))
      .toEqual([expect.objectContaining({ id: 'queued-for-a', kind })]);
    expect(posted.filter((p) => p.key === 'queued-for-a' && p.account === 'sub:owner-b')).toEqual([]);
  });
});
