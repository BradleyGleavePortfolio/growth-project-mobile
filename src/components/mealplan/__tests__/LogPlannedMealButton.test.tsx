import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { foodApi, logApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import { queryClient } from '../../../services/queryClient';
import LogPlannedMealButton, {
  mealTypeForSlot, plannedMealFromFoods, plannedMealFromSlot,
} from '../LogPlannedMealButton';
import type { DailyMealPlanSlot } from '../../../api/mealTemplatesApi';

const mockLoadDayData = jest.fn();
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
  useClientStore: { getState: () => ({ selectedDate: '2026-10-07', loadDayData: mockLoadDayData }) },
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-07',
}));

// The shared NetInfo mock from jest.setup.js (__setState / __reset).
const netinfo = jest.requireMock('@react-native-community/netinfo');
const bowl = { name: 'Chicken rice bowl', calories: 520, protein: 42, carbs: 55, fat: 14 };

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.__reset();
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
  jest.mocked(logApi.deleteEntry).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof logApi.deleteEntry>>);
});

describe('plan helpers', () => {
  it('maps only slots that name a food-log meal', () => {
    expect(mealTypeForSlot('breakfast')).toBe('breakfast');
    expect(mealTypeForSlot('Day 2 – Lunch')).toBe('lunch');
    expect(mealTypeForSlot('dinner')).toBe('dinner');
    expect(mealTypeForSlot('afternoon snack')).toBe('snack');
    expect(mealTypeForSlot('preworkout')).toBeNull();
    expect(mealTypeForSlot('09:30')).toBeNull();
    expect(mealTypeForSlot(undefined)).toBeNull();
  });

  it('sums AI meal foods only when every food has the value, and reads canonical slots', () => {
    expect(plannedMealFromFoods([
      { name: 'Oats', serving: '60 g', calories: 230, protein_g: 8, carbs_g: 40, fat_g: 4 },
      { name: 'Berries', calories: 40, protein_g: 1, carbs_g: 9 },
    ])).toEqual({ name: 'Oats (60 g), Berries', calories: 270, protein: 9, carbs: 49, fat: null });
    const slot: DailyMealPlanSlot = {
      id: 's1', daily_meal_plan_id: 'd1', meal_template_id: 't1', slot_label: 'lunch', order: 0,
      meal_template: {
        id: 't1', coach_id: 'c1', name: 'Bowl', description: null, calories_kcal: 520, protein_g: 42, carbs_g: 55,
        fats_g: 14, fiber_g: null, items: null, created_at: '2026-10-01', archived_at: null,
      },
    };
    expect(plannedMealFromSlot(slot)).toEqual({ ...bowl, name: 'Bowl' });
  });
});

describe('LogPlannedMealButton', () => {
  it('logs a complete planned meal to today in one tap, refreshes the food log, and undoes it', async () => {
    await render(<LogPlannedMealButton meal={bowl} slot="lunch" />);
    await fireEvent.press(screen.getByText('Log this meal'));
    await screen.findByText("Added to today's lunch.");
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Chicken rice bowl', calories: 520, protein_g: 42, carbs_g: 55, fat_g: 14,
      nutrient_basis: 'PER_SERVING', serving_description: '1 serving',
    }));
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-10-07', meal_type: 'lunch', food_item_id: 'food-1', quantity_multiplier: 1,
    }));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['food', 'log'] });
    expect(mockLoadDayData).toHaveBeenCalledWith('client-1', '2026-10-07');
    expect(screen.queryByText('Adds one entry to today\'s food log.')).toBeNull();

    await fireEvent.press(screen.getByText('Undo'));
    await screen.findByText("Removed from today's lunch.");
    expect(logApi.deleteEntry).toHaveBeenCalledWith('entry-1');
    expect(screen.getByText('Log this meal')).toBeTruthy();
  });

  it('asks for values the plan does not give instead of logging them as zero', async () => {
    await render(<LogPlannedMealButton meal={{ name: 'Overnight oats', calories: 420, protein: 25 }} slot="breakfast" />);
    await fireEvent.press(screen.getByText('Log this meal'));
    expect(screen.getByLabelText('Calories').props.value).toBe('420');
    expect(screen.getByLabelText('Protein (g)').props.value).toBe('25');
    expect(screen.getByLabelText('Carbs (g)').props.value).toBe('');
    expect(screen.getByText('Enter protein, carbs and fat. Use 0 if there is none.')).toBeTruthy();
    expect(screen.getByText('Log to breakfast')).toBeDisabled();
    await fireEvent.press(screen.getByText('Log to breakfast'));
    expect(foodApi.create).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '50');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '12');
    await fireEvent.press(screen.getByText('Log to breakfast'));
    await screen.findByText("Added to today's breakfast.");
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ calories: 420, protein_g: 25, carbs_g: 50, fat_g: 12 }));
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'breakfast' }));
  });

  it('asks which meal when the slot names none, and Cancel logs nothing', async () => {
    await render(<LogPlannedMealButton meal={bowl} slot="preworkout" />);
    await fireEvent.press(screen.getByText('Log this meal'));
    expect(screen.getByText('Choose the meal to add it to.')).toBeTruthy();
    expect(screen.getByText('Log meal')).toBeDisabled();
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Choose the meal to add it to.')).toBeNull();
    expect(foodApi.create).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Log this meal'));
    await fireEvent.press(screen.getByText('Snacks'));
    await fireEvent.press(screen.getByText('Log to snacks'));
    await screen.findByText("Added to today's snacks.");
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'snack' }));
  });

  it('queues the meal offline like the Food log and offers no undo', async () => {
    netinfo.__setState({ isConnected: false });
    await render(<LogPlannedMealButton meal={bowl} slot="dinner" />);
    await fireEvent.press(screen.getByText('Log this meal'));
    await screen.findByText("Saved offline. It syncs to today's dinner when the connection returns.");
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'manual', log: expect.objectContaining({ date: '2026-10-07', meal_type: 'dinner' }),
    }));
    expect(foodApi.create).not.toHaveBeenCalled();
    expect(screen.queryByText('Undo')).toBeNull();
  });

  it('says plainly when the meal was not added and keeps the button', async () => {
    jest.mocked(logApi.logFood).mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    await render(<LogPlannedMealButton meal={bowl} slot="lunch" />);
    await fireEvent.press(screen.getByText('Log this meal'));
    await screen.findByText('The service could not be reached. Check your connection and try again.');
    await waitFor(() => expect(screen.getByText('Log this meal')).not.toBeDisabled());
    expect(screen.queryByText(/Added to today/)).toBeNull();
  });

  it('renders nothing for a planned row without a name', async () => {
    await render(<LogPlannedMealButton meal={{ name: '  ' }} slot="lunch" />);
    expect(screen.queryByText('Log this meal')).toBeNull();
  });
});
