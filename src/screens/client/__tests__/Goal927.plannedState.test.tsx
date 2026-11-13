import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { foodApi, logApi } from '../../../services/api';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, props) };
});
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: undefined }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({
  useMealPlanToday: () => ({ data: { assignments: [mockAssignment] }, refetch: jest.fn(), isLoading: false, isError: false }),
}));
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: null }),
}));
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: () => ({ data: { entries: mockEntries }, isLoading: false, isError: false }),
}));
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { foodPlanChecklist: true },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../store/clientStore', () => ({
  useClientStore: { getState: () => ({ selectedDate: '2026-10-07', refreshShownDay: jest.fn() }) },
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-07',
}));

const mockSlot = {
  id: 's1', daily_meal_plan_id: 'dp', meal_template_id: 'm1', slot_label: 'dinner', order: 0,
  meal_template: {
    id: 'm1', coach_id: 'coach', name: 'Pasta', description: 'Pasta with greens',
    calories_kcal: 420, protein_g: 20, carbs_g: 60, fats_g: 10, fiber_g: null,
    items: null, created_at: '2026-10-01', archived_at: null,
  },
};
const mockAssignment = {
  id: 'a1', daily_meal_plan_id: 'dp', client_id: 'client-1', assigned_by_coach_id: 'coach',
  starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
  daily_meal_plan: { id: 'dp', coach_id: 'coach', name: 'Training day', notes: null,
    created_at: '2026-10-01', archived_at: null, slots: [mockSlot] },
};
const linkedEntry = {
  id: 'entry-1', food_item_id: 'food-1', user_id: 'client-1', meal_type: 'dinner',
  quantity_multiplier: 1, logged_at: '2026-10-07T18:00:00Z', plan_slot_id: 's1',
  food_item: { id: 'food-1', name: 'Pasta', calories: 420, protein_g: 20, carbs_g: 60, fat_g: 10 },
};
let mockEntries: typeof linkedEntry[] = [];
const netinfo = jest.requireMock('@react-native-community/netinfo');

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.__reset();
  mockEntries = [];
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
  jest.mocked(logApi.deleteEntry).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof logApi.deleteEntry>>);
});

it.each([
  ['online', "Added to today's dinner."],
  ['offline', "Saved offline. It syncs to today's dinner when the connection returns."],
])('keeps the %s action state when the refreshed checklist moves the next-meal card', async (mode, status) => {
  if (mode === 'offline') netinfo.__setState({ isConnected: false });
  const view = await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByText('Ate it as planned')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Log this meal: Pasta'));
  expect(await screen.findByText(status)).toBeTruthy();

  // The linked row arrives after the online refresh or the offline queue sync.
  // The same meal stops being "up next"; its action must not remount as idle.
  mockEntries = [linkedEntry];
  await view.rerender(<ClientDailyMealPlanScreen />);
  expect(screen.getByText(status)).toBeTruthy();
  expect(screen.queryByLabelText('Log this meal: Pasta')).toBeNull();
  expect(screen.queryByTestId('daily-meal-plan-next-card')).toBeNull();

  if (mode === 'online') {
    await fireEvent.press(screen.getByText('Undo'));
    expect(await screen.findByText("Removed from today's dinner.")).toBeTruthy();
    expect(logApi.deleteEntry).toHaveBeenCalledWith('entry-1');
  } else {
    expect(screen.queryByText('Undo')).toBeNull();
  }
});
