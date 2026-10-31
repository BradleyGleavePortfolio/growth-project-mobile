/**
 * LS-914R3 B1: a normal Food-tab quick save must not move the selected day
 * back when the client has already opened another day. Real LogScreen,
 * real client store and real online submit; only I/O and unrelated hooks
 * are replaced. Same-day control must still show the save.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { logApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';
import { addDays, getTodayString } from '../../../utils/date';

const mockToday = getTodayString();
const mockPlan = {
  date: mockToday,
  assignments: [{ daily_meal_plan: {
    id: 'synthetic-plan', name: 'Synthetic day', slots: [{
      id: 'synthetic-slot', slot_label: 'snack', order: 0,
      meal_template: { name: 'Synthetic yogurt', calories_kcal: 210, protein_g: 30, carbs_g: 20, fats_g: 5, items: [] },
    }],
  } }],
};
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'synthetic-client', coach_id: 'synthetic-coach' }),
}));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../hooks/useFoodBrowse', () => ({
  useFoodBrowse: () => ({
    recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn(),
  }),
}));
jest.mock('../../../services/foodLogSync', () => ({
  notifyPendingFoodLogs: jest.fn(), syncFoodLogQueue: jest.fn(),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({
    data: url.startsWith('/me/meal-plan') ? mockPlan : { name: 'Synthetic coach' },
  })) },
  foodApi: {
    search: jest.fn(), create: jest.fn(async () => ({ data: { id: 'synthetic-food' } })),
  },
  logApi: {
    getDaily: jest.fn(async () => ({ data: { entries: [] } })),
    logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(),
  },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_ml: 0, logs: [] } })) },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(mockToday);
});

it.each([true, false])(
  'LS-914R3 B1: completing a food quick save preserves the current day (day changed=%s)',
  async (changed) => {
    let finish!: (value: unknown) => void;
    jest.mocked(logApi.logFood).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }) as never,
    );
    const r = await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LogScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(r.getByTestId('food-day-primary')).toBeTruthy());
    await fireEvent.press(r.getByTestId('food-day-primary'));
    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledWith(
      expect.objectContaining({ date: mockToday, plan_slot_id: 'synthetic-slot' }),
    ));
    const selected = changed ? addDays(mockToday, -1) : mockToday;
    if (changed) {
      // This date control remains enabled during the online save.
      await fireEvent.press(r.getByLabelText('Previous day'));
      await waitFor(() => expect(useClientStore.getState().selectedDate).toBe(selected));
    }
    await act(async () => {
      finish({ data: { id: 'synthetic-saved-entry' } });
      await Promise.resolve();
    });
    await waitFor(() => expect(r.getByText('Synthetic yogurt added to Snacks.')).toBeTruthy());
    expect(useClientStore.getState().selectedDate).toBe(selected);
    await r.unmount();
  },
);
