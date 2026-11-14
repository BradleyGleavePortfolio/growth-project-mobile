/**
 * OFFLINE-WATER-WEIGHT-M: the two joins, by key only.
 *   - weightHistory.withQueuedWeighIns: a waiting or sent weigh-in counts once until a history row carries its key
 *     (client_uuid, read by parseWeightLogRow); never matched by number or day; a refused one counts nowhere.
 *   - queuedDay.withQueuedWater: a waiting glass counts; a sent one until the water read holds the id its answer
 *     carried; a refused one is listed and counted nowhere.
 */
const mockFlags = { inDay: true };
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: new Proxy({}, { get: (_t, key) => (key === 'offlineFoodInDay' ? mockFlags.inDay : false) }),
}));

import { parseWeightLogRow, withQueuedWeighIns } from '../weightHistory';
import { withQueuedWater } from '../../../../utils/log/queuedDay';
import type { PendingWaterWeightLog, SentWaterWeightLog } from '../../../../services/foodLogQueue';
import type { WeightLog } from '../../../../types';

const DAY = '2026-11-12';
const weighIn = (id: string, weight_lbs: number, extra: Partial<SentWaterWeightLog> = {}) =>
  ({ id, createdAt: 1, kind: 'weight', log: { date: DAY, weight_lbs }, ...extra }) as PendingWaterWeightLog;
const glass = (id: string, amount_ml: number, extra: Partial<SentWaterWeightLog> = {}) =>
  ({ id, createdAt: 1, kind: 'water', log: { date: DAY, amount_ml }, ...extra }) as SentWaterWeightLog;
const row = (id: string, weight: number, clientUuid?: string): WeightLog =>
  ({ id, userId: 'u1', coachId: '', date: DAY, weight, unit: 'lbs', createdAt: '', ...(clientUuid ? { clientUuid } : {}) });

beforeEach(() => {
  mockFlags.inDay = true;
});

describe('withQueuedWeighIns', () => {
  it('parseWeightLogRow keeps the row key', () => {
    expect(parseWeightLogRow({ id: 'g-1', date: `${DAY}T00:00:00.000Z`, weight_lbs: 181, client_uuid: 'pfl_1' }, 'u1')?.clientUuid).toBe('pfl_1');
    expect(parseWeightLogRow({ id: 'g-2', date: `${DAY}T00:00:00.000Z`, weight_lbs: 181 }, 'u1')).not.toHaveProperty('clientUuid');
  });

  it('a waiting weigh-in counts once; a refused one counts nowhere', () => {
    const out = withQueuedWeighIns([row('g-0', 180)], [weighIn('pfl_1', 181.4), weighIn('pfl_2', 175, { parkedAt: 5 })], 'u1');
    expect(out.map((r) => [r.id, r.weight])).toEqual([['g-0', 180], ['pfl_1', 181.4]]);
  });

  it('the queue and the sent list share one id: shown once', () => {
    const out = withQueuedWeighIns([], [weighIn('pfl_1', 181.4), weighIn('pfl_1', 181.4, { sentAt: 2 })], 'u1');
    expect(out).toHaveLength(1);
  });

  it('a row carrying its key is that weigh-in: shown once, from the server', () => {
    const out = withQueuedWeighIns([row('g-1', 181.4, 'pfl_1')], [weighIn('pfl_1', 181.4, { sentAt: 2 })], 'u1');
    expect(out.map((r) => r.id)).toEqual(['g-1']);
  });

  it('never joined by number or day: a server row of the same day and weight without its key is another weigh-in', () => {
    const out = withQueuedWeighIns([row('g-9', 181.4)], [weighIn('pfl_1', 181.4)], 'u1');
    expect(out.map((r) => r.id)).toEqual(['g-9', 'pfl_1']);
  });

  it('a glass is never a weigh-in', () => {
    expect(withQueuedWeighIns([], [glass('pfl_w', 237) as unknown as PendingWaterWeightLog], 'u1')).toEqual([]);
  });

  it('switch off: the rows as read', () => {
    mockFlags.inDay = false;
    const rows = [row('g-0', 180)];
    expect(withQueuedWeighIns(rows, [weighIn('pfl_1', 181.4)], 'u1')).toBe(rows);
  });
});

describe('withQueuedWater', () => {
  const server = { totalMl: 473, entries: [{ id: 'w-0', amount_ml: 473, logged_at: '' }] };

  it('a waiting glass is listed and counted; a refused one listed and not counted', () => {
    const out = withQueuedWater(server, [glass('pfl_1', 237), glass('pfl_2', 355, { parkedAt: 3 })], DAY);
    expect(out.waterOz).toBe(Math.round(710 / 29.5735));
    expect(out.waterEntries.map((e) => [e.id, e.offline])).toEqual([['w-0', undefined], ['pfl_1', 'waiting'], ['pfl_2', 'refused']]);
  });

  it('a sent glass counts until the read holds the id its answer carried, then once from the server', () => {
    const sent = glass('pfl_1', 237, { sentAt: 2, answerId: 'w-1' });
    expect(withQueuedWater(server, [sent], DAY).waterOz).toBe(Math.round(710 / 29.5735));
    const held = { totalMl: 710, entries: [...server.entries, { id: 'w-1', amount_ml: 237, logged_at: '' }] };
    const out = withQueuedWater(held, [sent], DAY);
    expect(out.waterOz).toBe(Math.round(710 / 29.5735));
    expect(out.waterEntries.map((e) => e.id)).toEqual(['w-0', 'w-1']);
  });

  it('never joined by amount: a server glass of the same amount is another glass', () => {
    const same = { totalMl: 710, entries: [...server.entries, { id: 'w-7', amount_ml: 237, logged_at: '' }] };
    expect(withQueuedWater(same, [glass('pfl_1', 237)], DAY).waterOz).toBe(Math.round(947 / 29.5735));
  });

  it('another day and a weigh-in are not this day\'s water', () => {
    const other = { ...glass('pfl_9', 237), log: { date: '2026-11-11', amount_ml: 237 } } as SentWaterWeightLog;
    expect(withQueuedWater(server, [other, weighIn('pfl_g', 181) as SentWaterWeightLog], DAY).waterEntries).toBe(server.entries);
  });
});
