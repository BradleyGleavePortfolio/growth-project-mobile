/**
 * LS-972R3: adversarial regression coverage for round 2 B1.
 * Real queue, account binding, auth events, session fence and Axios interceptors.
 * Storage and the final adapter are synthetic; no network.
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
import { holdSessionFence, runSessionWrite, sessionGeneration } from '../sessionFence';
import { secureStorage } from '../secureStorage';
import { authEvents } from '../../utils/authEvents';

const secure = jest.requireMock('../secureStorage') as { __store: Map<string, string> };
const token = (id: string, revision = 0) => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  return `${b64('{"alg":"none"}')}.${b64(JSON.stringify({ sub: id, revision }))}.sig`;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const ID = 'ls972r3-save';
const A_QUEUE = 'pending_food_logs_owner-a';
const DAY = '2026-11-13';
const LOG = { date: DAY, meal_type: 'lunch', quantity_multiplier: 1 } as const;
const FOOD = {
  name: 'Test soup', brand_or_restaurant: null, category: 'other', serving_description: '1 bowl',
  serving_size_grams: 300, calories: 240, protein_g: 14, carbs_g: 36, fat_g: 4, tags: [], search_aliases: [],
};
const KINDS = [
  { kind: 'water', queue: () => enqueueWaterWeight('owner-a', { kind: 'water', log: { date: DAY, amount_ml: 237 } }, ID), paths: ['/nutrition/water'] },
  { kind: 'weight', queue: () => enqueueWaterWeight('owner-a', { kind: 'weight', log: { date: DAY, weight_lbs: 180 } }, ID), paths: ['/weight'] },
  { kind: 'search', queue: () => enqueue({ kind: 'search', foodItemId: 'test-food', log: LOG }, ID), paths: ['/log/food'] },
  { kind: 'manual', queue: () => enqueue({ kind: 'manual', food: FOOD, log: LOG }, ID), paths: ['/foods', '/log/food'] },
];
const WINDOWS = KINDS.flatMap((row) => row.paths.map((path, index) => ({ ...row, path, send: index + 1 })));

let posted: Array<{ path: string; account: string | null; token: string }>;
let rejectOnce = false;
let transportHold: ReturnType<typeof deferred> | null = null;
let transportStarted: ReturnType<typeof deferred> | null = null;
const adapter: AxiosAdapter = async (config) => {
  const bearer = String(config.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  posted.push({ path: config.url ?? '', account: credentialSubject(bearer), token: bearer });
  transportStarted?.resolve();
  if (transportHold) await transportHold.promise;
  if (rejectOnce) {
    rejectOnce = false;
    const response = { config, status: 401, statusText: 'Unauthorized', headers: {}, data: {} };
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config as InternalAxiosRequestConfig, null, response);
  }
  return { config, status: 201, statusText: 'Created', headers: {}, data: { id: config.url === '/foods' ? 'made-food' : 'stored-row' } };
};

async function signOut() {
  await clearUserCache();
  authEvents.emit('logout');
  await runSessionWrite(undefined, async () => {
    secure.__store.delete('supabase_token');
    secure.__store.delete('supabase_refresh_token');
  });
}
async function signIn(id: string) {
  await signOut();
  await runSessionWrite(undefined, async () => {
    secure.__store.set('supabase_token', token(id));
    secure.__store.set('supabase_refresh_token', `test-refresh-${id}`);
  });
  await setUserCache({ id, email: '' });
  authEvents.emit('login');
}
async function refreshSameAccount() {
  const generation = sessionGeneration();
  const hold = holdSessionFence(generation);
  expect(hold).not.toBeNull();
  try {
    await secureStorage.setItem('supabase_token', token('owner-a', 2), hold!.pass);
    await secureStorage.setItem('supabase_refresh_token', 'test-refresh-owner-a-2', hold!.pass);
  } finally {
    hold!.release();
  }
  expect(sessionGeneration()).toBe(generation);
}
function holdRead(n: number) {
  const started = deferred();
  const resume = deferred();
  let reads = 0;
  jest.mocked(secureStorage.getItem).mockImplementation(async (key) => {
    if (key === 'supabase_token' && ++reads === n) {
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
  rejectOnce = false;
  transportHold = null;
  transportStarted = null;
  await signIn('owner-a');
});

describe.each(KINDS)('LS-972R3 $kind binding capture', ({ queue }) => {
  it.each(['logout', 'owner-a', 'owner-b'])('sends nothing if %s replaces the sign-in during capture', async (next) => {
    await queue();
    const hold = holdRead(1); // captureAccountBinding, before any request starts
    const sending = flush();
    await hold.started;
    if (next === 'logout') await signOut();
    else await signIn(next);
    hold.resume();
    await sending;
    expect(posted).toEqual([]);
    expect(await aQueue()).toEqual([expect.objectContaining({ id: ID })]);
  });
});

describe.each(WINDOWS)('LS-972R3 $kind send $send ($path)', ({ queue, paths, send }) => {
  it.each(['logout', 'owner-a', 'owner-b'])('does not adopt %s during the request credential read', async (next) => {
    await queue();
    const hold = holdRead(1 + send); // first read captures the binding
    const sending = flush();
    await hold.started;
    if (next === 'logout') await signOut();
    else await signIn(next);
    hold.resume();
    await sending;
    expect(posted.map(({ path, account }) => ({ path, account })))
      .toEqual(paths.slice(0, send - 1).map((path) => ({ path, account: 'sub:owner-a' })));
    expect(await aQueue()).toEqual([expect.objectContaining({ id: ID })]);
  });

  it('permits a same-session token refresh during the credential read', async () => {
    await queue();
    const hold = holdRead(1 + send);
    const sending = flush();
    await hold.started;
    await refreshSameAccount();
    hold.resume();
    await sending;
    expect(posted.map(({ path, account }) => ({ path, account })))
      .toEqual(paths.map((path) => ({ path, account: 'sub:owner-a' })));
    expect(posted[send - 1].token).toBe(token('owner-a', 2));
    expect(await aQueue()).toEqual([]);
  });
});

describe.each(KINDS)('LS-972R3 $kind replay and in-flight response', ({ queue, paths }) => {
  it.each(['logout', 'owner-a', 'owner-b'])('never replays into %s after a 401', async (next) => {
    await queue();
    __setRefreshSessionForTests(async () => ({
      data: { session: { access_token: token('owner-a', 1), refresh_token: 'test-refreshed-a' } }, error: null,
    }));
    rejectOnce = true;
    const hold = holdRead(3); // capture, initial request, replay
    const sending = flush();
    await hold.started;
    if (next === 'logout') await signOut();
    else await signIn(next);
    hold.resume();
    await sending;
    expect(posted.map(({ path, account }) => ({ path, account })))
      .toEqual([{ path: paths[0], account: 'sub:owner-a' }]);
    expect(await aQueue()).toEqual([expect.objectContaining({ id: ID })]);
  });

  it('does not continue a manual second send or write back after another account signs in during transport', async () => {
    await queue();
    transportHold = deferred();
    transportStarted = deferred();
    const sending = flush();
    await transportStarted.promise;
    await signIn('owner-b');
    transportHold.resolve();
    await sending;
    expect(posted.map(({ path, account }) => ({ path, account })))
      .toEqual([{ path: paths[0], account: 'sub:owner-a' }]);
    expect(await aQueue()).toEqual([expect.objectContaining({ id: ID })]);
    expect(await AsyncStorage.getItem('sent_food_logs_owner-b')).toBeNull();
  });
});
