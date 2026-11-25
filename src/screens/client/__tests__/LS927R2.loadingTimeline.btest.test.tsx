/**
 * LS-927R2 B1, KT-14: the C2 loading frame is a four-row meal timeline,
 * not the generic card skeleton. Reference: C_loading_ios390_100.png.
 * The assertion is on rendered ring geometry, not a new component/testID name.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';

jest.mock('../../../theme/ThemeProvider', () => {
  const { lightTokens: sc, colors, radius } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({
      semanticColors: sc,
      tokens: { colors, radius },
      colors: { ...sc, background: sc.bgPrimary, primary: sc.accent, surface: sc.bgSurface },
    }),
  };
});
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: undefined }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({ SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack'] }));
// GOAL-927-M (RULING 3): the meal plan's two new reads with no target and no log, so main's screen draws.
jest.mock('../../../hooks/useApi', () => ({ ...jest.requireActual('../../../hooks/useApi'), useTodayLog: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }) }));
jest.mock('../../../hooks/useMacros', () => ({ ...jest.requireActual('../../../hooks/useMacros'), useCurrentMacrosForSelf: () => ({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() }) }));
jest.mock('../../../hooks/useMealTemplates', () => ({
  useMealPlanToday: () => ({
    data: undefined, isLoading: true, isError: false, isRefetching: false, refetch: jest.fn(),
  }),
}));
jest.mock('../../../components/mealplan/LogPlannedMealButton', () => ({
  __esModule: true, default: () => null, plannedMealFromSlot: (slot: unknown) => slot,
}));
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-reanimated', () => {
  const NativeView = require('react-native').View;
  return {
    __esModule: true,
    default: { View: NativeView },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({ opacity: 1 }),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    Easing: { sin: (value: number) => value, inOut: (value: unknown) => value },
  };
});
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({
  useFonts: () => [true, null], CormorantGaramond_400Regular_Italic: 1,
}));

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';

it('meal-plan loading keeps the four hollow timeline markers shown in C2', async () => {
  // SkeletonScreen is intentionally real here. Only its animation is static.
  const result = await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByTestId('daily-meal-plan-masthead')).toBeTruthy();
  let ringCount = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: string; props?: { style?: StyleProp<ViewStyle> }; children?: unknown[] };
    const s = StyleSheet.flatten(node.props?.style) ?? {};
    if (node.type === 'View' && typeof s.width === 'number'
      && s.width >= 10 && s.width <= 24
      && s.height === s.width
      && typeof s.borderRadius === 'number' && s.borderRadius >= s.width / 2
      && typeof s.borderWidth === 'number' && s.borderWidth >= 1) ringCount += 1;
    node.children?.forEach(visit);
  };
  visit(result.toJSON());
  expect(ringCount).toBe(4);
});
