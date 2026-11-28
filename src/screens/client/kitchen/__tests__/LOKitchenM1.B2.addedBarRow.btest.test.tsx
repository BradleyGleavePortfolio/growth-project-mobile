/**
 * LO-KITCHEN-M-1 B2 (lens B-TEST, growth-project-mobile#1015 @ 1be656ea): the Added bar (R11, frame S2_done) is one row:
 * the check at the left, "Added to today's {meal}." wrapping in its own box, the underlined "See today" at the right.
 * At 130 percent text the built bar wraps the ROW instead (KitchenScreen.tsx makeStyles bar: flexWrap 'wrap'), so on
 * the renders PR the check sits alone on the first line at 320 pt and "See today" drops to a line of its own at 320 and
 * 390 pt (S6_done GOAL vs BUILT, 130%), a departure from the frame that no ruling covers. Jest has no layout engine, so
 * this test reads the cause: the bar row must not wrap, and its words must be the part that shrinks.
 * Red at 1be656ea: the bar's style carries flexWrap 'wrap'.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
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

import { forgetSaveKeys } from '../../../../utils/log/saveKey';
import KitchenScreen from '../KitchenScreen';

const MEAL = {
  id: 'm1', user_id: 'jordan', name: 'Usual breakfast', created_at: '2026-10-01', updated_at: '2026-10-01',
  items: [{ id: 'i1', saved_meal_id: 'm1', food_item_id: 'f1', quantity_multiplier: 1, original_quantity: null, original_unit: null,
    position: 0, food_item: { id: 'f1', name: 'Rolled oats', calories: 190, protein_g: 7, carbs_g: 0, fat_g: 0 }, food_truth: 'ok' }],
};
const SERVER: Record<string, unknown> = { '/me/foods/saved-meals': [MEAL], '/lists/grocery': [], '/lists/shopping': [], '/recipes': [] };

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
});

describe('LO-KITCHEN-M-1 B2: the Added bar keeps the drawn one-row layout at 130 percent text', () => {
  it('B2. at 320 x 568 and 130%, the bar row does not wrap; the words shrink between the check and See today', async () => {
    mockDims = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    await mount();
    mockPost.mockImplementation(() => Promise.resolve({ data: [{ id: 'n1' }] }));
    await fireEvent.press(screen.getByTestId('kitchen-meal-m1'));
    await fireEvent.press(await screen.findByTestId('kitchen-add'));
    const bar = await screen.findByTestId('kitchen-added');
    const style = StyleSheet.flatten(bar.props.style) as { flexDirection?: string; flexWrap?: string };
    expect(style.flexDirection).toBe('row');
    expect(style.flexWrap ?? 'nowrap').toBe('nowrap');
    const words = screen.getByText(/^Added to today's /);
    const w = StyleSheet.flatten(words.props.style) as { flex?: number; flexShrink?: number };
    expect((w.flex ?? 0) > 0 || (w.flexShrink ?? 0) > 0).toBe(true);
  });
});
