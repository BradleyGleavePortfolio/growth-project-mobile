/**
 * OFFLINE-WATER-WEIGHT-M (191-S5): a glass of water and a weigh-in saved with no signal go through the queue food
 * already uses (foodLogQueue), count in the day at once (featureFlags.offlineFoodInDay on) and send once when the
 * signal returns: never counted twice (the join is the save's key; backend #1206 answers a resend of a key with the
 * first row, CONTRACT 6588001442), never zero times. Runs the REAL queue, sync and client store against a fake server.
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
}));

type Row = { id: string; client_uuid: string; member: string; date: string; amount_ml?: number; weight_lbs?: number; notes?: string };
const mockServer = {
  water: [] as Row[],
  weight: [] as Row[],
  food: [] as { id: string; client_uuid: string; date: string }[],
  /** Each POST that reached the server, in order (the kind and the key). */
  posts: [] as { kind: string; key: string; header?: string; body: Record<string, unknown> }[],
  loseAnswer: false,
  /** Keys the server refuses, with the status (400 a bad save, 404 another member's key). */
  refuse: {} as Record<string, number>,
  transient: null as null | { status: number; retryAfter?: string },
  readFails: false,
  waterReadFails: false,
  /** No signal: a send reaches nobody (the reads keep their own switches). */
  down: false,
};
const mockFail = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
/** backend saveOnce: a key the server holds answers with its first row; another member's key is a 404. */
function mockSaveOnce(table: Row[], key: string, make: () => Row): Row {
  const held = table.find((r) => r.client_uuid === key);
  if (held && held.member !== mockUser.id) throw mockFail(404);
  if (held) return held;
  const row = make();
  table.push(row);
  return row;
}
function mockGate(kind: string, key: string, body: Record<string, unknown>, header?: string) {
  if (mockServer.down) throw new Error('Network Error');
  mockServer.posts.push({ kind, key, header, body });
  if (mockServer.transient) throw mockFail(mockServer.transient.status, mockServer.transient.retryAfter ? { 'retry-after': mockServer.transient.retryAfter } : {});
  if (mockServer.refuse[key]) throw mockFail(mockServer.refuse[key]);
}

jest.mock('../api', () => ({
  foodApi: { create: jest.fn(async () => ({ data: { id: 'food-new' } })) },
  logApi: {
    logFood: jest.fn(async (body: { client_uuid: string; date: string }) => {
      mockGate('food', body.client_uuid, body);
      let row = mockServer.food.find((f) => f.client_uuid === body.client_uuid);
      if (!row) mockServer.food.push((row = { id: `food-${mockServer.food.length + 1}`, client_uuid: body.client_uuid, date: body.date }));
      if (mockServer.loseAnswer) throw new Error('Network Error');
      return { data: row };
    }),
    getDaily: jest.fn(async () => {
      if (mockServer.readFails) throw new Error('Network Error');
      return { data: { entries: [], total_calories: 0, total_protein_g: 0, total_carbs_g: 0, total_fat_g: 0 } };
    }),
  },
  waterApi: {
    log: jest.fn(async (data: { amount_ml: number; date?: string }, key?: string) => {
      const k = key ?? `no-key-${mockServer.posts.length}`;
      mockGate('water', k, { ...data, client_uuid: key }, key);
      const row = mockSaveOnce(mockServer.water, k, () => ({
        id: `w-${mockServer.water.length + 1}`, client_uuid: k, member: mockUser.id ?? '', date: data.date ?? '', amount_ml: data.amount_ml,
      }));
      if (mockServer.loseAnswer) throw new Error('Network Error');
      return { data: { id: row.id, amount_ml: row.amount_ml, logged_at: `${row.date}T12:00:00.000Z` } };
    }),
    getDaily: jest.fn(async (date: string) => {
      if (mockServer.readFails || mockServer.waterReadFails) throw new Error('Network Error');
      const logs = mockServer.water.filter((r) => r.date === date && r.member === mockUser.id)
        .map((r) => ({ id: r.id, amount_ml: r.amount_ml as number, logged_at: `${date}T12:00:00.000Z` }));
      return { data: { total_ml: logs.reduce((t, l) => t + l.amount_ml, 0), logs } };
    }),
    deleteEntry: jest.fn(async () => ({ data: {} })),
  },
  weightApi: {
    log: jest.fn(async (data: { weight_lbs: number; date?: string; notes?: string }, key?: string) => {
      const k = key ?? `no-key-${mockServer.posts.length}`;
      mockGate('weight', k, { ...data, client_uuid: key });
      const row = mockSaveOnce(mockServer.weight, k, () => ({
        id: `g-${mockServer.weight.length + 1}`, client_uuid: k, member: mockUser.id ?? '', date: data.date ?? '', weight_lbs: data.weight_lbs, notes: data.notes,
      }));
      if (mockServer.loseAnswer) throw new Error('Network Error');
      return { data: row };
    }),
    getHistory: jest.fn(async () => ({
      data: { logs: mockServer.weight.filter((r) => r.member === mockUser.id).map((r) => ({ id: r.id, weight_lbs: r.weight_lbs, date: `${r.date}T00:00:00.000Z`, client_uuid: r.client_uuid })) },
    })),
    takeKeptKey: jest.fn(() => undefined),
  },
}));

