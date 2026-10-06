import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import api, { coachApi } from '../services/api';
import { FoodLogReviewSection } from '../screens/coach/client-detail/FoodLogReviewSection';
import { SummaryTab } from '../screens/coach/client-detail/SummaryTab';
import { makeStyles } from '../screens/coach/client-detail/styles';
import type { ThemeColors } from '../theme/ThemeProvider';
import type { ClientProfile } from '../types';
import { useCurrentMacrosForClient } from '../hooks/useMacros';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  coachApi: { getClientFoodLogs: jest.fn() },
}));
jest.mock('../hooks/useMacros', () => ({
  useCurrentMacrosForClient: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/coach/CoachAiSection', () => () => null);
jest.mock('../screens/coach/client-detail/ConsultationSummaryCard', () => ({
  ConsultationSummaryCard: () => null,
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: {} }),
}));

const colors = {} as ThemeColors;
const styles = makeStyles(colors);
const macroQuery = useCurrentMacrosForClient as jest.Mock;
const target = {
  calories_kcal: 2200, protein_g: 160, carbs_g: 245, fats_g: 65,
};

function meal(id: string, date = '2026-10-05') {
  return {
    id, date, meal_type: 'lunch', quantity_multiplier: 0.333,
    original_quantity: 33.3, original_unit: 'g',
    food_item: { name: `Food ${id}`, calories: 100, protein_g: 10, carbs_g: 20, fat_g: 5 },
  };
}

const reviewProps = { clientId: 'client-a', todayLogs: [], colors, styles };
const summaryProps = {
  clientId: 'client-a', clientName: 'Client', profile: null,
  totals: { calories: 1100, protein: 80, carbs: 100, fat: 30 },
  nudgeSuccess: false, onOpenMessages: jest.fn(), onOpenNudge: jest.fn(),
  onOpenMacrosReview: jest.fn(), onOpenWorkoutBuilder: jest.fn(),
  onOpenAskAi: jest.fn(), colors, styles,
};

beforeEach(() => {
  jest.clearAllMocks();
  macroQuery.mockReturnValue({ data: target, isLoading: false, isError: false, refetch: jest.fn() });
});

function respondWithPages(pages: ReturnType<typeof meal>[][]) {
  const read = async (url: string) => ({
    data: { meals: pages[url.includes('mealsCursor=') ? 1 : 0] ?? [], consent: { food_macros: true } },
  });
  (coachApi.getClientFoodLogs as jest.Mock).mockImplementation(read);
  (api.get as jest.Mock).mockImplementation(read);
}

describe('FOOD-COACH-124 normal-day regressions', () => {
  it('B1: includes food entries beyond the first 100-row timeline page', async () => {
    respondWithPages([
      Array.from({ length: 100 }, (_, i) => meal(`new-${i}`)),
      [meal('older-meal', '2026-10-04')],
    ]);
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('Food older-meal')).toBeTruthy());
    expect(api.get).toHaveBeenLastCalledWith('/coach/clients/client-a/timeline?days=7&mealsCursor=new-99');
  });

  it('shows macro totals and averages only over recorded days', async () => {
    respondWithPages([[meal('one'), meal('two', '2026-10-04')]]);
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('2 days with logs · 2 food entries')).toBeTruthy());
    expect(screen.getByText('Average per logged day: 33 kcal · P: 3g')).toBeTruthy();
    expect(screen.getAllByText('P: 3g · C: 7g · F: 2g')).toHaveLength(2);
    expect(screen.getByText(/Days without logs are not counted as zero intake/)).toBeTruthy();
  });

  it('shows the selected eat date, original portion and client notes', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { meals: [{ ...meal('one'), logged_at: '2026-10-06T18:00:00Z', notes: 'Before training' }] },
    });
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('2026-10-05')).toBeTruthy());
    expect(screen.getByText(/33.3 g/)).toBeTruthy();
    expect(screen.getByText('Client note: Before training')).toBeTruthy();
  });

  it('labels current-target comparisons and does not clamp over-target intake to 100%', async () => {
    macroQuery.mockReturnValue({ data: { ...target, calories_kcal: 20 }, isLoading: false, isError: false, refetch: jest.fn() });
    respondWithPages([[meal('one')]]);
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('167% of current daily calorie target')).toBeTruthy());
  });

  it('offers the existing message and meal-plan actions without claiming adherence', async () => {
    respondWithPages([[meal('one')]]);
    const onOpenMessages = jest.fn();
    const onOpenMealPlans = jest.fn();
    await render(<FoodLogReviewSection {...reviewProps} onOpenMessages={onOpenMessages} onOpenMealPlans={onOpenMealPlans} />);
    await fireEvent.press(screen.getByText('Send feedback'));
    await fireEvent.press(screen.getByText('Meal plans'));
    expect(onOpenMessages).toHaveBeenCalledTimes(1);
    expect(onOpenMealPlans).toHaveBeenCalledTimes(1);
  });

  it('distinguishes withheld food consent from no logged food', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { meals: [], consent: { food_macros: false } } });
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('Food logs are not shared with this coach.')).toBeTruthy());
    expect(screen.queryByText(/No meals logged/)).toBeNull();
  });

  it('does not display partial totals when a later page fails, and can retry', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: { meals: Array.from({ length: 100 }, (_, i) => meal(String(i))) } })
      .mockRejectedValueOnce(new Error('Network Error'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText(/Food logs could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('Food 0')).toBeNull();
    respondWithPages([[meal('retry')]]);
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Food retry')).toBeTruthy());
    spy.mockRestore();
  });

  it('changing the review period sends the selected days to the backend', async () => {
    respondWithPages([[meal('one')]]);
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('Food one')).toBeTruthy());
    await fireEvent.press(screen.getByText('30d'));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/coach/clients/client-a/timeline?days=30'));
  });

  it('summary never claims 0% of an unset target', async () => {
    macroQuery.mockReturnValue({ data: null, isLoading: false, isError: false, refetch: jest.fn() });
    await render(<SummaryTab {...summaryProps} />);
    expect(screen.getByText('No daily target available')).toBeTruthy();
    expect(screen.queryByText('0% of daily target')).toBeNull();
  });

  it('target errors leave food visible without falling back to an outdated prescription', async () => {
    macroQuery.mockReturnValue({ data: null, isLoading: false, isError: true, refetch: jest.fn() });
    respondWithPages([[meal('one')]]);
    await render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('Food one')).toBeTruthy());
    expect(screen.getByText('Target unavailable. Tap Refresh to retry.')).toBeTruthy();
    expect(screen.queryByText(/% of current daily calorie target/)).toBeNull();
  });

  it('B2: sums unrounded portions before rounding the daily total', async () => {
    respondWithPages([[meal('one'), meal('two')]]);
    await render(<FoodLogReviewSection {...reviewProps} />);
    // Client daily endpoint: round(100 * .333 + 100 * .333) = 67,
    // not round(33.3) + round(33.3) = 66.
    await waitFor(() => expect(screen.getByText('67 kcal')).toBeTruthy());
  });

  it('B3: summary uses the live prescription rather than missing camel-case profile targets', async () => {
    await render(<SummaryTab {...summaryProps} />);
    expect(screen.getByText('/ 2200 kcal')).toBeTruthy();
    expect(screen.getByText('50% of daily target')).toBeTruthy();
  });

  it('B3: summary falls back to actual server-computed profile targets, not generic defaults', async () => {
    macroQuery.mockReturnValue({ data: null, isLoading: false, isError: false, refetch: jest.fn() });
    const profile = {
      macro_target_calories: 1900, macro_target_protein_g: 150,
      macro_target_carbs_g: 180, macro_target_fat_g: 60,
    } as unknown as ClientProfile;
    await render(<SummaryTab {...summaryProps} profile={profile} />);
    expect(screen.getByText('/ 1900 kcal')).toBeTruthy();
  });

  it('B3: summary reports an over-target percentage while keeping the visual bar bounded', async () => {
    await render(<SummaryTab {...summaryProps} totals={{ ...summaryProps.totals, calories: 3300 }} />);
    expect(screen.getByText('150% of daily target')).toBeTruthy();
  });
});
