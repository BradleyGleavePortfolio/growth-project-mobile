/**
 * LS-914R2 B1: WaterTracker leaves the date selector usable while an add is
 * pending. Its answer belongs to the day sent, not whatever day is now open.
 * Real store; only the HTTP boundaries and logger are replaced.
 */
import { useClientStore } from '../clientStore';

const mockFood = jest.fn();
const mockWater = jest.fn();
const mockAddWater = jest.fn();

jest.mock('../../services/api', () => ({
  logApi: { getDaily: (...a: unknown[]) => mockFood(...a) },
  waterApi: {
    getDaily: (...a: unknown[]) => mockWater(...a),
    log: (...a: unknown[]) => mockAddWater(...a),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));

const A = '2026-10-30';
const B = '2026-10-29';
const entry = (id: string, date: string, oz: number) => ({
  id, amount_ml: oz * 29.5735, logged_at: `${date}T12:00:00Z`,
});
const pick = () => {
  const s = useClientStore.getState();
  return { selectedDate: s.selectedDate, waterOz: s.waterOz, waterEntries: s.waterEntries, loadError: s.loadError };
};

beforeEach(() => {
  jest.clearAllMocks();
  useClientStore.getState().reset();
  mockFood.mockResolvedValue({ data: { entries: [] } });
  mockWater.mockImplementation(async (date: string) => ({
    data: {
      total_ml: (date === A ? 40 : 20) * 29.5735,
      logs: [entry(`saved-${date}`, date, date === A ? 40 : 20)],
    },
  }));
});

describe('LS-914R2 B1: water answers keep their selected-day ownership', () => {
  it.each([
    ['success', true], ['failure', true], ['success', false], ['failure', false],
  ] as const)(
    'a late water %s does not change a different selected day (date changed=%s)',
    async (outcome, changedDate) => {
      await useClientStore.getState().loadDayData('synthetic-client', A);
      let resolve!: (v: { data: ReturnType<typeof entry> }) => void;
      let reject!: (e: Error) => void;
      mockAddWater.mockReturnValueOnce(new Promise((res, rej) => { resolve = res; reject = rej; }));
      const pending = useClientStore.getState().logWater('synthetic-client', '', 8);
      expect(mockAddWater).toHaveBeenCalledWith({ amount_ml: 237, date: A });
      expect(useClientStore.getState().waterOz).toBe(48);

      if (changedDate) {
        // LogScreen.handleDateChange does this without waiting for the add.
        useClientStore.getState().setSelectedDate(B);
        await useClientStore.getState().loadDayData('synthetic-client', B);
      }
      const beforeAnswer = pick();

      if (outcome === 'success') resolve({ data: entry('new-water-for-A', A, 8) });
      else reject(new Error('Network Error'));
      await pending;

      if (changedDate) {
        expect(pick()).toEqual(beforeAnswer);
      } else if (outcome === 'success') {
        expect(useClientStore.getState().waterOz).toBe(48);
        expect(useClientStore.getState().waterEntries.map((r) => r.id)).toContain('new-water-for-A');
      } else {
        expect(useClientStore.getState().waterOz).toBe(40);
        expect(useClientStore.getState().loadError).toContain('was not saved');
      }
    },
  );
});
