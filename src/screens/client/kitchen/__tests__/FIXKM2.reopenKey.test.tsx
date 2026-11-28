/**
 * FIX-KM-2 (fix round 2 on growth-project-mobile#1015): C1's class through a sheet opened again (LO-KITCHEN-M-2 C1,
 * LS-KITCHEN-M-2 C1; OPERATOR RULING 15:5x PST 11-27: fix now, as round-1 C1, because a meal logged twice is wrong data
 * she sees). After a lost answer that the server did write, she closes the sheet and opens the same meal again (or leaves
 * the Kitchen and comes back). While that save's key is still kept, the sheet opens as she left it: its meal choice held,
 * the KK-6 line and Try again, so Try again resends the SAME key with the SAME choice and the server keeps one log. A new
 * choice, or the meal of the hour moving past 10:30, 15:00, 17:00 or 21:00 with nothing touched, never sends a new key.
 * The cases are LS-KITCHEN-M-2's probe (R1, R2) as a table, plus the Kitchen left and opened again. The server here
 * keeps one log per key, as the real route does (a resend with a stored key returns what it stored and writes nothing).
 * The real page mounts with the API mocked at its edge (coachless Jordan, fictional); today is Tuesday 2026-10-13.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

let mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...jest.requireActual('../../../../constants/colors').default } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, { ...props }) };
});
jest.mock('../../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
const mockParent = { navigate: jest.fn() };
const mockNav = {
  navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn(() => mockParent),
  addListener: jest.fn(() => () => undefined),
};
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: new Proxy({}, { get: () => true }) }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'jordan', coach_id: null }) }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  ...jest.requireActual('../../../../hooks/useNetworkStatus'), useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-13' }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  logApi: { getDaily: (date: string) => mockGet('/log/daily', date) },
  recipesApi: { list: () => mockGet('/recipes') },
  listsApi: { getList: (type: string) => mockGet(`/lists/${type}`) },
}));
jest.mock('../../../../api/mealTemplatesApi', () => ({ mealTemplatesApi: { todayForClient: () => Promise.reject(new Error('not coached')) } }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: () => jest.fn(async () => undefined) }),
}));
jest.mock('../../../../lib/analytics', () => ({ track: () => undefined }));
jest.mock('../../../../services/queryClient', () => ({ queryClient: { invalidateQueries: () => Promise.resolve() } }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'jordan' }) }));
const mockStore = { selectedDate: '2026-10-13', setSelectedDate: jest.fn(), loadDayData: jest.fn(async () => undefined), refreshShownDay: jest.fn() };
jest.mock('../../../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockStore, { getState: () => mockStore }) }));

import { forgetSaveKeys } from '../../../../utils/log/saveKey';
import KitchenScreen from '../KitchenScreen';

const food = (id: string, name: string, calories: number) => ({ id, saved_meal_id: 'm', food_item_id: `f-${id}`, quantity_multiplier: 1,
  original_quantity: null, original_unit: null, position: 0, food_item: { id: `f-${id}`, name, calories, protein_g: 10, carbs_g: 0, fat_g: 0 },
  food_truth: 'ok' });
const meal = (id: string, name: string, items: unknown[]) => ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', items });
const MEALS = [meal('m1', 'Usual breakfast', [food('i1', 'Rolled oats', 190)]), meal('m2', 'Post-gym shake', [food('i2', 'Whey', 240)])];
const SERVER: Record<string, unknown> = { '/me/foods/saved-meals': MEALS, '/lists/grocery': [], '/lists/shopping': [], '/recipes': [] };

type Body = { date: string; meal_type: string; client_uuid: string };
/** The server's logs of saved meals, one per key: a resend with a stored key writes nothing and returns what it stored. */
let logs = new Map<string, { meal: string; meal_type: string }>();
const write = (url: string, body: Body) => {
  if (!logs.has(body.client_uuid)) logs.set(body.client_uuid, { meal: url, meal_type: body.meal_type });
  return { data: [{ id: `e-${body.client_uuid}` }] };
};
/** The server wrote the log, and its answer never came back. */
const wroteButLost = (url: string, body: Body) => { write(url, body); return Promise.reject(new Error('Network Error')); };
const answered = (url: string, body: Body) => Promise.resolve(write(url, body));
const lostBeforeWrite = () => Promise.reject(new Error('Network Error'));
const posts = () => mockPost.mock.calls as Array<[string, Body, unknown]>;
const choice = (label: string) => within(screen.getByTestId('kitchen-meal-choice')).getByLabelText(label);
const checked = (label: string) => (choice(label).props.accessibilityState as { checked?: boolean }).checked === true;
const LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' } as const;
type Meal = keyof typeof LABEL;
const at = (h: number, m: number) => jest.setSystemTime(new Date(2026, 9, 13, h, m));
/** What the sheet shows: its button, its line and the meal checked. */
const shown = () => ({
  button: within(screen.getByTestId('kitchen-add')).queryByText('Try again') ? 'Try again' : 'Add to today',
  line: screen.queryByTestId('kitchen-sheet-line') ? (screen.getByTestId('kitchen-sheet-line').props.children as string) : null,
  meal: (Object.keys(LABEL) as Meal[]).filter((k) => checked(LABEL[k])),
});

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(<QueryClientProvider client={client}><KitchenScreen /></QueryClientProvider>);
  await screen.findByTestId('kitchen-meal-m1');
  return view;
}
async function open(id: string) {
  await fireEvent.press(screen.getByTestId(`kitchen-meal-${id}`));
  return screen.getByTestId('kitchen-sheet');
}
async function close() {
  await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
  expect(screen.queryByTestId('kitchen-sheet')).toBeNull();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  at(8, 0);
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockGet.mockReset().mockImplementation((url: string) => Promise.resolve({ data: SERVER[url] }));
  mockPost.mockReset();
  logs = new Map();
  forgetSaveKeys();
});
afterEach(() => jest.useRealTimers());

