/**
 * REFINE-972 (m#972, B2): one flush of the one queue at a time, with the shared send's follow-ups.
 * On one phone at most one flush sends at a time: a caller that arrives while one runs for the same owner shares its
 * result and sends nothing itself; a caller for another owner never takes that result (it waits, then sends its own
 * owner's queue). Whatever a flush sent leaves the store as the sync leaves it: the foods it sent stay in their day
 * until a read holds their key (offlineFoodInDay on) and the pending count is told. Runs the REAL queue, sync, store
 * and sign-out try against LS-972R1 B-TEST 2's fake server (a hand-typed food holds a food block, so foodApi.create is
 * counted: POST /foods keeps no key).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockFlags = { inDay: true };
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (target, key) => (key === 'offlineFoodInDay' ? mockFlags.inDay : target[key as keyof typeof target]),
    }),
  };
});

const mockUser = { id: 'member-1' as string | undefined };
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => (mockUser.id ? { id: mockUser.id } : null)),
  readUserCache: jest.fn(async () => (mockUser.id ? { id: mockUser.id } : null)),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: jest.fn(async () => undefined),
}));
jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => undefined),
  prefsStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  cacheStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  secureStorage: { getString: () => undefined },
}));
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

type Row = { id: string; client_uuid: string; member: string; date: string; amount_ml?: number; weight_lbs?: number };
const mockServer = {
  water: [] as Row[],
  weight: [] as Row[],
  food: [] as { id: string; client_uuid: string; member: string; date: string; name: string; calories: number }[],
  /** Each POST that reached the server, in order: the kind, the key and the member whose session sent it. */
  posts: [] as { kind: string; key: string; member?: string; afterOtherFlush?: boolean }[],
  loseAnswer: false,
  transient: null as null | { status: number; retryAfter?: string },
  /** A POST answered only after this wait (ms), to keep a flush in flight. */
  slowWater: 0,
  down: false,
};
/** Set by the owner-rule case once A's flush has finished. */
const mockMarks = { aDone: false, onWater: null as null | (() => void) };
const mockFail = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
function mockGate(kind: string, key: string) {
  if (mockServer.down) throw new Error('Network Error');
  mockServer.posts.push({ kind, key, member: mockUser.id, afterOtherFlush: mockMarks.aDone });
  if (mockServer.transient) throw mockFail(mockServer.transient.status, mockServer.transient.retryAfter ? { 'retry-after': mockServer.transient.retryAfter } : {});
}
const mockWait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  foodApi: { create: jest.fn(async () => ({ data: { id: 'food-new' } })) },
  logApi: {
    logFood: jest.fn(async (body: { client_uuid: string; date: string }) => {
      mockGate('food', body.client_uuid);
      let row = mockServer.food.find((f) => f.client_uuid === body.client_uuid);
      if (!row) {
        mockServer.food.push((row = { id: `food-${mockServer.food.length + 1}`, client_uuid: body.client_uuid, member: mockUser.id ?? '',
          date: body.date, name: 'Home soup', calories: 200 }));
      }
      if (mockServer.loseAnswer) throw new Error('Network Error');
      return { data: row };
    }),
    // The day read holds the server's foods of the day, each with its key (client_uuid), as the server's does.
    getDaily: jest.fn(async (date: string) => {
      const rows = mockServer.food.filter((f) => f.date === date && f.member === mockUser.id);
      return {
        data: {
          entries: rows.map((f) => ({ id: f.id, food_item_id: 'food-new', user_id: f.member, meal_type: 'lunch', quantity_multiplier: 1,
            food_item: { id: 'food-new', name: f.name, calories: f.calories, protein_g: 8, carbs_g: 20, fat_g: 6 }, client_uuid: f.client_uuid })),
          total_calories: rows.reduce((t, f) => t + f.calories, 0), total_protein_g: 0, total_carbs_g: 0, total_fat_g: 0,
        },
      };
    }),
  },
  waterApi: {
    log: jest.fn(async (data: { amount_ml: number; date?: string }, key?: string) => {
      const k = key ?? `no-key-${mockServer.posts.length}`;
      mockGate('water', k);
      mockMarks.onWater?.();
      if (mockServer.slowWater) await mockWait(mockServer.slowWater);
      let row = mockServer.water.find((r) => r.client_uuid === k);
      if (!row) {
        mockServer.water.push((row = { id: `w-${mockServer.water.length + 1}`, client_uuid: k, member: mockUser.id ?? '', date: data.date ?? '',
          amount_ml: data.amount_ml }));
      }
      if (mockServer.loseAnswer) throw new Error('Network Error');
      return { data: { id: row.id, amount_ml: row.amount_ml, logged_at: `${row.date}T12:00:00.000Z` } };
    }),
    getDaily: jest.fn(async (date: string) => {
      const logs = mockServer.water.filter((r) => r.date === date && r.member === mockUser.id)
        .map((r) => ({ id: r.id, amount_ml: r.amount_ml as number, logged_at: `${date}T12:00:00.000Z` }));
      return { data: { total_ml: logs.reduce((t, l) => t + l.amount_ml, 0), logs } };
    }),
    deleteEntry: jest.fn(async () => ({ data: {} })),
  },
  weightApi: {
    log: jest.fn(async (data: { weight_lbs: number; date?: string }, key?: string) => {
      const k = key ?? `no-key-${mockServer.posts.length}`;
      mockGate('weight', k);
      let row = mockServer.weight.find((r) => r.client_uuid === k);
      if (!row) {
        mockServer.weight.push((row = { id: `g-${mockServer.weight.length + 1}`, client_uuid: k, member: mockUser.id ?? '', date: data.date ?? '',
          weight_lbs: data.weight_lbs }));
      }
      return { data: row };
    }),
    getHistory: jest.fn(async () => ({ data: { logs: [] } })),
    takeKeptKey: jest.fn(() => undefined),
  },
}));

