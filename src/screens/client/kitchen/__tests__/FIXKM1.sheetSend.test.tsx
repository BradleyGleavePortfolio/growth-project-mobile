/**
 * FIX-KM-1 (fix round 1 on growth-project-mobile#1015): the saved-meal sheet's one send stays tied to the save she asked for.
 * C1 (LS-KITCHEN-M-1, operator call "fix now"): after a lost answer the meal choice is held while Try again shows, so Try
 * again resends the SAME intent and key, and a lost send that did land is never logged a second time under another meal.
 * C2 (LS-KITCHEN-M-1, operator call "fix now"; the fix picked: Close is inert while a send runs): Close, the scrim and
 * Android Back do nothing during a send, so the busy state and the answer stay on the meal they were sent for and never
 * reach the next meal's sheet. The api's own 30 s timeout ends every send, so the sheet is never held for good.
 * The real page mounts with the API mocked at its edge (coachless Jordan, fictional); today is Tuesday 2026-10-13, 08:00.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
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

const lost = () => Promise.reject(new Error('Network Error'));
const refused = (status: number, message: string) => () =>
  Promise.reject(Object.assign(new Error(message), { response: { status, data: { message } } }));
const posts = () => mockPost.mock.calls as Array<[string, { meal_type: string; client_uuid: string }, unknown]>;
const choice = (label: string) => within(screen.getByTestId('kitchen-meal-choice')).getByLabelText(label);
const checked = (label: string) => (choice(label).props.accessibilityState as { checked?: boolean }).checked === true;

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(<QueryClientProvider client={client}><KitchenScreen /></QueryClientProvider>);
  await screen.findByTestId('kitchen-meal-m1');
}
async function open(id: string) {
  await fireEvent.press(screen.getByTestId(`kitchen-meal-${id}`));
  return screen.getByTestId('kitchen-sheet');
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  jest.setSystemTime(new Date(2026, 9, 13, 8, 0));
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockGet.mockReset().mockImplementation((url: string) => Promise.resolve({ data: SERVER[url] }));
  mockPost.mockReset();
  forgetSaveKeys();
});
afterEach(() => jest.useRealTimers());

describe('FIX-KM-1: the sheet keeps its one send tied to the save she asked for', () => {
  it('C1. a lost answer, then Lunch, then Try again: the choice is held, one intent, one key, one log under breakfast', async () => {
    await mount();
    await open('m1');
    expect(checked('Breakfast')).toBe(true);
    mockPost.mockImplementationOnce(lost);
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    expect(within(screen.getByTestId('kitchen-add')).getByText('Try again')).toBeTruthy();
    // She tries another meal before Try again: the choice holds, so the kept key still answers this save.
    await fireEvent.press(choice('Lunch'));
    expect(checked('Breakfast')).toBe(true);
    expect(checked('Lunch')).toBe(false);
    mockPost.mockImplementationOnce(() => Promise.resolve({ data: [{ id: 'n1' }] }));
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    expect(posts()).toHaveLength(2);
    expect(posts().map((c) => c[1].meal_type)).toEqual(['breakfast', 'breakfast']);
    expect(posts()[1][1].client_uuid).toBe(posts()[0][1].client_uuid);
    expect(screen.getByText("Added to today's breakfast.")).toBeTruthy();
  });

  it('C1b. once an answer lets the key go (a 404 or another refusal), the choice is free again', async () => {
    await mount();
    await open('m1');
    mockPost.mockImplementationOnce(lost);
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    mockPost.mockImplementationOnce(refused(404, 'Food not found'));
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    expect(screen.getByText('A food in this meal can no longer be logged, so nothing was added.')).toBeTruthy();
    await fireEvent.press(choice('Lunch'));
    expect(checked('Lunch')).toBe(true);
  });

  it('C2. Close, the scrim and Android Back do nothing during a send; the answer lands on its own meal, never on the next sheet', async () => {
    await mount();
    await open('m1');
    let release: (v: unknown) => void = () => undefined;
    mockPost.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    // The send is running: every way out of the sheet holds still.
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
    // The scrim sits beside the modal view, so it is outside the accessibility tree (as Kitchen.test.tsx reads it).
    await fireEvent.press(screen.getByTestId('kitchen-sheet-scrim', { includeHiddenElements: true }));
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
    await fireEvent(screen.getByTestId('kitchen-sheet'), 'requestClose'); // Android Back (the Modal's onRequestClose)
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
    expect(screen.getByTestId('kitchen-sheet-close').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    // The answer comes back to the meal it was sent for.
    await act(async () => { release({ data: [{ id: 'n1' }] }); });
    await waitFor(() => expect(screen.queryByTestId('kitchen-sheet')).toBeNull());
    expect(screen.getByText("Added to today's breakfast.")).toBeTruthy();
    // The next meal's sheet opens fresh: its Add is not busy and sends for that meal.
    await open('m2');
    expect(screen.getByTestId('kitchen-sheet-close').props.accessibilityState).not.toEqual(expect.objectContaining({ disabled: true }));
    mockPost.mockImplementationOnce(() => Promise.resolve({ data: [{ id: 'n2' }] }));
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    expect(posts().map((c) => c[0])).toEqual(['/me/foods/saved-meals/m1/log', '/me/foods/saved-meals/m2/log']);
    expect(screen.getByText("Added to today's breakfast.")).toBeTruthy();
  });

  it('C2b. a lost answer after the send: Close works again, and the next meal opens with no line and no Try again', async () => {
    await mount();
    await open('m1');
    mockPost.mockImplementationOnce(lost);
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    expect(screen.getByText('This meal was not added. Check the connection and try again.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    expect(screen.queryByTestId('kitchen-sheet')).toBeNull();
    await open('m2');
    expect(screen.queryByTestId('kitchen-sheet-line')).toBeNull();
    expect(within(screen.getByTestId('kitchen-add')).getByText('Add to today')).toBeTruthy();
  });
});