const NOT_ADDED = 'This meal was not added. Check the connection and try again.';

describe('FIX-KM-2: a lost save of a meal opens again as she left it while its key is kept: one log, one key', () => {
  // [case, sent at, opened again at, the Kitchen left and opened again, a meal she then picks, the meal of the first send]
  it.each([
    ['a (R1). the same meal opened again, then Lunch picked', [8, 0], [8, 1], false, 'lunch', 'breakfast'],
    ['b (R2). the same meal opened again past 10:30, nothing touched', [10, 29], [10, 31], false, null, 'breakfast'],
    ['b. the same meal opened again past 15:00, nothing touched', [14, 59], [15, 1], false, null, 'lunch'],
    ['b. the same meal opened again past 17:00, nothing touched', [16, 59], [17, 1], false, null, 'snack'],
    ['b. the same meal opened again past 21:00, nothing touched', [20, 59], [21, 1], false, null, 'dinner'],
    ['c. the Kitchen left and opened again, then Lunch picked', [8, 0], [8, 5], true, 'lunch', 'breakfast'],
    ['c. the Kitchen left and opened again past 10:30, nothing touched', [10, 29], [10, 31], true, null, 'breakfast'],
  ] as Array<[string, [number, number], [number, number], boolean, Meal | null, Meal]>)(
    '%s: exactly one log and one key, under the first meal', async (_name, sent, back, leave, pick, first) => {
      at(...sent);
      const view = await mount();
      await open('m1');
      expect(checked(LABEL[first])).toBe(true);
      mockPost.mockImplementationOnce(wroteButLost);
      await fireEvent.press(screen.getByTestId('kitchen-add'));
      expect(screen.getByText(NOT_ADDED)).toBeTruthy();
      // No send runs, so Close works (C2's hold is for a running send only).
      await close();
      if (leave) {
        await view.unmount();
        await mount();
      }
      at(...back);
      await open('m1');
      const reopened = shown();
      if (pick) await fireEvent.press(choice(LABEL[pick]));
      const afterPick = shown().meal;
      mockPost.mockImplementation(answered);
      await fireEvent.press(screen.getByTestId('kitchen-add'));
      // The lost send landed, so the server already holds this save: the next send must carry the same key and meal.
      expect([...logs.values()]).toEqual([{ meal: '/me/foods/saved-meals/m1/log', meal_type: first }]);
      expect(posts()).toHaveLength(2);
      expect(new Set(posts().map((c) => c[1].client_uuid)).size).toBe(1);
      expect(posts().map((c) => c[1].meal_type)).toEqual([first, first]);
      // It opened as she left it: the first meal held, KK-6 and Try again.
      expect(reopened).toEqual({ button: 'Try again', line: NOT_ADDED, meal: [first] });
      expect(afterPick).toEqual([first]);
      expect(screen.queryByTestId('kitchen-sheet')).toBeNull();
      expect(screen.getByTestId('kitchen-added')).toBeTruthy();
    });

  it('d. only that meal is held, and only while its key is kept: another meal opens free; after an answer the same meal opens free', async () => {
    await mount();
    await open('m1');
    mockPost.mockImplementationOnce(wroteButLost);
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    await close();
    // Another meal has no kept key: the meal of the hour, a free choice, no line.
    await open('m2');
    expect(shown()).toEqual({ button: 'Add to today', line: null, meal: ['breakfast'] });
    await fireEvent.press(choice('Lunch'));
    expect(shown().meal).toEqual(['lunch']);
    await close();
    // The first meal is still held; its Try again gets an answer, which lets the key go.
    await open('m1');
    expect(shown()).toEqual({ button: 'Try again', line: NOT_ADDED, meal: ['breakfast'] });
    mockPost.mockImplementation(answered);
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    expect(screen.getByTestId('kitchen-added')).toBeTruthy();
    // Opened again after that answer: a new save, free, with the meal of the hour.
    await open('m1');
    expect(shown()).toEqual({ button: 'Add to today', line: null, meal: ['breakfast'] });
    await fireEvent.press(choice('Lunch'));
    expect(shown().meal).toEqual(['lunch']);
    expect([...logs.values()].map((l) => l.meal_type)).toEqual(['breakfast']);
  });

  it('e. a refusal after the lost send lets its key go, so the same meal opens free again; a send lost before any write is held too', async () => {
    await mount();
    await open('m1');
    mockPost.mockImplementationOnce(lostBeforeWrite);
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    await close();
    await open('m1');
    // The phone cannot tell a lost send that landed from one that did not, so this one is held the same way.
    expect(shown()).toEqual({ button: 'Try again', line: NOT_ADDED, meal: ['breakfast'] });
    mockPost.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('Food not found'), {
      response: { status: 404, data: { message: 'Food not found' } },
    })));
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    await close();
    await open('m1');
    expect(shown()).toEqual({ button: 'Add to today', line: null, meal: ['breakfast'] });
  });
});