import { useClientStore } from '../../store/clientStore';
import { notifyPendingFoodLogs, subscribePendingFoodLogs, syncFoodLogQueue } from '../foodLogSync';
import * as queue from '../foodLogQueue';
import { sendUnsyncedLogs } from '../authActions';

const { foodApi } = jest.requireMock('../api') as { foodApi: { create: jest.Mock } };

const DAY = '2026-11-12';
const keyOf = (member: string) => `pending_food_logs_${member}`;
const day = () => useClientStore.getState();
const stored = async (key = keyOf('member-1')): Promise<Array<{ id: string; kind: string; parkedAt?: number }>> =>
  JSON.parse((await AsyncStorage.getItem(key)) ?? '[]');
async function put(entries: object[], key = keyOf('member-1')) {
  await AsyncStorage.setItem(key, JSON.stringify([...(await stored(key)), ...entries]));
}
/** A hand-typed food (kind 'manual' with a food block): its send runs foodApi.create first (POST /foods, no key). */
const soup = (id = 'pfl-soup') => ({
  id, createdAt: 0, kind: 'manual', shown: { name: 'Home soup', calories: 200, protein_g: 8, carbs_g: 20, fat_g: 6 },
  food: { name: 'Home soup', brand_or_restaurant: null, category: 'generic', serving_description: '1 bowl', serving_size_grams: null,
    calories: 200, protein_g: 8, carbs_g: 20, fat_g: 6, tags: [], search_aliases: [] },
  log: { date: DAY, meal_type: 'lunch', quantity_multiplier: 1 },
});
const glass = (id: string, amount_ml = 237) => ({ id, createdAt: 1, kind: 'water', log: { date: DAY, amount_ml } });
const weighIn = (id: string) => ({ id, createdAt: 2, kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } });
/** The food's create answers after 40 ms, so a second caller arrives while the first flush is still sending. */
const slowCreate = () => foodApi.create.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: { id: 'food-new' } }), 40)));
const perKey = () => {
  const n: Record<string, number> = {};
  mockServer.posts.forEach((p) => { n[`${p.kind}:${p.key}`] = (n[`${p.kind}:${p.key}`] ?? 0) + 1; });
  return n;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  foodApi.create.mockImplementation(async () => ({ data: { id: 'food-new' } }));
  Object.assign(mockServer, {
    water: [{ id: 'w-0', client_uuid: 'k-morning', member: 'member-1', date: DAY, amount_ml: 473 }],
    weight: [], food: [], posts: [], loseAnswer: false, transient: null, slowWater: 0, down: false,
  });
  Object.assign(mockMarks, { aDone: false, onWater: null });
  mockFlags.inDay = true;
  mockUser.id = 'member-1';
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(DAY);
  await useClientStore.getState().loadDayData('member-1', DAY);
});

