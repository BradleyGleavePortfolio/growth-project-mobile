/**
 * LO-PLAN-SWAPS-COACH-M-1 B1 (lens B-TEST, agent alm): the meal page's type as S1_F01 draws it at 390 pt, 100%.
 * The frame (frames/S1_F01_390_100.png on ctx#613 at f1f401ad, 2 px = 1 pt) sets the Options block's lead line, each
 * option's macro line and the Recipe card's lines at 14 pt (Inter, 22 pt lines: typography.bodySmall) and each
 * option's name in Inter Medium (typography.bodyMd), so the Options block and the Recipe card both fit the first
 * screen ("so the meal's blocks fit the first screen at 390 pt", index.md "The C2 colourway, as applied"). Red at
 * bbbb58c0: those lines are 16 pt (typography.body) and the names Inter Regular, so the rows grow from 57 to 77 pt
 * and the Recipe card starts below the fold.
 */
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockMeal = (id: string, name: string, k: number, p: number, c: number, f: number, more: Row = {}) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null,
    swap_template_ids: [], recipe_id: null, ...more });
const mockMeals = [
  mockMeal('m1', 'Banana and whey shake', 250, 25, 32, 3,
    { description: 'Drink it 30 to 60 minutes before you train.', swap_template_ids: ['m2', 'm3', 'm4'], recipe_id: 'r1' }),
  mockMeal('m2', 'Rice cakes, honey and whey', 240, 26, 30, 2), mockMeal('m3', 'Greek yoghurt and granola', 260, 22, 34, 5),
  mockMeal('m4', 'Cottage cheese and pineapple', 230, 24, 26, 3),
];
const mockRecipes = [{ id: 'r1', title: 'Banana protein shake', servings: 1, calories: 250, protein: 25, carbs: 32, fat: 3,
  is_public: true, created_by_id: 'coach', allergens: ['dairy'], allergens_declared: true }];
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), popTo: jest.fn(), dispatch: jest.fn(), push: jest.fn() };

jest.mock('../../../../services/api', () => ({ __esModule: true, coachApi: { getClients: () => Promise.resolve({ data: [] }) },
  recipesApi: { list: () => Promise.resolve({ data: mockRecipes }) }, foodApi: { search: () => Promise.resolve({ data: { results: [] } }) },
  default: { get: (u: string) => Promise.resolve({ data: u === '/coach/meal-templates' ? mockMeals : [] }),
    post: () => Promise.resolve({ data: {} }), patch: () => Promise.resolve({ data: {} }), delete: () => Promise.resolve({ data: {} }) } }));
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

it('LO B1: F01 draws the Options lead and macro lines and the recipe lines at 14 pt, and the option names in Inter Medium', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const s = await render(
    <QueryClientProvider client={qc}><MealEditor {...({ route: { params: { mealId: 'm1' } }, navigation: mockNav } as any)} /></QueryClientProvider>,
  );
  await s.findByText('Banana protein shake');
  const small = [
    'Clients can pick one instead. These go with this meal in every day plan that uses it.',
    '240 kcal · P 26 · C 30 · F 2',
    'Per serving · 250 kcal · P 25 · C 32 · F 3',
    'Shared with your clients',
  ];
  expect(small.map((t) => `${t} ${style(s.getByText(t)).fontSize}`)).toEqual(small.map((t) => `${t} 14`));
  const names = ['Rice cakes, honey and whey', 'Greek yoghurt and granola', 'Cottage cheese and pineapple'];
  expect(names.map((t) => `${t} ${style(s.getByText(t)).fontFamily}`)).toEqual(names.map((t) => `${t} Inter_500Medium`));
});
