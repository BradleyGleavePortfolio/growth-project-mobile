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
const historyRows = async () => weightHistoryRows((await api.weightApi.getHistory()).data).map((r) => parseWeightLogRow(r, 'member-1'));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.assign(mockServer, {
    water: [{ id: 'w-0', client_uuid: 'k-morning', member: 'member-1', date: DAY, amount_ml: 473 }],
    weight: [], food: [], posts: [], loseAnswer: false, refuse: {}, transient: null, readFails: false, waterReadFails: false,
  });
  mockFlags.inDay = true;
  mockUser.id = 'member-1';
  jest.useRealTimers();
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(DAY);
  await useClientStore.getState().loadDayData('member-1', DAY);
});

describe('water saved with no signal', () => {
  it('W1: +8 oz with no signal is queued under its key, counts at once, and makes no server call or "not saved" line', async () => {
    expect(day().waterOz).toBe(16);
    await day().logWater('member-1', '', 8, false);
    const q = await stored();
    expect(q).toHaveLength(1);
    expect(q[0]).toEqual(expect.objectContaining({ kind: 'water', log: { date: DAY, amount_ml: 237 } }));
    expect(q[0].id).toMatch(/^pfl_/);
    expect(day().waterOz).toBe(24);
    expect(day().loadError).toBeNull();
    expect(api.waterApi.log).not.toHaveBeenCalled();
    // A day read that fails keeps it counted.
    mockServer.readFails = true;
    await day().loadDayData('member-1', DAY);
    expect(day().waterOz).toBe(24);
  });

  it('W2: the signal returns: one POST with the day it was added on and the entry id as key, then counted once', async () => {
    await day().logWater('member-1', '', 8, false);
    const [{ id }] = await stored();
    await syncFoodLogQueue();
    expect(waterPosts()).toHaveLength(1);
    expect(waterPosts()[0]).toEqual(expect.objectContaining({ key: id, header: id, body: expect.objectContaining({ amount_ml: 237, date: DAY, client_uuid: id }) }));
    expect(await stored()).toHaveLength(0);
    expect(day().waterOz).toBe(24);
    await day().loadDayData('member-1', DAY);
    expect(day().waterOz).toBe(24);
    expect(day().waterEntries.map((e) => e.id)).toEqual(['w-0', mockServer.water[1].id]);
  });

  it('W3: the send reached the server but its answer was lost: it stays queued, the resend sends the same key, one row, one count', async () => {
    await day().logWater('member-1', '', 8, false);
    const [{ id }] = await stored();
    mockServer.loseAnswer = true;
    await queue.flush();
    expect(await stored()).toHaveLength(1);
    mockServer.loseAnswer = false;
    await syncFoodLogQueue();
    expect(waterPosts().map((p) => p.key)).toEqual([id, id]);
    expect(mockServer.water).toHaveLength(2);
    expect(day().waterOz).toBe(24);
  });

  it('W4: refused (400, or 404 for another member key): parked, never resent, counted nowhere, shown with its line; the next entry still sends', async () => {
    for (const status of [400, 404]) {
      await AsyncStorage.clear();
      mockServer.posts = [];
      await put([glassEntry(`pfl_r${status}`), glassEntry(`pfl_n${status}`, 355)]);
      mockServer.refuse = { [`pfl_r${status}`]: status };
      await queue.flush();
      const q = await stored();
      expect(q.find((x) => x.id === `pfl_r${status}`)?.parkedAt).toEqual(expect.any(Number));
      await queue.flush();
      expect(waterPosts().filter((p) => p.key === `pfl_r${status}`)).toHaveLength(1);
      expect(waterPosts().filter((p) => p.key === `pfl_n${status}`).length).toBeGreaterThan(0);
    }
    await notifyPendingFoodLogs();
    await day().loadDayData('member-1', DAY);
    const refused = day().waterEntries.find((e) => e.id === 'pfl_r404');
    expect(refused?.offline).toBe('refused');
    // What the server holds (the morning glass and the two sent ones) only; the refused glasses are in no total.
    expect(mockServer.water.map((r) => r.client_uuid)).toEqual(['k-morning', 'pfl_n400', 'pfl_n404']);
    expect(day().waterOz).toBe(Math.round((473 + 355 + 355) / 29.5735));
  });

  it('W5: a 503, or 429 with Retry-After: the flush stops, nothing parks, the entries send after the wait', async () => {
    for (const transient of [{ status: 503 }, { status: 429, retryAfter: '30' }]) {
      await AsyncStorage.clear();
      mockServer.posts = [];
      await put([glassEntry('pfl_t1'), weighInEntry('pfl_t2')]);
      // A clock well in the past, so the server's pause never reaches the cases after this one.
      const past = Date.now() - 10_000_000;
      const clock = jest.spyOn(Date, 'now').mockReturnValue(past);
      mockServer.transient = transient;
      await queue.flush();
      expect(mockServer.posts).toHaveLength(1);
      expect((await stored()).every((x) => !x.parkedAt)).toBe(true);
      mockServer.transient = null;
      if (transient.retryAfter) {
        // Inside the server's 30 s pause nothing is sent.
        clock.mockReturnValue(past + 10_000);
        await queue.flush();
        expect(mockServer.posts).toHaveLength(1);
      }
      clock.mockReturnValue(past + 61_000);
      await queue.flush();
      clock.mockRestore();
      expect(await stored()).toHaveLength(0);
      expect(mockServer.posts.map((p) => p.key)).toEqual(['pfl_t1', 'pfl_t1', 'pfl_t2']);
    }
  });

  it('W6: a day no read has reached shows no water number; once a read lands the waiting glass counts', async () => {
    await day().logWater('member-1', '', 8, false);
    day().reset();
    mockServer.readFails = true;
    day().setSelectedDate(DAY);
    await day().loadDayData('member-1', DAY);
    expect(day().hasLoadedDay).toBe(false);
    expect(day().waterOz).toBe(0);
    mockServer.readFails = false;
    mockServer.loseAnswer = true; // the flush before the read is applied cannot send it either
    await day().loadDayData('member-1', DAY);
    expect(day().waterOz).toBe(24);
  });

  it('W8: an online glass whose answer was lost, then the same glass with no signal: the queue id is the kept key, one row', async () => {
    mockServer.loseAnswer = true;
    await day().logWater('member-1', '', 8, true);
    const onlineKey = waterPosts()[0].key;
    expect(mockServer.water).toHaveLength(2);
    mockServer.loseAnswer = false;
    await day().logWater('member-1', '', 8, false);
    expect((await stored())[0].id).toBe(onlineKey);
    await syncFoodLogQueue();
    expect(mockServer.water).toHaveLength(2);
    expect(day().waterOz).toBe(24);
  });

  it('W9: a food read never settles a sent glass; a failed water read keeps it; only a good water read of its day settles it', async () => {
    await put([glassEntry('pfl_s1')]);
    await queue.flush();
    expect((await stored(SENT_KEY)).map((s) => s.id)).toEqual(['pfl_s1']);
    // The food read's settle drops foods of the day only.
    await queue.settleSent(DAY, () => false);
    expect((await stored(SENT_KEY)).map((s) => s.id)).toEqual(['pfl_s1']);
    mockServer.waterReadFails = true;
    await day().loadDayData('member-1', DAY);
    expect((await stored(SENT_KEY)).map((s) => s.id)).toEqual(['pfl_s1']);
    mockServer.waterReadFails = false;
    await day().loadDayData('member-1', DAY);
    expect(await stored(SENT_KEY)).toHaveLength(0);
    expect(day().waterOz).toBe(24);
  });

  it('W10: Remove on a waiting glass takes it off the phone with no server call', async () => {
    await day().logWater('member-1', '', 8, false);
    const [{ id }] = await stored();
    expect(day().waterEntries.find((e) => e.id === id)?.offline).toBe('waiting');
    await day().removeWaterEntry(id);
    expect(api.waterApi.deleteEntry).not.toHaveBeenCalled();
    expect(await stored()).toHaveLength(0);
    expect(day().waterOz).toBe(16);
  });

  it('W11: a send stored with its answer lost, then a good water read before the next flush: counted once', async () => {
    await day().logWater('member-1', '', 8, false);
    mockServer.loseAnswer = true;
    await queue.flush();
    mockServer.loseAnswer = false;
    // The read already holds the glass; the phone still queues it.
    await day().loadDayData('member-1', DAY);
    expect(mockServer.water).toHaveLength(2);
    expect(day().waterOz).toBe(24);
    expect(day().waterEntries).toHaveLength(2);
  });
});

