/**
 * LS-PAYFAIL B10, class-first: every async write in the client day store
 * (the day read and its failure, a water add and its rollback, the refresh
 * after a food log, a water delete) belongs to the account that started it.
 * After the sign-out reset its late reply never touches the next account;
 * without a sign-out the same reply still lands (the control column).
 */
import { useClientStore } from '../clientStore';

const mockGetFood = jest.fn();
const mockLogFood = jest.fn();
const mockGetWater = jest.fn();
const mockLogWater = jest.fn();
const mockDeleteWater = jest.fn();

jest.mock('../../services/api', () => ({
  logApi: {
    getDaily: (...args: unknown[]) => mockGetFood(...args),
    logFood: (...args: unknown[]) => mockLogFood(...args),
  },
  waterApi: {
    getDaily: (...args: unknown[]) => mockGetWater(...args),
    log: (...args: unknown[]) => mockLogWater(...args),
    deleteEntry: (...args: unknown[]) => mockDeleteWater(...args),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));

type S = ReturnType<typeof useClientStore.getState>;
const OTHER_DAY = '2026-10-01';
const day = { data: { entries: [], total_calories: 420, total_protein_g: 30, total_carbs_g: 50, total_fat_g: 11 } };
const water = { data: { total_ml: 237, logs: [{ id: 'synthetic-water-1', amount_ml: 237, logged_at: '2026-10-30T08:00:00Z' }] } };
const oldFood = {
  data: {
    ...day.data,
    entries: [{
      id: 'synthetic-old-food', user_id: 'synthetic-old-account', food_item_id: 'synthetic-oats',
      meal_type: 'breakfast', quantity_multiplier: 1,
      food_item: { id: 'synthetic-oats', name: 'Synthetic prior account food', calories: 420, protein_g: 30, carbs_g: 50, fat_g: 11 },
    }],
  },
};

function held() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// name | the held call | how the old reply ends | the old work | did the old reply write?
type Row = [string, jest.Mock, 'resolve' | 'reject', unknown, (s: S) => Promise<unknown>, (s: S) => boolean];
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
type Case = [string, boolean, ...Tail<Row>]; // name, signed out between, the rest of the row
const rows: Row[] = [
  ['day read reply', mockGetFood, 'resolve', oldFood, (s) => s.loadDayData('synthetic-old-account', s.selectedDate),
    (s) => s.foodLogs.some((f) => f.id === 'synthetic-old-food')],
  ['day read failure', mockGetFood, 'reject', new Error('Network Error'), (s) => s.loadDayData('synthetic-old-account', s.selectedDate),
    (s) => s.loadError !== null],
  ['water add reply', mockLogWater, 'resolve', { data: { id: 'synthetic-old-water', amount_ml: 237 } },
    (s) => s.logWater('synthetic-old-account', '', 8), (s) => s.waterEntries.some((e) => e.id === 'synthetic-old-water')],
  ['water add rollback', mockLogWater, 'reject', new Error('Network Error'), (s) => s.logWater('synthetic-old-account', '', 8),
    (s) => s.loadError !== null],
  ['refresh after a food log', mockLogFood, 'resolve', { data: {} },
    (s) => s.logFood({ userId: 'synthetic-old-account', date: OTHER_DAY, mealType: 'breakfast', foodItemId: 'synthetic-oats' }),
    (s) => s.selectedDate === OTHER_DAY],
  ['water delete reply', mockDeleteWater, 'resolve', { data: {} }, (s) => s.removeWaterEntry('synthetic-water-1'),
    (s) => !s.waterEntries.some((e) => e.id === 'synthetic-water-1')],
];

const pick = (s: S) => ({
  selectedDate: s.selectedDate, foodLogs: s.foodLogs, dailyTotals: s.dailyTotals, waterOz: s.waterOz,
  waterEntries: s.waterEntries, hasLoadedDay: s.hasLoadedDay, isLoading: s.isLoading, loadError: s.loadError,
});

describe('LS-PAYFAIL B10: the client day store never trusts an older account reply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useClientStore.getState().reset();
    mockGetFood.mockResolvedValue(day);
    mockGetWater.mockResolvedValue(water);
  });

  const cases = rows.flatMap(([name, ...rest]): Case[] => [[name, true, ...rest], [name, false, ...rest]]);
  it.each(cases)(
    '%s, signed out before it lands: %s',
    async (_name, signedOut, call, ends, value, start, wrote) => {
      await useClientStore.getState().loadDayData('synthetic-old-account');
      const reply = held();
      call.mockReturnValueOnce(reply.promise);
      const oldWork = start(useClientStore.getState()).catch(() => undefined);

      let next: ReturnType<typeof pick> | null = null;
      if (signedOut) {
        useClientStore.getState().reset(); // what resetUserScopedStores runs at every sign-out
        await useClientStore.getState().loadDayData('synthetic-next-account');
        next = pick(useClientStore.getState());
      }
      if (ends === 'resolve') reply.resolve(value);
      else reply.reject(value);
      await oldWork;

      const after = useClientStore.getState();
      expect(wrote(after)).toBe(!signedOut);
      if (next) expect(pick(after)).toEqual(next);
    },
  );
});
