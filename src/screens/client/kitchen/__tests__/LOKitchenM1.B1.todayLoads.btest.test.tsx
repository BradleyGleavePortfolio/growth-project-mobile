/**
 * LO-KITCHEN-M-1 B1 (lens B-TEST, growth-project-mobile#1015 @ 1be656ea): the Kitchen's two ways to the Food tab's today
 * ("Log food" and the Added bar's "See today", KitchenScreen.tsx openToday) set the shared day store to today with
 * setSelectedDate alone. setSelectedDate clears the shown day and marks it not loaded (clientStore.ts setSelectedDate);
 * it never reads it. The Food tab (LogScreen.tsx) reads a day only on a user change, a date arrow, a return to the
 * foreground or a pull, so when the Food tab was showing another day (she was adding to yesterday and opened the
 * Kitchen from the add sheet, KITCHEN-DOOR-M's door) it lands on today with its loading bones and no read under way.
 * Home does the same move with loadDayData(user, today) (HomeScreen.tsx), which sets the day and reads it.
 * This test mounts the real Kitchen page over the REAL day store (the API mocked at its edge) and expects today to be
 * read and loaded after each of the two taps. Red at 1be656ea: hasLoadedDay stays false and /log/daily is never read
 * for today by the store.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: new Proxy({}, { get: () => false }) }));
// Coachless, so the page itself makes no /log/daily read: every daily read below is the day store's.
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'jordan', coach_id: null }) }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  ...jest.requireActual('../../../../hooks/useNetworkStatus'), useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-13' }));
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDaily = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  logApi: { getDaily: (date: string) => mockDaily(date) },
  waterApi: { getDaily: () => Promise.resolve({ data: { total_ml: 0, logs: [] } }) },
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

import { useClientStore } from '../../../../store/clientStore';
import { forgetSaveKeys } from '../../../../utils/log/saveKey';
import KitchenScreen from '../KitchenScreen';

const MEAL = {
  id: 'm1', user_id: 'jordan', name: 'Usual breakfast', created_at: '2026-10-01', updated_at: '2026-10-01',
  items: [{ id: 'i1', saved_meal_id: 'm1', food_item_id: 'f1', quantity_multiplier: 1, original_quantity: null, original_unit: null,
    position: 0, food_item: { id: 'f1', name: 'Rolled oats', calories: 190, protein_g: 7, carbs_g: 0, fat_g: 0 }, food_truth: 'ok' }],
};
const SERVER: Record<string, unknown> = { '/me/foods/saved-meals': [MEAL], '/lists/grocery': [], '/lists/shopping': [], '/recipes': [] };
const dayReads = (date: string) => mockDaily.mock.calls.filter((c) => c[0] === date).length;

/** The Food tab was showing yesterday, read and on screen. */
function foodTabOnYesterday() {
  useClientStore.setState({
    selectedDate: '2026-10-12', selectedOn: '2026-10-12', foodLogs: [], hasLoadedDay: true, isLoading: false, loadError: null,
  });
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(<QueryClientProvider client={client}><KitchenScreen /></QueryClientProvider>);
  await screen.findByTestId('kitchen-meal-m1');
}

beforeEach(() => {
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  (NetInfo as unknown as { __reset?: () => void }).__reset?.();
  mockGet.mockReset().mockImplementation((url: string) => Promise.resolve({ data: SERVER[url] }));
  mockPost.mockReset();
  mockDaily.mockReset().mockImplementation(() => Promise.resolve({ data: { entries: [], total_calories: 0 } }));
  mockParent.navigate.mockClear();
  forgetSaveKeys();
  foodTabOnYesterday();
});

describe('LO-KITCHEN-M-1 B1: the Kitchen opens the Food tab on a today that is read, never a day left loading', () => {
  it('B1a. Log food while the Food tab shows yesterday: today is read and loaded', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('kitchen-log-food'));
    expect(mockParent.navigate).toHaveBeenCalledWith('Log');
    await waitFor(() => {
      const day = useClientStore.getState();
      expect(day.selectedDate).toBe('2026-10-13');
      expect(dayReads('2026-10-13')).toBeGreaterThan(0);
      expect(day.hasLoadedDay).toBe(true);
    }, { timeout: 1500 });
  });

  it('B1b. See today after adding a saved meal while the Food tab shows yesterday: today is read and loaded', async () => {
    await mount();
    mockPost.mockImplementation(() => Promise.resolve({ data: [{ id: 'n1' }] }));
    await fireEvent.press(screen.getByTestId('kitchen-meal-m1'));
    await fireEvent.press(await screen.findByTestId('kitchen-add'));
    await fireEvent.press(await screen.findByTestId('kitchen-see-today'));
    expect(mockParent.navigate).toHaveBeenCalledWith('Log');
    await waitFor(() => {
      const day = useClientStore.getState();
      expect(day.selectedDate).toBe('2026-10-13');
      expect(dayReads('2026-10-13')).toBeGreaterThan(0);
      expect(day.hasLoadedDay).toBe(true);
    }, { timeout: 1500 });
  });
});