describe('weigh-ins saved with no signal', () => {
  it('G2: one POST /weight with client_uuid = the entry id; a history read holding that key shows it once', async () => {
    await queue.enqueueWaterWeight('member-1', { kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } }, 'pfl_g1');
    await syncFoodLogQueue();
    expect(weightPosts()).toEqual([expect.objectContaining({ key: 'pfl_g1', body: expect.objectContaining({ weight_lbs: 181.4, date: DAY, client_uuid: 'pfl_g1' }) })]);
    expect(await stored()).toHaveLength(0);
    const rows = (await historyRows()).filter((r) => r !== null);
    expect(rows.map((r) => r?.clientUuid)).toEqual(['pfl_g1']);
  });

  it('G3: answer lost: stays queued, the resend sends the same key, one row', async () => {
    await put([weighInEntry('pfl_g3')]);
    mockServer.loseAnswer = true;
    await queue.flush();
    mockServer.loseAnswer = false;
    await queue.flush();
    expect(weightPosts().map((p) => p.key)).toEqual(['pfl_g3', 'pfl_g3']);
    expect(mockServer.weight).toHaveLength(1);
    expect(await stored()).toHaveLength(0);
  });

  it('G4: refused: parked, never resent, the next entry still sends', async () => {
    await put([weighInEntry('pfl_g4'), weighInEntry('pfl_g5', 180.2)]);
    mockServer.refuse = { pfl_g4: 400 };
    await queue.flush();
    await queue.flush();
    expect(weightPosts().filter((p) => p.key === 'pfl_g4')).toHaveLength(1);
    expect(mockServer.weight.map((r) => r.client_uuid)).toEqual(['pfl_g5']);
    expect((await stored()).map((x) => [x.id, !!x.parkedAt])).toEqual([['pfl_g4', true]]);
  });
});