import { useClientStore } from '../../store/clientStore';
import { syncFoodLogQueue, notifyPendingFoodLogs, readPendingFoodLogCount } from '../foodLogSync';
import * as queue from '../foodLogQueue';
import { withQueuedFoods } from '../../utils/log/queuedDay';
import { parseWeightLogRow, weightHistoryRows } from '../../screens/client/progress/weightHistory';
import * as tutorial from '../../tutorial/tutorialEvents';

const api = jest.requireMock('../api') as {
  waterApi: { log: jest.Mock; getDaily: jest.Mock; deleteEntry: jest.Mock };
  weightApi: { log: jest.Mock; getHistory: jest.Mock };
  logApi: { logFood: jest.Mock };
};

const DAY = '2026-11-12';
const KEY = 'pending_food_logs_member-1';
const SENT_KEY = 'sent_food_logs_member-1';
const day = () => useClientStore.getState();
const stored = async (key = KEY): Promise<Array<{ id: string; kind: string; parkedAt?: number; log: Record<string, unknown> }>> =>
  JSON.parse((await AsyncStorage.getItem(key)) ?? '[]');
/** An entry of the shape the queue keeps (queued by this build's save path), written straight to the phone. */
async function put(entries: object[], key = KEY) {
  await AsyncStorage.setItem(key, JSON.stringify([...(await stored(key)), ...entries]));
}
const glassEntry = (id: string, amount_ml = 237, date = DAY) => ({ id, createdAt: 1, kind: 'water', log: { date, amount_ml } });
const weighInEntry = (id: string, weight_lbs = 181.4, date = DAY) => ({ id, createdAt: 2, kind: 'weight', log: { date, weight_lbs } });
const foodEntry = (id: string, date = DAY) => ({
  id, createdAt: 0, kind: 'search', foodItemId: 'food-oats', shown: { name: 'Rolled oats', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
  log: { date, meal_type: 'breakfast', quantity_multiplier: 1 },
});
const waterPosts = () => mockServer.posts.filter((p) => p.kind === 'water');
const weightPosts = () => mockServer.posts.filter((p) => p.kind === 'weight');
/** +8 oz with no signal (the call site passes its network state; nothing reaches the server). */
async function addGlassOffline(oz = 8) {
  mockServer.down = true;
  try {
    await day().logWater('member-1', '', oz, false);
  } finally {
    mockServer.down = false;
  }
}
const historyRows = async () => weightHistoryRows((await api.weightApi.getHistory()).data).map((r) => parseWeightLogRow(r, 'member-1'));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.assign(mockServer, {
    water: [{ id: 'w-0', client_uuid: 'k-morning', member: 'member-1', date: DAY, amount_ml: 473 }],
    weight: [], food: [], posts: [], loseAnswer: false, refuse: {}, transient: null, readFails: false, waterReadFails: false, down: false,
  });
  mockFlags.inDay = true;
  mockUser.id = 'member-1';
  jest.useRealTimers();
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(DAY);
  await useClientStore.getState().loadDayData('member-1', DAY);
});

describe('LO-972R1 B1: the day read\'s own flush', () => {
  it('B1: a food sent by the flush before the day read is applied stays in its day after the next sync, until a read holds it', async () => {
    // No signal: a breakfast and a glass of the same day wait on the phone, both shown and counted.
    await put([foodEntry('pfl_f1'), glassEntry('pfl_w1')]);
    await notifyPendingFoodLogs();
    expect(day().dailyTotals.calories).toBe(150);
    // Signal back but weak: the reconnect sync's send ends with "try again later"; both still wait.
    mockServer.transient = { status: 503 };
    await syncFoodLogQueue();
    expect(await stored()).toHaveLength(2);
    mockServer.transient = null;
    // A good day read (the Log tab opened, a day switched back): its flush before the read is applied sends both.
    await day().loadDayData('member-1', DAY);
    expect(mockServer.posts.map((p) => [p.kind, p.key]).slice(-2)).toEqual([['food', 'pfl_f1'], ['water', 'pfl_w1']]);
    expect(day().dailyTotals.calories).toBe(150);
    // The next reconnect sync has nothing left to send. The breakfast the server now holds must still be in the day.
    await syncFoodLogQueue();
    expect(day().foodLogs.map((f) => f.id)).toEqual(['pfl_f1']);
    expect(day().dailyTotals.calories).toBe(150);
  });
});
