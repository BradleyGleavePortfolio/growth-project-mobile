import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
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
  let page = 0;
  const read = async () => ({ data: { meals: pages[page++] ?? [], consent: { food_macros: true } } });
  (coachApi.getClientFoodLogs as jest.Mock).mockImplementation(read);
  (api.get as jest.Mock).mockImplementation(read);
}

describe('FOOD-COACH-124 normal-day regressions', () => {
  it('B1: includes food entries beyond the first 100-row timeline page', async () => {
    respondWithPages([
      Array.from({ length: 100 }, (_, i) => meal(`new-${i}`)),
      [meal('older-meal', '2026-10-04')],
    ]);
    render(<FoodLogReviewSection {...reviewProps} />);
    await waitFor(() => expect(screen.getByText('Food older-meal')).toBeTruthy());
  });

  it('B2: sums unrounded portions before rounding the daily total', async () => {
    respondWithPages([[meal('one'), meal('two')]]);
    render(<FoodLogReviewSection {...reviewProps} />);
    // Client daily endpoint: round(100 * .333 + 100 * .333) = 67,
    // not round(33.3) + round(33.3) = 66.
    await waitFor(() => expect(screen.getByText('67 kcal')).toBeTruthy());
  });

  it('B3: summary uses the live prescription rather than missing camel-case profile targets', () => {
    render(<SummaryTab {...summaryProps} />);
    expect(screen.getByText('/ 2200 kcal')).toBeTruthy();
    expect(screen.getByText('50% of daily target')).toBeTruthy();
  });

  it('B3: summary falls back to actual server-computed profile targets, not generic defaults', () => {
    macroQuery.mockReturnValue({ data: null, isLoading: false, isError: false, refetch: jest.fn() });
    const profile = {
      macro_target_calories: 1900, macro_target_protein_g: 150,
      macro_target_carbs_g: 180, macro_target_fat_g: 60,
    } as unknown as ClientProfile;
    render(<SummaryTab {...summaryProps} profile={profile} />);
    expect(screen.getByText('/ 1900 kcal')).toBeTruthy();
  });
});
