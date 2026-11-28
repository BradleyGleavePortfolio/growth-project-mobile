/**
 * FIX-PSCM-1 (fix round 1 of PLAN-SWAPS-COACH-M; frames S1_F01 to F10 on ctx#613 @ f1f401ad, 2 px = 1 pt).
 * - The owner's #ALM-E40 ("they dont have the green banner above"): once the masthead has left the screen, F03, F08 and
 *   F10 keep a compact deep-green strip pinned under the top inset, "{meal name} · {kcal} kcal · P {p} · C {c} · F {f}",
 *   wrapping at 320 pt with 130% text, hidden from VoiceOver (the masthead is read once); no name yet, no name and no "For".
 * - B1 (both seats), class-first: every line the meal page and its two pickers add, at the frames' measured type
 *   (names Inter Medium 16, block and macro lines 14, the recipe's title Cormorant Medium 20), and the option rows at
 *   their drawn pitch (56 pt and a hairline, one container, no card gap between them).
 * - C1: the block header's title keeps its own width (flexGrow, not flex 1), so the count and Add wrap under it.
 * - C2: the recipe picker shows no "For " sub when the meal has no name yet.
 * - N1: "Archive this meal" is off only while a request runs or the meal loads. N2: Edit order ends with the last option.
 */
import React from 'react';
import { Alert, Dimensions, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockDb = { meals: [] as Row[], recipes: [] as Row[] };
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), popTo: jest.fn(), dispatch: jest.fn(), push: jest.fn() };

jest.mock('../../../../services/api', () => ({ __esModule: true, coachApi: { getClients: () => Promise.resolve({ data: [] }) },
  recipesApi: { list: () => Promise.resolve({ data: mockDb.recipes }) }, foodApi: { search: () => Promise.resolve({ data: { results: [] } }) },
  default: { get: (u: string) => Promise.resolve({ data: u === '/coach/meal-templates' ? mockDb.meals.filter((m) => !m.archived_at) : [] }),
    post: () => Promise.resolve({ data: {} }), patch: () => Promise.resolve({ data: {} }), delete: () => Promise.resolve({ data: {} }) } }));
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({}), useFocusEffect: jest.fn(), usePreventRemove: jest.fn() }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach' }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), SafeAreaView: require('react-native').View }));

import MealEditor from '../../CoachMealTemplatesScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { layout, lightTokens, radius, spacing, typography } from '../../../../theme/tokens';

const meal = (id: string, name: string, k: number, p: number, c: number, f: number, more: Row = {}) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null,
    swap_template_ids: [], recipe_id: null, ...more });
const recipe = (id: string, title: string, pub: boolean, allergens: string[], k: number, p: number, c: number, f: number) =>
  ({ id, title, servings: 1, calories: k, protein: p, carbs: c, fat: f, is_public: pub, created_by_id: 'coach', allergens, allergens_declared: true });
const SIZES = [{ width: 390, height: 844, fontScale: 1 }, { width: 320, height: 568, fontScale: 1.3 }];
const size = (z: (typeof SIZES)[number]) => Dimensions.set({ window: { ...z, scale: 2 }, screen: { ...z, scale: 2 } });
const flat = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Row;
const face = (el: { props: { style?: unknown } }) => { const s = flat(el); return { fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight }; };
const token = (t: { fontFamily: string; fontSize: number; lineHeight: number }) => ({ fontFamily: t.fontFamily, fontSize: t.fontSize, lineHeight: t.lineHeight });
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
let qc: QueryClient;
const mount = (ui: React.ReactElement) => render(
  <SafeAreaInsetsContext.Provider value={INSETS}><QueryClientProvider client={qc}>{ui}</QueryClientProvider></SafeAreaInsetsContext.Provider>);
const editor = (params?: Row) => mount(<MealEditor {...({ route: { params }, navigation: mockNav } as any)} />);
const open = (name: 'MealOptionsPickerScreen' | 'MealRecipePickerScreen', params: Row) => {
  const C = require(`../${name}`).default as React.ComponentType<any>;
  return mount(<C route={{ params }} navigation={mockNav} />);
};

