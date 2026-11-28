/**
 * FIX-PSCM-2 (fix round 2 of PLAN-SWAPS-COACH-M; OPERATOR RULING 7232173044; frames S1_F01 to F10 on ctx#613 @ f1f401ad).
 * - LO B1 (= LS N2), round 1's B1 class: the footer's refusal line is drawn as the page's other lines (its type is the
 *   LO B-TEST, planSwapsCoachLO2); here its glyph, at 18 pt as Line draws its own, centred on the first 22 pt line.
 * - LS C1 (F08): the linked Recipe card sets its lines with no gap between them, each its own 22 pt line, as F01 and F08
 *   draw them (2 pt apart on 20 pt lines), so R6's line stays above the footer at 390 pt. The card with no recipe linked
 *   (F05) and with none to link (F07) keeps its 4 pt gap: those frames draw 2 to 6 pt between its parts.
 * - LO C1: "Edit details" scrolls to the Details panel's top less the pinned strip's height, so the panel's title and the
 *   Name field land under the strip's lower edge, not behind it (reproduced on a web export at 390 pt with the keyboard up
 *   and at 320 pt with 130% text: the strip covered 71 to 114 pt of the panel's top).
 */
import React from 'react';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fireEvent, render } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockDb = { meals: [] as Row[], recipes: [] as Row[], refuse: false };
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), popTo: jest.fn(), dispatch: jest.fn(), push: jest.fn() };
const mockRefusal = { response: { status: 400, data: { code: 'MEAL_SWAP_INVALID', error: 'MEAL_SWAP_INVALID', message: 'x' } } };

jest.mock('../../../../services/api', () => ({ __esModule: true, coachApi: { getClients: () => Promise.resolve({ data: [] }) },
  recipesApi: { list: () => Promise.resolve({ data: mockDb.recipes }) }, foodApi: { search: () => Promise.resolve({ data: { results: [] } }) },
  default: { get: (u: string) => Promise.resolve({ data: u === '/coach/meal-templates' ? mockDb.meals.filter((m) => !m.archived_at) : [] }),
    post: () => Promise.resolve({ data: {} }), patch: () => (mockDb.refuse ? Promise.reject(mockRefusal) : Promise.resolve({ data: {} })),
    delete: () => Promise.resolve({ data: {} }) } }));
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({}), useFocusEffect: jest.fn(), usePreventRemove: jest.fn() }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach' }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), SafeAreaView: require('react-native').View }));

import MealEditor from '../../CoachMealTemplatesScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { spacing, typography } from '../../../../theme/tokens';

const meal = (id: string, name: string, k: number, p: number, c: number, f: number, more: Row = {}) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null,
    swap_template_ids: [], recipe_id: null, ...more });
const recipe = (id: string, title: string, pub: boolean, allergens: string[], k: number, p: number, c: number, f: number) =>
  ({ id, title, servings: 1, calories: k, protein: p, carbs: c, fat: f, is_public: pub, created_by_id: 'coach', allergens, allergens_declared: true });
const size = (z: { width: number; height: number; fontScale: number }) =>
  Dimensions.set({ window: { ...z, scale: 2 }, screen: { ...z, scale: 2 } });
const flat = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Row;
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
const REFUSAL = 'A swap must be one of your own meals that is not archived, and not this meal. Pick swaps from your meals and save again.';
let qc: QueryClient;
const editor = (params?: Row) => render(
  <SafeAreaInsetsContext.Provider value={INSETS}><QueryClientProvider client={qc}>
    <MealEditor {...({ route: { params }, navigation: mockNav } as any)} />
  </QueryClientProvider></SafeAreaInsetsContext.Provider>);
type Page = Awaited<ReturnType<typeof editor>>;
/** The nearest host View above an element (its card or row). */
const hostAbove = (el: any, ok: (n: any) => boolean = () => true) => { let n = el.parent; while (n && !(typeof n.type === 'string' && ok(n))) n = n.parent; return n; };

beforeEach(() => {
  jest.clearAllMocks();
  size({ width: 390, height: 844, fontScale: 1 });
  for (const k of ['selection', 'success', 'error', 'mediumImpact'] as const) jest.spyOn(HapticService, k).mockResolvedValue();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockDb.meals = [
    meal('m1', 'Banana and whey shake', 250, 25, 32, 3, { description: 'Drink it 30 to 60 minutes before you train.', swap_template_ids: ['m2', 'm3', 'm4'], recipe_id: 'r1' }),
    meal('m2', 'Rice cakes, honey and whey', 240, 26, 30, 2), meal('m3', 'Greek yoghurt and granola', 260, 22, 34, 5),
    meal('m4', 'Cottage cheese and pineapple', 230, 24, 26, 3),
  ];
  mockDb.recipes = [recipe('r1', 'Banana protein shake', true, ['dairy'], 250, 25, 32, 3), recipe('r3', 'Overnight protein oats', false, ['soy'], 320, 24, 38, 5)];
  mockDb.refuse = false;
});
afterEach(() => jest.restoreAllMocks());

