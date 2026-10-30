import {
  submitManualLogOnline,
  submitManualLogOnlineWithId,
  submitSearchLogOnline,
} from '../logSubmit';
import { authEvents } from '../../authEvents';

const mockCreateFood = jest.fn();
const mockLogFood = jest.fn();
jest.mock('../../../services/api', () => ({
  foodApi: { create: (...args: unknown[]) => mockCreateFood(...args) },
  logApi: { logFood: (...args: unknown[]) => mockLogFood(...args) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));

const manual = {
  foodName: 'Earlier account meal',
  calories: '100', protein: '3', carbs: '20', fat: '1',
  quantity: '1', unit: 'serving', date: '2026-10-30', mealType: 'breakfast' as const,
};
const paths: Array<[string, () => Promise<unknown>]> = [
  ['manual food log', () => submitManualLogOnline(manual)],
  ['planned meal with Undo', () => submitManualLogOnlineWithId(manual)],
  ['search food needing creation', () => submitSearchLogOnline({
    food: { id: 'off_synthetic', name: manual.foodName, calories: 100, protein: 3, carbs: 20, fat: 1 },
    date: manual.date, mealType: manual.mealType, multiplier: 1,
  })],
];

describe.each(paths)('LS-914 B3: %s ownership', (_label, start) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogFood.mockResolvedValue({ data: { id: 'new-entry' } });
  });

  it.each([false, true])(
    'an old food create cannot continue into the next account (changed=%s)',
    async (changed) => {
      let release!: (value: { data: { id: string } }) => void;
      mockCreateFood.mockReturnValueOnce(new Promise((done) => { release = done; }));
      const write = start().catch(() => undefined);
      expect(mockCreateFood).toHaveBeenCalledTimes(1);
      if (changed) {
        // The real identity events emitted when the earlier account leaves
        // and the next account signs in; the next API call reads that token.
        authEvents.emit('logout');
        authEvents.emit('login');
      }
      release({ data: { id: 'earlier-account-food' } });
      await write;
      expect(mockLogFood).toHaveBeenCalledTimes(changed ? 0 : 1);
    },
  );
});