beforeEach(() => {
  jest.clearAllMocks();
  size(SIZES[0]);
  for (const k of ['selection', 'success', 'error', 'mediumImpact'] as const) jest.spyOn(HapticService, k).mockResolvedValue();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockDb.meals = [
    meal('m1', 'Banana and whey shake', 250, 25, 32, 3, { description: 'Drink it 30 to 60 minutes before you train.', swap_template_ids: ['m2', 'm3', 'm4'], recipe_id: 'r1' }),
    meal('m2', 'Rice cakes, honey and whey', 240, 26, 30, 2), meal('m3', 'Greek yoghurt and granola', 260, 22, 34, 5),
    meal('m4', 'Cottage cheese and pineapple', 230, 24, 26, 3), meal('m5', 'Apple and peanut butter', 270, 7, 30, 16),
  ];
  mockDb.recipes = [recipe('r1', 'Banana protein shake', true, ['dairy'], 250, 25, 32, 3), recipe('r3', 'Overnight protein oats', false, ['soy'], 320, 24, 38, 5)];
});
afterEach(() => jest.restoreAllMocks());

const STRIP = 'Banana and whey shake · 250 kcal · P 25 · C 32 · F 3';
/** The page lays out its masthead (300 pt tall) and is scrolled to `y`. */
async function scrollTo(s: Awaited<ReturnType<typeof editor>>, y: number) {
  await fireEvent(s.getByTestId('meal-masthead'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 300 } } });
  await fireEvent.scroll(s.getByTestId('meal-scroll'), { nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 390, height: 1600 }, layoutMeasurement: { width: 390, height: 700 } } });
}

describe.each(SIZES)('#ALM-E40 the pinned strip at $width pt, $fontScale text', (z) => {
  it('strip 1: none while the masthead shows; once it has left the screen, the strip pins over the page under the top inset, as drawn', async () => {
    size(z);
    const s = await editor({ mealId: 'm1' });
    await s.findByText('Banana protein shake');
    expect(s.queryByTestId('meal-strip', { includeHiddenElements: true })).toBeNull();
    await scrollTo(s, 200); // the masthead's lower part still shows under the status bar
    expect(s.queryByTestId('meal-strip', { includeHiddenElements: true })).toBeNull();
    await scrollTo(s, 300 - INSETS.top); // its last line has gone under the top inset
    const strip = s.getByTestId('meal-strip', { includeHiddenElements: true });
    const words = within(strip).getByText(STRIP, { includeHiddenElements: true });
    // Pinned: drawn outside the scroll area, across the top of the page.
    expect(within(s.getByTestId('meal-scroll')).queryByTestId('meal-strip', { includeHiddenElements: true })).toBeNull();
    expect(flat(strip)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: lightTokens.surface.masthead,
      paddingTop: INSETS.top + spacing.xs, paddingBottom: spacing.md, paddingHorizontal: layout.gutter,
      borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet });
    expect({ ...face(words), color: flat(words).color }).toEqual({ ...token(typography.body), color: lightTokens.textOnMastheadMuted });
    expect(words.props.numberOfLines).toBeUndefined(); // it wraps (two lines at 320 pt with 130% text, as F03 and F10 draw)
    await scrollTo(s, 0);
    expect(s.queryByTestId('meal-strip', { includeHiddenElements: true })).toBeNull();
  });
});