describe('REFINE-972 B2: one flush at a time', () => {
  it('sync + day read (LS B2): the day read shares the running flush; the food is created once, each key sent once', async () => {
    slowCreate();
    await put([soup(), glass('pfl-glass')]);
    await notifyPendingFoodLogs();
    const sync = syncFoodLogQueue(); // the foreground or cold-start sync (useFoodLogQueueSync.ts:19, :30)
    await day().loadDayData('member-1', DAY); // Home's read of today at the same moment (HomeScreen.tsx:306, :323)
    await sync;
    expect(foodApi.create).toHaveBeenCalledTimes(1);
    expect(perKey()).toEqual({ 'food:pfl-soup': 1, 'water:pfl-glass': 1 });
    expect(mockServer.food).toHaveLength(1);
    // The food is in its day once, and the glass is counted once (473 + 237 ml = 24 oz).
    expect(day().foodLogs.filter((f) => f.foodName === 'Home soup')).toHaveLength(1);
    expect(day().dailyTotals.calories).toBe(200);
    expect(day().waterOz).toBe(24);
  });

  it('sync + sign-out try (LO C3): one foodApi.create, one POST per key', async () => {
    slowCreate();
    await put([soup(), glass('pfl-glass')]);
    const sync = syncFoodLogQueue();
    const signOutTry = sendUnsyncedLogs('member-1'); // authActions.ts:379, the bounded try before a sign-out
    await Promise.all([sync, signOutTry]);
    expect(foodApi.create).toHaveBeenCalledTimes(1);
    expect(perKey()).toEqual({ 'food:pfl-soup': 1, 'water:pfl-glass': 1 });
    expect(await signOutTry).toEqual(expect.objectContaining({ foods: 0, water: 0 }));
  });

  it('day read + sign-out try: one foodApi.create, one POST per key', async () => {
    slowCreate();
    await put([soup(), glass('pfl-glass')]);
    const read = day().loadDayData('member-1', DAY);
    const signOutTry = sendUnsyncedLogs('member-1');
    await Promise.all([read, signOutTry]);
    expect(foodApi.create).toHaveBeenCalledTimes(1);
    expect(perKey()).toEqual({ 'food:pfl-soup': 1, 'water:pfl-glass': 1 });
  });

  it('sync + sync: still one shared send (foodLogSync.ts:87, kept)', async () => {
    slowCreate();
    await put([soup()]);
    const [a, b] = [syncFoodLogQueue(), syncFoodLogQueue()];
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(foodApi.create).toHaveBeenCalledTimes(1);
    expect(perKey()).toEqual({ 'food:pfl-soup': 1 });
  });

  it('owner rule: a caller for account B never takes A\'s running flush as its own; B\'s queue is sent after, under B only', async () => {
    await put([glass('pfl-a')], keyOf('member-1'));
    await put([glass('pfl-b')], keyOf('member-2'));
    mockServer.slowWater = 40;
    const aPosted = new Promise<void>((resolve) => { mockMarks.onWater = resolve; });
    const a = queue.flush(); // captured for member-1
    await aPosted; // A's POST is in flight
    mockMarks.onWater = null;
    mockServer.slowWater = 0;
    mockUser.id = 'member-2'; // an account switch while A's send is in flight
    const b = queue.flush();
    expect(b).not.toBe(a);
    const ra = await a;
    mockMarks.aDone = true;
    const rb = await b;
    // A's glass reached the server under A's session only; the fence kept it in A's queue (the owner changed).
    expect(mockServer.posts.filter((p) => p.key === 'pfl-a').map((p) => p.member)).toEqual(['member-1']);
    expect(ra.flushed).toBe(0);
    expect((await stored(keyOf('member-1'))).map((x) => x.id)).toEqual(['pfl-a']);
    // B's own send ran after A's flush ended, under B's session, and B's result is its own.
    expect(mockServer.posts.filter((p) => p.key === 'pfl-b')).toEqual([{ kind: 'water', key: 'pfl-b', member: 'member-2', afterOtherFlush: true }]);
    expect(rb.flushed).toBe(1);
    expect(await stored(keyOf('member-2'))).toEqual([]);
  });
});

