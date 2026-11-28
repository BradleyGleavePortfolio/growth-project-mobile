/**
 * LO-PLAN-SWAPS-COACH-M-2 B1 (lens B-TEST, agent alm): the meal page's refusal line as S1_F10 draws it at 390 pt, 100%.
 * The frame (frames/S1_F10_390_100.png on ctx#613 at f1f401ad, 2 px = 1 pt) sets the footer's refusal line (R13, added by
 * this PR) on 22 pt lines in three lines, at the Options and Recipe lines' size (typography.bodySmall, 14 on 22), with
 * the recipes card's Try again above it. Red at c0587fc7: the line is typography.body (16 on 26), four lines at 390 pt,
 * so the footer grows 38 pt and the recipes card's Try again sits under it (F10 sheet on ctx#630 at e25ef743).
 * Round 1's B1 class ("every block the meal page and its two pickers add") left this one line at 16 pt.
 */
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockMeal = (id: string, name: string, k: number, p: number, c: number, f: number, more: Row = {}) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null,
    swap_template_ids: [], recipe_id: null, ...more });
const mockMeals = [
  mockMeal('m1', 'Banana and whey shake', 250, 25, 32, 3, { swap_template_ids: ['m2'] }),
  mockMeal('m2', 'Rice cakes, honey and whey', 240, 26, 30, 2),
];
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), popTo: jest.fn(), dispatch: jest.fn(), push: jest.fn() };
const mockRefusal = { response: { status: 400, data: { code: 'MEAL_SWAP_INVALID', error: 'MEAL_SWAP_INVALID', message: 'x' } } };

jest.mock('../../../../services/api', () => ({ __esModule: true, coachApi: { getClients: () => Promise.resolve({ data: [] }) },
  recipesApi: { list: () => Promise.resolve({ data: [] }) }, foodApi: { search: () => Promise.resolve({ data: { results: [] } }) },
  default: { get: (u: string) => Promise.resolve({ data: u === '/coach/meal-templates' ? mockMeals : [] }),
    post: () => Promise.resolve({ data: {} }), patch: () => Promise.reject(mockRefusal), delete: () => Promise.resolve({ data: {} }) } }));
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({}), useFocusEffect: jest.fn(), usePreventRemove: jest.fn() }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach' }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), SafeAreaView: require('react-native').View }));

import MealEditor from '../../CoachMealTemplatesScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';

const style = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Row;

beforeEach(() => {
  for (const k of ['selection', 'success', 'error', 'mediumImpact'] as const) jest.spyOn(HapticService, k).mockResolvedValue();
  Dimensions.set({ window: { width: 390, height: 844, fontScale: 1, scale: 2 }, screen: { width: 390, height: 844, fontScale: 1, scale: 2 } });
});
afterEach(() => jest.restoreAllMocks());

it('LO2 B1: F10 draws the footer refusal line at 14 pt on 22 pt lines, as the Options and Recipe lines', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const s = await render(
    <QueryClientProvider client={qc}><MealEditor {...({ route: { params: { mealId: 'm1' } }, navigation: mockNav } as any)} /></QueryClientProvider>,
  );
  await s.findByText('Rice cakes, honey and whey');
  await fireEvent.press(s.getByTestId('meal-save'));
  const line = await s.findByText(
    'A swap must be one of your own meals that is not archived, and not this meal. Pick swaps from your meals and save again.');
  const lead = s.getByText('Clients can pick one instead. These go with this meal in every day plan that uses it.');
  expect([style(line).fontSize, style(line).lineHeight]).toEqual([style(lead).fontSize, style(lead).lineHeight]);
  expect([style(line).fontSize, style(line).lineHeight]).toEqual([14, 22]);
});