it('strip 2: decoration for sighted users: hidden from VoiceOver, and the masthead is read once', async () => {
  const s = await editor({ mealId: 'm1' });
  await s.findByText('Banana protein shake');
  await scrollTo(s, 400);
  const strip = s.getByTestId('meal-strip', { includeHiddenElements: true });
  expect(strip.props.accessibilityElementsHidden).toBe(true);
  expect(strip.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(s.queryByText(STRIP)).toBeNull(); // not in the accessibility tree
  expect(s.getAllByRole('header').filter((h) => h.props.children === 'Banana and whey shake')).toHaveLength(1);
});

it('strip 3: a New meal before Name is typed: the macros alone, no name, no "For" and no leading dot; the typed name joins it', async () => {
  const s = await editor();
  await s.findByText('Options for clients');
  await scrollTo(s, 400);
  expect(within(s.getByTestId('meal-strip', { includeHiddenElements: true })).getByText('0 kcal · P 0 · C 0 · F 0', { includeHiddenElements: true })).toBeTruthy();
  await fireEvent.changeText(s.getByLabelText('Name'), 'Oats');
  await fireEvent.changeText(s.getByLabelText('Calories (kcal)'), '380');
  expect(within(s.getByTestId('meal-strip', { includeHiddenElements: true })).getByText('Oats · 380 kcal · P 0 · C 0 · F 0', { includeHiddenElements: true })).toBeTruthy();
});

/** B1's class (LS and LO B1, the seat's list): each line, the state that draws it, and the frame's measured type. */
const SMALL = token(typography.bodySmall);
const NAME = token(typography.bodyMd);
const CLASS: [string, string, () => Promise<Awaited<ReturnType<typeof editor>>>, ReturnType<typeof token>][] = [
  ['F01 the block line (MealEditorBlocks :82)', 'Clients can pick one instead. These go with this meal in every day plan that uses it.', () => editor({ mealId: 'm1' }), SMALL],
  ['F01 an option name (:91)', 'Rice cakes, honey and whey', () => editor({ mealId: 'm1' }), NAME],
  ['F01 its macro line (:92)', '240 kcal · P 26 · C 30 · F 2', () => editor({ mealId: 'm1' }), SMALL],
  ['F01 the recipe title (:190, :218)', 'Banana protein shake', () => editor({ mealId: 'm1' }), token(typography.h3)],
  ['F01 per serving (:193)', 'Per serving · 250 kcal · P 25 · C 32 · F 3', () => editor({ mealId: 'm1' }), SMALL],
  ['F01 the share line (Line :25, :194)', 'Shared with your clients', () => editor({ mealId: 'm1' }), SMALL],
  ['F01 the allergen line (:195)', 'Contains dairy', () => editor({ mealId: 'm1' }), SMALL],
  ['F01 R6 (:197)', 'A client who saved an allergen this recipe declares does not see the link.', () => editor({ mealId: 'm1' }), SMALL],
  ['F08 the archived name (:96)', 'A meal you archived', async () => { mockDb.meals[0].swap_template_ids = ['gone', 'm2']; return editor({ mealId: 'm1' }); }, NAME],
  ['F08 the archived line (:97)', 'Clients do not see it. It still counts toward the 10.', async () => { mockDb.meals[0].swap_template_ids = ['gone', 'm2']; return editor({ mealId: 'm1' }); }, SMALL],
  ['F08 the private line (:196)', 'Only you can open it, so clients will not see this link.', async () => { mockDb.meals[0].recipe_id = 'r3'; return editor({ mealId: 'm1' }); }, SMALL],
  ['F05 the empty block line (:82)', 'Clients on a plan with this meal can pick one of these instead.', () => editor(), SMALL],
  ['F05 the recipe lead (:174)', 'Link one of your recipes. Clients can open it from this meal when you share it with them.', () => editor(), SMALL],
  ['F07 the title (:169)', 'No recipes yet', async () => { mockDb.recipes = []; return editor(); }, token(typography.h3)],
  ['F07 the line (:170)', 'You have no recipes to link. Recipes cannot be made in the app yet.', async () => { mockDb.recipes = []; return editor(); }, SMALL],
];

it.each(CLASS)('B1 class: %s at the frame\'s type', async (_where, text, mountState, want) => {
  const s = await mountState();
  expect(face(await s.findByText(text))).toEqual(want);
});

it('B1 class: F03 Edit order lines at 14 pt (the order line, the limit line, the archived row)', async () => {
  mockDb.meals.push(...['a', 'b', 'c', 'd', 'e'].map((x, i) => meal(`x${x}`, `Extra ${x}`, 100 + i, 1, 1, 1)));
  mockDb.meals[0].swap_template_ids = ['m2', 'gone', 'm3', 'm4', 'm5', 'xa', 'xb', 'xc', 'xd', 'xe'];
  const s = await editor({ mealId: 'm1' });
  await fireEvent.press(await s.findByLabelText('More for Rice cakes, honey and whey'));
  for (const t of ['Move up and Move down set the order clients see.', 'Up to 10 options. Remove one to add another.', 'Clients do not see it.']) {
    expect([t, face(s.getByText(t))]).toEqual([t, SMALL]);
  }
});

it('B1 rows: the option rows sit at the F01 pitch (56 pt and a hairline) in one container, with no card gap between them', async () => {
  const s = await editor({ mealId: 'm1' });
  // The row: the nearest host View above the More button that carries the hairline.
  const rowOf = (b: any) => { let n = b; while (n && !(flat(n).borderTopWidth > 0)) n = n.parent; return n; };
  const look = (await s.findAllByLabelText(/^More for /)).map((b) => rowOf(b));
  expect(look).toHaveLength(3);
  for (const r of look) {
    expect(flat(r)).toMatchObject({ minHeight: layout.rowMinHeight, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth });
  }
  const box = look[0].parent;
  expect(look.every((r) => r.parent === box)).toBe(true);
  expect(flat(box).gap ?? 0).toBe(0);
});

it('B1 class: the options picker (F02) draws each name in Inter Medium 16 and its row at 56 pt', async () => {
  const p = await open('MealOptionsPickerScreen', { mealId: 'm1', mealName: 'Banana and whey shake', chosen: ['m2'] });
  const name = await p.findByText('Rice cakes, honey and whey');
  expect(face(name)).toEqual(NAME);
  expect(face(p.getByText('240 kcal · P 26 · C 30 · F 2'))).toEqual(SMALL);
  expect(flat(p.getByTestId('option-m2'))).toMatchObject({ minHeight: layout.rowMinHeight, paddingVertical: spacing.xs });
});

it.each(SIZES)('C1: at $width pt, $fontScale text, the block titles keep their own width (flexGrow), so the count and Add wrap under them', async (z) => {
  size(z);
  const s = await editor({ mealId: 'm1' });
  await s.findByText('Banana protein shake');
  for (const t of ['Options for clients', 'Recipe']) {
    const st = flat(s.getByText(t));
    expect([t, st.flex, st.flexGrow]).toEqual([t, undefined, 1]);
  }
});

it('C2: with no meal name yet the recipe picker shows no "For " sub; with one it reads "For {meal}"', async () => {
  const none = await open('MealRecipePickerScreen', { mealId: undefined, mealName: '', recipeId: null });
  await none.findByText('Overnight protein oats');
  expect(none.queryByText(/^For\b/)).toBeNull();
  none.unmount();
  const named = await open('MealRecipePickerScreen', { mealId: 'm1', mealName: 'Banana and whey shake', recipeId: 'r1' });
  expect(await named.findByText('For Banana and whey shake')).toBeTruthy();
});

it('N1: "Archive this meal" stays on while Save meal is off for a cleared name; it asks before archiving', async () => {
  const ask = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const s = await editor({ mealId: 'm1' });
  await fireEvent.changeText(await s.findByLabelText('Name'), '');
  expect(s.getByTestId('meal-save').props.accessibilityState?.disabled).toBe(true);
  const archive = s.getByLabelText('Archive this meal');
  expect(archive.props.accessibilityState?.disabled).toBe(false);
  await fireEvent.press(archive);
  expect(ask).toHaveBeenCalledWith('Archive Banana and whey shake?', expect.any(String), expect.any(Array));
});

it('N1: while the meal loads (F09) both footer actions are present and off', async () => {
  qc.setQueryDefaults(['meal-templates'], { queryFn: () => new Promise(() => {}) });
  const s = await editor({ mealId: 'm1' });
  await waitFor(() => expect(s.getByLabelText('Loading the meal')).toBeTruthy());
  expect(s.getByLabelText('Archive this meal').props.accessibilityState?.disabled).toBe(true);
  expect(s.getByTestId('meal-save').props.accessibilityState?.disabled).toBe(true);
});

it('N2: Remove on the last option ends Edit order, so an option added later opens in the normal mode', async () => {
  mockDb.meals[0].swap_template_ids = ['m2'];
  const s = await editor({ mealId: 'm1' });
  await fireEvent.press(await s.findByLabelText('More for Rice cakes, honey and whey'));
  expect(s.getByLabelText('Done editing')).toBeTruthy();
  await fireEvent.press(s.getByLabelText('Remove Rice cakes, honey and whey'));
  expect(s.getByText('0 of 10')).toBeTruthy();
  await s.rerender(<SafeAreaInsetsContext.Provider value={INSETS}><QueryClientProvider client={qc}>
    <MealEditor {...({ route: { params: { mealId: 'm1', picked: { options: ['m3'], at: 1 } } }, navigation: mockNav } as any)} />
  </QueryClientProvider></SafeAreaInsetsContext.Provider>);
  expect(await s.findByLabelText('More for Greek yoghurt and granola')).toBeTruthy();
  expect(s.queryByLabelText('Done editing')).toBeNull();
  expect(s.queryByLabelText('Move up Greek yoghurt and granola')).toBeNull();
});
