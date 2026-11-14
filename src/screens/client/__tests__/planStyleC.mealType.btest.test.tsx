/**
 * LS-927 B2: C2's defined meal-name scale is 21 pt, not the h2 token's 24 pt.
 * GOAL: planning/MOCKUP3/C2/index.md:84, Cormorant-led / 21 pt meal names.
 * This checks the actual rendered meal text, for both short and long names.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

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
// GOAL-927-M (RULING 3): the meal plan's two new reads with no target and no log, so main's screen draws.
jest.mock('../../../hooks/useApi', () => ({ ...jest.requireActual('../../../hooks/useApi'), useTodayLog: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }) }));
jest.mock('../../../hooks/useMacros', () => ({ ...jest.requireActual('../../../hooks/useMacros'), useCurrentMacrosForSelf: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }) }));
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
  ['Greek yoghurt, oats and berries'],
  ['Slow-roasted salmon with lemon, dill, new potatoes and a long green salad'],
])('meal names use the C2 21 pt serif scale: %s', async (name) => {
  mockDaily.mockReturnValue({
    data: {
      assignments: [{
        id: 'assignment',
        daily_meal_plan: {
          name: 'Assigned plan',
          notes: null,
          slots: [{
            id: 'slot', slot_label: 'breakfast', order: 0,
            meal_template: { name, calories_kcal: 420, protein_g: 32, carbs_g: 48, fats_g: 12 },
          }],
        },
      }],
    },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  });
  await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByText(name)).toHaveStyle({
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 21,
  });
});
