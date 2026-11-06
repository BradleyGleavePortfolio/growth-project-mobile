/**
 * LS-927 B1: C2 Style C puts the coach's note in the forest masthead.
 * GOAL: planning/MOCKUP3/C2/index.md:84-85 and style-c/C_day_ios390_100.png.
 * Existing words and the one-plan title/total must remain, with no duplication.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react-native';

jest.mock('../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../theme/tokens').lightTokens;
  return {
    useTheme: () => ({
      semanticColors: sc,
      colors: { ...sc, background: sc.bgPrimary, primary: sc.accent, surface: sc.bgSurface },
    }),
  };
});
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: undefined }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({ SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack'] }));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: () => mockDaily() }));
jest.mock('../../../components/mealplan/LogPlannedMealButton', () => ({
  __esModule: true,
  default: () => null,
  plannedMealFromSlot: (slot: unknown) => slot,
}));
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('../../../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({
  useFonts: () => [true, null],
  CormorantGaramond_400Regular_Italic: 1,
}));

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';

const mockDaily = jest.fn();

it.each([
  ['Protein at every meal. Water before coffee.'],
  ['Cook ahead on Sunday; keeps three days.'],
])('single-plan coach note stays in the C2 forest masthead: %s', async (note) => {
  mockDaily.mockReturnValue({
    data: {
      assignments: [{
        id: 'assignment',
        daily_meal_plan: {
          name: 'Assigned plan',
          notes: note,
          slots: [],
        },
      }],
    },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  });
  await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByText("Today's meals")).toBeTruthy();
  expect(screen.getAllByText(note)).toHaveLength(1);
  const masthead = screen.getByTestId('daily-meal-plan-masthead');
  expect(within(masthead).getByText(note)).toBeTruthy();
});
