/**
 * FIX-972R2 B1 (class [R24]): every queued send, water, weight and both food kinds, goes out only with the
 * credential of the owner and the session the flush started under, and so does its 401 replay. The account
 * changes while the API client reads the credential for one send (after the flush read the owner's queue and
 * passed its owner check). Real queue, identity mirror, auth epoch, session generation and Axios interceptors
 * run; only secure-device storage and the final transport are doubled. Synthetic unsigned JWTs identify the
 * account a request went out with; no network request is made.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

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

import api, { __resetRefreshStateForTests, __setRefreshSessionForTests } from '../api';
import { enqueue, enqueueWaterWeight, flush } from '../foodLogQueue';
import { clearUserCache, setUserCache } from '../../lib/userCache';
import { credentialSubject } from '../accountBinding';
import { runSessionWrite } from '../sessionFence';
import { secureStorage } from '../secureStorage';
import { authEvents } from '../../utils/authEvents';

const secure = jest.requireMock('../secureStorage') as { __store: Map<string, string> };
const token = (id: string, n = 0) => {
  const encode = (s: string) => Buffer.from(s).toString('base64url');
  return `${encode('{"alg":"none"}')}.${encode(JSON.stringify({ sub: id, n }))}.sig`;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const DAY = '2026-11-13';
const ID = 'queued-for-a';
const A_QUEUE = 'pending_food_logs_owner-a';
const LOG = { date: DAY, meal_type: 'lunch', quantity_multiplier: 1 } as const;
const FOOD = {
  name: 'Lentil soup', brand_or_restaurant: null, category: 'other', serving_description: '1 bowl',
  serving_size_grams: 300, calories: 240, protein_g: 14, carbs_g: 36, fat_g: 4, tags: [], search_aliases: [],
};
const SENDS = [
  { kind: 'water', queue: () => enqueueWaterWeight('owner-a', { kind: 'water', log: { date: DAY, amount_ml: 237 } }, ID), paths: ['/nutrition/water'] },
  { kind: 'weight', queue: () => enqueueWaterWeight('owner-a', { kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } }, ID), paths: ['/weight'] },
  { kind: 'search food', queue: () => enqueue({ kind: 'search', foodItemId: 'food-1', log: LOG }, ID), paths: ['/log/food'] },
  { kind: 'manual food', queue: () => enqueue({ kind: 'manual', food: FOOD, log: LOG }, ID), paths: ['/foods', '/log/food'] },
];
const WINDOWS = SENDS.flatMap((row) => row.paths.map((path, i) => ({ ...row, path, n: i + 1 })));

let posted: Array<{ path: string; account: string | null }>;
let unauthorizedOnce: boolean;
const adapter: AxiosAdapter = async (config) => {
  const bearer = String(config.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  posted.push({ path: config.url ?? '', account: credentialSubject(bearer) });
  if (unauthorizedOnce) {
    unauthorizedOnce = false;
    const response = { config, status: 401, statusText: 'Unauthorized', headers: {}, data: {} };
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config as InternalAxiosRequestConfig, null, response);
  }
  const data = config.url === '/foods' ? { id: 'food-made' } : { id: 'stored-row' };
  return { config, status: 201, statusText: 'Created', headers: {}, data };
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

let queueSpy: jest.SpyInstance | null = null;
afterEach(() => {
  queueSpy?.mockRestore();
  queueSpy = null;
});

/**
 * Hold the `n`th access-token read that starts after this flush read A's queue (the n-th send's
 * credential read in the request interceptor), until the test lets it finish.
 */
function holdCredentialRead(n: number) {
  const started = deferred();
  const resume = deferred();
  let queueRead = false;
  let reads = 0;
  const realGetItem = AsyncStorage.getItem;
  queueSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
    if (key === A_QUEUE) queueRead = true;
    return realGetItem(key);
  });
  jest.mocked(secureStorage.getItem).mockImplementation(async (key) => {
    if (key === 'supabase_token' && queueRead && ++reads === n) {
      started.resolve();
      await resume.promise;
    }
    return secure.__store.get(key) ?? null;
  });
  return { started: started.promise, resume: resume.resolve };
}

const aQueue = async () => JSON.parse((await AsyncStorage.getItem(A_QUEUE)) ?? '[]');

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetRefreshStateForTests();
  jest.mocked(secureStorage.getItem).mockReset().mockImplementation(async (key) => secure.__store.get(key) ?? null);
  api.defaults.adapter = adapter;
  posted = [];
  unauthorizedOnce = false;
  await signInAs('owner-a');
});

describe.each(SENDS)('FR-972R2 B1: queued $kind, owner at transport', ({ queue, paths }) => {
  it('control: a stable account sends its own queued save, every send with its own credential', async () => {
    await queue();
    await flush();
    expect(posted).toEqual(paths.map((path) => ({ path, account: 'sub:owner-a' })));
    expect(await aQueue()).toEqual([]);
  });

  it('control: a 401 refreshes the same session and the replay goes out with the same account', async () => {
    await queue();
    __setRefreshSessionForTests(async () => ({
      data: { session: { access_token: token('owner-a', 1), refresh_token: 'synthetic-refresh-owner-a-2' } },
      error: null,
    }));
    unauthorizedOnce = true;
    await flush();
    expect(posted).toEqual([paths[0], ...paths].map((path) => ({ path, account: 'sub:owner-a' })));
    expect(await aQueue()).toEqual([]);
  });

  it('the replay after a 401 is never sent with B credential when the account changes while it loads', async () => {
    await queue();
    __setRefreshSessionForTests(async () => ({
      data: { session: { access_token: token('owner-a', 1), refresh_token: 'synthetic-refresh-owner-a-2' } },
      error: null,
    }));
    unauthorizedOnce = true;
    const hold = holdCredentialRead(2); // read 1: the first send; read 2: its replay
    const sending = flush();
    await hold.started;
    await signInAs('owner-b');
    hold.resume();
    await sending;
    expect(posted.filter((p) => p.account !== 'sub:owner-a')).toEqual([]);
    expect(await aQueue()).toEqual([expect.objectContaining({ id: ID })]);
  });
});

describe.each(WINDOWS)('FR-972R2 B1: queued $kind, send $n of $paths.length ($path)', ({ queue, paths, n }) => {
  it("never sends A's queued save with B's credential when the account changes while that send's credential loads", async () => {
    await queue();
    const hold = holdCredentialRead(n);
    const sending = flush();
    await hold.started; // The flush captured A, read A's queue and passed its owner check.
    await signInAs('owner-b'); // Real identity, epoch and session-generation changes.
    hold.resume();
    await sending;

    expect(posted.filter((p) => p.account !== 'sub:owner-a')).toEqual([]);
    expect(posted).toEqual(paths.slice(0, n - 1).map((path) => ({ path, account: 'sub:owner-a' })));
    expect(await aQueue()).toEqual([expect.objectContaining({ id: ID })]);
  });
});
