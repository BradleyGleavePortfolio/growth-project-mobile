// FIX-931 (LS-931 B1 as a class): every day read that fails offline still joins the phone's queue:
// the cold start alone (no later notify), a day the member moves to offline, and a refresh of a day
// already read. A day no read reached shows its queued foods but not its own numbers (hasLoadedDay
// stays false); a day read before keeps the server's foods and adds the queued ones.
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true } };
});
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'member-1' })),
}));
const mockGetDaily = jest.fn();
jest.mock('../api', () => ({
  foodApi: { create: jest.fn() },
  logApi: { getDaily: (...a: unknown[]) => mockGetDaily(...a), logFood: jest.fn() },
  waterApi: { getDaily: jest.fn(async () => { throw new Error('Network Error'); }) },
}));

import { useClientStore } from '../../store/clientStore';
import { enqueue } from '../foodLogQueue';

const DAY = '2026-11-04';
const NEXT = '2026-11-05';
const item = (date: string) => ({
  kind: 'search' as const,
  foodItemId: 'oats',
  shown: { name: 'Rolled oats', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
  log: { date, meal_type: 'breakfast' as const, quantity_multiplier: 1 },
});
const offline = async () => { throw new Error('Network Error'); };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockGetDaily.mockReset();
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(DAY);
});

it('the cold start read alone shows the queued food, without its own numbers claimed', async () => {
  mockGetDaily.mockImplementation(offline);
  await enqueue(item(DAY), 'pfl-a');
  await useClientStore.getState().loadDayData('member-1', DAY);
  const s = useClientStore.getState();
  expect(s.foodLogs.map((l) => [l.id, l.offline])).toEqual([['pfl-a', 'waiting']]);
  expect(s.dailyTotals.calories).toBe(150);
  expect(s.hasLoadedDay).toBe(false);
  expect(s.loadError).toBeTruthy();
});

it('a day moved to offline shows that day\'s queued food only', async () => {
  mockGetDaily.mockImplementation(offline);
  await enqueue(item(DAY), 'pfl-a');
  await enqueue(item(NEXT), 'pfl-b');
  await useClientStore.getState().loadDayData('member-1', NEXT);
  expect(useClientStore.getState().foodLogs.map((l) => l.id)).toEqual(['pfl-b']);
});

it('a failed refresh of a day read before keeps the server foods and adds the queued one', async () => {
  mockGetDaily.mockResolvedValueOnce({ data: { entries: [{
    id: 'srv-1', meal_type: 'lunch', quantity_multiplier: 1, created_at: `${DAY}T12:00:00Z`,
    food_item: { name: 'Soup', calories: 200, protein_g: 10, carbs_g: 20, fat_g: 5 },
  }], total_calories: 200, total_protein_g: 10, total_carbs_g: 20, total_fat_g: 5 } });
  await useClientStore.getState().loadDayData('member-1', DAY);
  expect(useClientStore.getState().hasLoadedDay).toBe(true);
  mockGetDaily.mockImplementation(offline);
  await enqueue(item(DAY), 'pfl-a');
  await useClientStore.getState().loadDayData('member-1', DAY);
  const s = useClientStore.getState();
  expect(s.foodLogs.map((l) => l.id)).toEqual(['srv-1', 'pfl-a']);
  expect(s.dailyTotals.calories).toBe(350);
  expect(s.hasLoadedDay).toBe(true);
});
