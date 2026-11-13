/**
 * GOAL-927-M, OPERATOR RULING 6: with `planned`, "Log this meal" draws C2 C_day's filled forest button reading
 * "Ate it as planned" (C_day .c-next .btn: 54 pt, radius 12, Inter 600 14, y 1438-1515 px at 2x); its tap, write,
 * sheet, Undo and accessibility label are main's. Without the prop it draws exactly as at 8efe38e0.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { lightTokens } from '../../../theme/tokens';
import { foodApi, logApi } from '../../../services/api';
import LogPlannedMealButton from '../LogPlannedMealButton';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
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

const meal = { name: 'Salmon, potatoes and beans', calories: 640, protein: 42, carbs: 55, fat: 22 };
const sc = lightTokens;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
});

it('planned: the filled forest "Ate it as planned", 54 pt, radius 12, Inter 600 14 on the forest', async () => {
  await render(<LogPlannedMealButton meal={meal} slot="dinner" planSlotId="slot-c" planned />);
  const btn = screen.getByLabelText('Log this meal: Salmon, potatoes and beans');
  expect(btn).toHaveStyle({ minHeight: 54, borderRadius: 12, backgroundColor: sc.accent });
  expect(screen.getByText('Ate it as planned')).toHaveStyle({ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: sc.textOnAccent });
  expect(screen.queryByText('Log this meal')).toBeNull();
});

it('planned: the same write as main (one tap logs the meal to its meal, linked to its plan meal)', async () => {
  await render(<LogPlannedMealButton meal={meal} slot="dinner" planSlotId="slot-c" planned />);
  await fireEvent.press(screen.getByLabelText('Log this meal: Salmon, potatoes and beans'));
  expect(await screen.findByText("Added to today's dinner.")).toBeTruthy();
  expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-07', meal_type: 'dinner' }));
});

it('without the prop the link draws as at 8efe38e0', async () => {
  await render(<LogPlannedMealButton meal={meal} slot="dinner" planSlotId="slot-c" />);
  expect(screen.getByText('Log this meal')).toHaveStyle({ color: sc.accentText });
  expect(screen.queryByText('Ate it as planned')).toBeNull();
});