describe('REFINE-972 B2 follow-ups: a food the day read\'s send delivered stays, and the count is told (LO B2, LS C1)', () => {
  it('after a sync that stopped on "try again later", the day read sends; the food stays in its day and the pending count drops to 0', async () => {
    const counts: number[] = [];
    const off = subscribePendingFoodLogs((n) => counts.push(n));
    await put([soup('pfl-f1'), glass('pfl-w1')]);
    await notifyPendingFoodLogs();
    expect(counts[counts.length - 1]).toBe(1);
    mockServer.transient = { status: 503 };
    await syncFoodLogQueue();
    expect(await stored()).toHaveLength(2);
    mockServer.transient = null;
    // Pull to refresh on Home (HomeScreen.tsx:327-333): a day read with no sync beside it sends both.
    await day().loadDayData('member-1', DAY);
    expect(perKey()).toEqual({ 'food:pfl-f1': 2, 'water:pfl-w1': 1 });
    expect(await stored()).toEqual([]);
    expect(day().foodLogs.map((f) => f.id)).toContain('pfl-f1');
    expect(day().dailyTotals.calories).toBe(200);
    // The Food log's note ("1 food saved offline is not in this log ...") hears that nothing waits now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(counts[counts.length - 1]).toBe(0);
    // The next reconnect sync has nothing to send: the food the server holds is still in its day (LO B2).
    await syncFoodLogQueue();
    expect(day().foodLogs.map((f) => f.id)).toContain('pfl-f1');
    expect(day().dailyTotals.calories).toBe(200);
    off();
  });
});

describe('REFINE-972 C (LS C2 = LO C2): two lost answers in a row (edge, deferred to 10k clients; WATER-DAY-KEY-BE closes it)', () => {
  // Kept failing on purpose: it passes while the day counts the glass twice. One flush at a time does not change this
  // window (both lost answers are single sends of the same key).
  it.failing('a glass stored with its answer lost, a good water read, then the day read\'s send losing its answer too: counted once', async () => {
    await put([glass('pfl-lost')]);
    mockServer.loseAnswer = true;
    await syncFoodLogQueue(); // stored on the server, its answer lost: it stays queued
    expect(mockServer.water.filter((r) => r.client_uuid === 'pfl-lost')).toHaveLength(1);
    await day().loadDayData('member-1', DAY); // the read holds it; the day read's send loses its answer too
    mockServer.loseAnswer = false;
    expect(day().waterOz).toBe(24); // 473 + 237 ml, once
  });
});

describe('REFINE-972 (LO C4 = LS C3): G5, a weigh-in\'s own 503 and 429', () => {
  it('the weigh-in first in the queue: 503, then 429 with Retry-After: nothing parks; it sends once the wait is over', async () => {
    await put([weighIn('pfl-g1'), glass('pfl-w1')]);
    mockServer.transient = { status: 503 };
    await queue.flush();
    mockServer.transient = { status: 429, retryAfter: '30' };
    await queue.flush();
    expect(mockServer.posts.map((p) => p.key)).toEqual(['pfl-g1', 'pfl-g1']);
    expect((await stored()).map((x) => [x.id, x.parkedAt ?? null])).toEqual([['pfl-g1', null], ['pfl-w1', null]]);
    mockServer.transient = null;
    await queue.flush(); // inside the server's 30 s: nothing is sent
    expect(mockServer.posts).toHaveLength(2);
    const now = Date.now();
    const later = jest.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    const r = await queue.flush().finally(() => later.mockRestore());
    expect(r).toEqual(expect.objectContaining({ flushed: 2, parked: 0 }));
    expect(mockServer.posts.map((p) => p.key)).toEqual(['pfl-g1', 'pfl-g1', 'pfl-g1', 'pfl-w1']);
  });
});