describe('one queue', () => {
  it('M1: a food, a glass and a weigh-in saved with no signal send in that order in one flush; a parked one never blocks the next', async () => {
    await put([foodEntry('pfl_f1'), glassEntry('pfl_w1'), weighInEntry('pfl_g1')]);
    const out = await queue.flush();
    expect(mockServer.posts.map((p) => [p.kind, p.key])).toEqual([['food', 'pfl_f1'], ['water', 'pfl_w1'], ['weight', 'pfl_g1']]);
    expect(out).toEqual({ flushed: 3, remaining: 0, parked: 0 });
    expect(api.logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ food_item_id: 'food-oats', client_uuid: 'pfl_f1' }));
  });

  it('M2: no reader of foods sees a glass or a weigh-in', async () => {
    const signal = jest.spyOn(tutorial, 'emitTutorialSignal');
    await queue.enqueueWaterWeight('member-1', { kind: 'water', log: { date: DAY, amount_ml: 237 } });
    await queue.enqueueWaterWeight('member-1', { kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } });
    expect(signal).not.toHaveBeenCalledWith('meal_logged');
    await put([foodEntry('pfl_f1'), glassEntry('pfl_w9')]);
    expect(await queue.getQueueLength()).toBe(1);
    expect(await queue.getQueueLength({ includeParked: true })).toBe(1);
    expect(await readPendingFoodLogCount()).toBe(1);
    expect((await queue.readQueue()).map((q) => q.id)).toEqual(['pfl_f1']);
    await put([{ ...glassEntry('pfl_ws'), sentAt: 1 }, { ...foodEntry('pfl_fs'), sentAt: 1 }], SENT_KEY);
    expect((await queue.readSent()).map((q) => q.id)).toEqual(['pfl_fs']);
    const joined = withQueuedFoods([], { calories: 0, protein: 0, carbs: 0, fat: 0 },
      [...(await stored()) as never[]], DAY, 'member-1');
    expect(joined.foodLogs.map((f) => f.id)).toEqual(['pfl_f1']);
    expect(joined.dailyTotals.calories).toBe(150);
    await notifyPendingFoodLogs();
    expect(day().queuedFoods.map((q) => q.id)).toEqual(['pfl_f1']);
  });

  it('M5: entries written before an app kill are still there after a fresh load, and the cold start sends them with the same key, counted once', async () => {
    await day().logWater('member-1', '', 8, false);
    await queue.enqueueWaterWeight('member-1', { kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } }, 'pfl_m5');
    const ids = (await stored()).map((q) => q.id);
    let fresh: typeof import('../foodLogSync') | undefined;
    let freshQueue: typeof import('../foodLogQueue') | undefined;
    jest.isolateModules(() => {
      fresh = require('../foodLogSync');
      freshQueue = require('../foodLogQueue');
    });
    expect((await freshQueue!.readWaterWeight()).queue.map((q) => q.id)).toEqual(ids);
    await fresh!.syncFoodLogQueue();
    expect(mockServer.posts.map((p) => p.key)).toEqual(ids);
    expect(mockServer.water).toHaveLength(2);
    expect(mockServer.weight).toHaveLength(1);
    await day().loadDayData('member-1', DAY);
    expect(day().waterOz).toBe(24);
  });

  it('M6: switch off: a glass and a weigh-in are still queued and sent once, and not joined into the totals', async () => {
    mockFlags.inDay = false;
    await day().loadDayData('member-1', DAY);
    await day().logWater('member-1', '', 8, false);
    await queue.enqueueWaterWeight('member-1', { kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } });
    expect(await stored()).toHaveLength(2);
    expect(day().waterOz).toBe(16);
    expect(day().queuedWaterWeight.map((q) => q.kind)).toEqual(['water']);
    await syncFoodLogQueue();
    await syncFoodLogQueue();
    expect(waterPosts()).toHaveLength(1);
    expect(weightPosts()).toHaveLength(1);
    await day().loadDayData('member-1', DAY);
    expect(day().waterOz).toBe(24);
  });
});