it('LO B1: F10\'s refusal line draws its glyph at 18 pt, as Line draws the recipe\'s glyphs, centred on its first 22 pt line', async () => {
  mockDb.refuse = true;
  const s = await editor({ mealId: 'm1' });
  await s.findByText('Banana protein shake');
  await fireEvent.press(s.getByTestId('meal-save'));
  const line = await s.findByText(REFUSAL);
  // Each glyph is the host Text an Ionicons draws beside its words: its fontSize is the glyph's size.
  const glyphBeside = (words: any) => hostAbove(words).queryAll((n: any) => n.type === 'Text' && n !== words)[0];
  const glyph = glyphBeside(line);
  const shared = glyphBeside(s.getByText('Shared with your clients')); // the recipe's share line, drawn by Line
  expect([flat(glyph).fontSize, flat(glyph).marginTop]).toEqual([flat(shared).fontSize, flat(shared).marginTop]);
  expect(flat(glyph).fontSize).toBe(18);
  expect(flat(glyph).marginTop).toBe((typography.bodySmall.lineHeight - 18) / 2);
  expect(flat(line).lineHeight).toBe(typography.bodySmall.lineHeight);
});

/** LS C1's class: each Recipe card state, the gap its frame draws between the card's parts, and the gap built. */
const CARDS: [string, number, () => void, string][] = [
  ['F01 linked, shared', 0, () => undefined, 'Banana protein shake'],
  ['F08 linked, private (with the private line and R6)', 0, () => { mockDb.meals[0].recipe_id = 'r3'; mockDb.meals[0].swap_template_ids = ['gone', 'm2']; },
    'Overnight protein oats'],
  ['F05 none linked (frame 2 and 6 pt)', spacing.xs, () => { mockDb.meals[0].recipe_id = null; },
    'Link one of your recipes. Clients can open it from this meal when you share it with them.'],
  ['F07 no recipes to link (frame 2 and 4 pt)', spacing.xs, () => { mockDb.meals[0].recipe_id = null; mockDb.recipes = []; }, 'No recipes yet'],
];

it.each(CARDS)('LS C1: the Recipe card, %s, sets its parts %d pt apart, as drawn', async (_state, gap, given, text) => {
  given();
  const s = await editor({ mealId: 'm1' });
  const card = hostAbove(await s.findByText(text));
  expect(hostAbove(s.getByText('Recipe'), (n) => n === card)).toBe(card); // the card that holds the Recipe header
  expect([flat(card).gap ?? 0, flat(card).rowGap]).toEqual([gap, undefined]);
});

const STRIPS: [string, { width: number; height: number; fontScale: number }, number][] = [
  ['390 pt with the keyboard up', { width: 390, height: 844, fontScale: 1 }, 115],
  ['320 pt with 130% text', { width: 320, height: 568, fontScale: 1.3 }, 104],
];

it.each(STRIPS)('LO C1: at %s, "Edit details" scrolls to the Details panel\'s top less the pinned strip, so the panel starts under the strip', async (_where, z, stripH) => {
  size(z);
  const scrollTo = jest.spyOn(ScrollView.prototype as any, 'scrollTo');
  const s: Page = await editor({ mealId: 'm1' });
  await s.findByText('Banana protein shake');
  await fireEvent(s.getByTestId('meal-masthead'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: z.width, height: 300 } } });
  await fireEvent(s.getByTestId('meal-strip', { includeHiddenElements: true }), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: z.width, height: stripH } } });
  const panel = hostAbove(s.getByText('Details'), (n) => !!n.props.onLayout);
  await fireEvent(panel, 'layout', { nativeEvent: { layout: { x: 0, y: 1180, width: z.width, height: 470 } } });
  scrollTo.mockClear();
  await fireEvent.press(s.getByLabelText('Edit details'));
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo.mock.calls[0][0]).toEqual({ y: 1180 - stripH, animated: true });
  // At that offset the strip is pinned (it pins once no more of the masthead shows than it covers), and its lower edge
  // is the panel's top: offset + strip = 1180.
  await fireEvent.scroll(s.getByTestId('meal-scroll'), { nativeEvent: { contentOffset: { x: 0, y: 1180 - stripH },
    contentSize: { width: z.width, height: 1700 }, layoutMeasurement: { width: z.width, height: 418 } } });
  expect(flat(s.getByTestId('meal-strip', { includeHiddenElements: true })).opacity).toBe(1);
});
