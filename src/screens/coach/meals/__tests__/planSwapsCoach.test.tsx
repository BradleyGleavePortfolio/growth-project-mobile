/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3): the coach's meal page with options for clients and a recipe
 * link, the two pickers, and a time on each meal of a day plan. Real screens and hooks against a fake of backend main's
 * routes (mealPlansV2's, extended to store swap_template_ids, recipe_id and time_of_day and to answer GET /recipes).
 * The pickers and the time sheet are new files: they load with require() inside the cases that mount them, so at the
 * base those cases are red for "no screen" and every other case is red on its own assertion.
 */
import React from 'react';
import { Dimensions, Modal, StyleSheet, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockDb = { meals: [] as Row[], plans: [] as Row[], recipes: [] as Row[], fail: {} as Record<string, unknown>,
  hold: {} as Record<string, Promise<void>>, log: [] as string[], bodies: [] as Row[] };
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), popTo: jest.fn(), dispatch: jest.fn(), push: jest.fn() };
let mockUser: { id: string } | null = { id: 'coach' };
let mockPick = new Date(2024, 0, 15, 19, 30);

/** Backend main's coach meal routes, own rows only, archived rows hidden from the list; GET /recipes is his own
 *  recipes plus his head coach's shared ones, newest first (recipe-access.ts). */
function mockRoute(method: string, url: string, body: Row = {}): Promise<{ data: unknown }> {
  const key = `${method} ${url}`; mockDb.log.push(key); mockDb.bodies.push({ key, body });
  if (key in mockDb.hold) return mockDb.hold[key].then(() => answer(method, url, key, body));
  return answer(method, url, key, body);
}
function answer(method: string, url: string, key: string, body: Row): Promise<{ data: unknown }> {
  if (key in mockDb.fail) return mockDb.fail[key] === 'hang' ? new Promise(() => {}) : Promise.reject(mockDb.fail[key]);
  if (url === '/recipes') return Promise.resolve({ data: mockDb.recipes });
  const [, , kind, id, sub] = url.split('/');
  const live = (rows: Row[]) => rows.filter((r) => !r.archived_at);
  const plan = (p: Row) => ({ ...p, slots: p.slots.map((s: Row) => ({ ...s, meal_template: mockDb.meals.find((m) => m.id === s.meal_template_id) })) });
  const no = (status: number, message: string) => Promise.reject({ response: { status, data: { message } } });
  let data: unknown;
  if (kind === 'meal-templates') {
    const meal = live(mockDb.meals).find((m) => m.id === id);
    if (method === 'GET') data = live(mockDb.meals);
    else if (method === 'POST') mockDb.meals.push((data = { id: `m${mockDb.meals.length + 1}`, archived_at: null, swap_template_ids: [], recipe_id: null, ...body }) as Row);
    else if (!meal) return no(404, 'Meal template not found');
    else data = Object.assign(meal, method === 'DELETE' ? { archived_at: '2026-10-16T00:00:00.000Z' } : body);
  } else if (sub === 'assignments') data = [];
  else {
    const p = live(mockDb.plans).find((x) => x.id === id);
    if (id && !p) return no(404, 'Daily meal plan not found');
    if (method === 'GET') data = p ? plan(p) : live(mockDb.plans).map(plan);
    else data = plan(Object.assign(p as Row, body.slots ? { ...body, slots: body.slots.map((x: Row, i: number) => ({ id: `n${i}`, ...x })) } : body));
  }
  return Promise.resolve({ data });
}
jest.mock('../../../../services/api', () => ({ __esModule: true, coachApi: { getClients: () => Promise.resolve({ data: [] }) },
  recipesApi: { list: () => mockRoute('GET', '/recipes') }, foodApi: { search: () => Promise.resolve({ data: { results: [] } }) },
  default: { get: (u: string) => mockRoute('GET', u), post: (u: string, b: Row) => mockRoute('POST', u, b),
    patch: (u: string, b: Row) => mockRoute('PATCH', u, b), delete: (u: string) => mockRoute('DELETE', u) } }));
jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  return { ...actual, featureFlags: Object.defineProperties({ ...actual.featureFlags }, { mealPlansV2: { get: () => true } }) };
});
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({}), useFocusEffect: jest.fn(), usePreventRemove: jest.fn() }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), SafeAreaView: require('react-native').View }));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: ({ testID, onChange, value }: Row) =>
  require('react').createElement(require('react-native').Pressable, { testID, onPress: () => onChange({ type: 'set' }, mockPick) },
    require('react').createElement(require('react-native').Text, null, `wheel ${value.getHours()}:${String(value.getMinutes()).padStart(2, '0')}`)) }));

import MealEditor from '../../CoachMealTemplatesScreen';
import DayPlanBuilder from '../DayPlanBuilderScreen';
import MealPicker from '../MealPickerScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';

const meal = (id: string, name: string, k: number, p: number, c: number, f: number, more: Row = {}) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null,
    swap_template_ids: [], recipe_id: null, ...more });
const recipe = (id: string, title: string, by: string, pub: boolean, allergens: string[], k: number, p: number, c: number, f: number) =>
  ({ id, title, servings: 1, calories: k, protein: p, carbs: c, fat: f, is_public: pub, created_by_id: by, allergens, allergens_declared: true });
const slot = (id: string, meal_template_id: string, slot_label: string, order: number, time_of_day: string | null) =>
  ({ id, meal_template_id, slot_label, order, time_of_day });
const haptic = (k: 'selection' | 'success' | 'error' | 'mediumImpact') => HapticService[k] as jest.Mock;
const writes = () => mockDb.bodies.filter((b) => !b.key.startsWith('GET'));
let qc: QueryClient;
const mount = (ui: React.ReactElement) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
const editor = (params?: Row) => mount(<MealEditor {...({ route: { params }, navigation: mockNav } as any)} />);
const rerenderEditor = (s: ReturnType<typeof mount>, params?: Row) =>
  s.rerender(<QueryClientProvider client={qc}><MealEditor {...({ route: { params }, navigation: mockNav } as any)} /></QueryClientProvider>);
const open = (C: React.ComponentType<any>, params?: Row) => mount(<C route={{ params }} navigation={mockNav} />);
const screen = (name: 'MealOptionsPickerScreen' | 'MealRecipePickerScreen') => require(`../${name}`).default as React.ComponentType<any>;
const plan = () => mockDb.plans[0].slots.map((x: Row) => `${x.meal_template_id} ${x.slot_label} ${x.order} ${x.time_of_day ?? '-'}`);
const SIZES = [{ width: 390, height: 844, fontScale: 1 }, { width: 320, height: 568, fontScale: 1.3 }];
const size = (z: (typeof SIZES)[number]) => Dimensions.set({ window: { ...z, scale: 2 }, screen: { ...z, scale: 2 } });

beforeEach(() => {
  jest.clearAllMocks();
  size(SIZES[0]);
  mockUser = { id: 'coach' };
  mockPick = new Date(2024, 0, 15, 19, 30);
  for (const k of ['selection', 'success', 'error', 'mediumImpact'] as const) jest.spyOn(HapticService, k).mockResolvedValue();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockDb.meals = [
    meal('m1', 'Banana and whey shake', 250, 25, 32, 3, { description: 'Drink it 30 to 60 minutes before you train.', swap_template_ids: ['m2', 'm3', 'm4'], recipe_id: 'r1' }),
    meal('m2', 'Rice cakes, honey and whey', 240, 26, 30, 2), meal('m3', 'Greek yoghurt and granola', 260, 22, 34, 5),
    meal('m4', 'Cottage cheese and pineapple', 230, 24, 26, 3), meal('m5', 'Apple and peanut butter', 270, 7, 30, 16),
    meal('m6', 'Overnight oats', 380, 18, 52, 10), meal('m7', 'Greek yoghurt, oats and berries', 420, 35, 48, 9),
    meal('m8', 'Salmon, potatoes and green beans', 620, 42, 55, 22), meal('m9', 'Chicken, rice and greens', 560, 45, 60, 14),
  ];
  mockDb.recipes = [
    recipe('r1', 'Banana protein shake', 'coach', true, ['dairy'], 250, 25, 32, 3),
    recipe('rR', 'Riley shared bowl', 'riley', true, [], 300, 20, 30, 10),
    recipe('r2', 'Protein Smoothie Bowl', 'coach', true, ['dairy', 'tree_nuts'], 440, 38, 48, 9),
    recipe('r3', 'Overnight protein oats', 'coach', false, ['soy'], 320, 24, 38, 5),
  ];
  mockDb.plans = [{ id: 'p1', coach_id: 'coach', name: 'Foundations', notes: null, archived_at: null,
    slots: [slot('s1', 'm8', 'dinner', 0, '19:30'), slot('s2', 'm7', 'breakfast', 1, '07:40'), slot('s3', 'm5', 'snack', 2, null)] }];
  Object.assign(mockDb, { fail: {}, hold: {}, log: [], bodies: [] });
});
afterEach(() => jest.restoreAllMocks());

describe.each(SIZES)('F01 the meal page at $width pt, $fontScale text', (z) => {
  it('case 1: Options for clients, the Recipe card and Details in order; Save meal sends one PATCH with the list in order and the recipe; Back sends nothing', async () => {
    size(z);
    const s = await editor({ mealId: 'm1' });
    expect(await s.findByText('Options for clients')).toBeTruthy();
    expect(await s.findByText('Banana protein shake')).toBeTruthy();
    const order = s.getAllByRole('header').map((h) => h.props.children);
    expect(order).toEqual(['Banana and whey shake', 'Options for clients', 'Recipe', 'Details']);
    expect(s.getByText('3 of 10')).toBeTruthy();
    expect(s.getByText('Clients can pick one instead. These go with this meal in every day plan that uses it.')).toBeTruthy();
    expect(s.getAllByLabelText(/^More for /).map((b) => b.props.accessibilityLabel))
      .toEqual(['More for Rice cakes, honey and whey', 'More for Greek yoghurt and granola', 'More for Cottage cheese and pineapple']);
    expect(s.getByText('240 kcal · P 26 · C 30 · F 2')).toBeTruthy();
    expect(s.getByText('“Drink it 30 to 60 minutes before you train.”')).toBeTruthy();
    for (const t of ['Per serving · 250 kcal · P 25 · C 32 · F 3', 'Shared with your clients', 'Contains dairy',
      'A client who saved an allergen this recipe declares does not see the link.']) expect(s.getByText(t)).toBeTruthy();
    expect([s.getByLabelText('Change recipe'), s.getByLabelText('Remove link'), s.getByLabelText('Add an option'), s.getByLabelText('Edit details')]).toBeTruthy();
    expect(s.queryByText('Only you can open it, so clients will not see this link.')).toBeNull();
    expect(writes()).toEqual([]);
    await fireEvent.press(s.getByLabelText('Back'));
    expect([mockNav.goBack.mock.calls.length, writes()]).toEqual([1, []]);
    await fireEvent.press(s.getByTestId('meal-save'));
    await waitFor(() => expect(mockNav.goBack).toHaveBeenCalledTimes(2));
    expect(writes()).toEqual([{ key: 'PATCH /coach/meal-templates/m1', body: expect.objectContaining({ swap_template_ids: ['m2', 'm3', 'm4'], recipe_id: 'r1' }) }]);
  });
});

it('case 2: Add opens the picker with the meal; two ticks and Done hand back through popTo; the form keeps what was typed; applied once; Back hands nothing', async () => {
  const s = await editor({ mealId: 'm1' });
  await fireEvent.changeText(await s.findByLabelText('Name'), 'Banana shake');
  await fireEvent.changeText(s.getByLabelText('Protein (g)'), '27');
  await fireEvent.press(s.getByLabelText('Add an option'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealOptionsPicker', { mealId: 'm1', mealName: 'Banana shake', chosen: ['m2', 'm3', 'm4'] });
  const Picker = screen('MealOptionsPickerScreen');
  const p = await open(Picker, { mealId: 'm1', mealName: 'Banana shake', chosen: ['m2', 'm3', 'm4'] });
  expect(await p.findByText('For Banana shake · 3 of 10')).toBeTruthy();
  await fireEvent.press(p.getByTestId('option-m6'));
  await fireEvent.press(p.getByTestId('option-m5'));
  expect(p.getByText('For Banana shake · 5 of 10')).toBeTruthy();
  await fireEvent.press(p.getByTestId('options-done'));
  const [route, params] = mockNav.popTo.mock.calls[0];
  expect([route, params.mealId, params.picked.options]).toEqual(['MealEditor', 'm1', ['m2', 'm3', 'm4', 'm6', 'm5']]);
  await p.unmount();
  await rerenderEditor(s, params);
  expect(s.getByText('5 of 10')).toBeTruthy();
  expect([s.getByLabelText('Name').props.value, s.getByLabelText('Protein (g)').props.value]).toEqual(['Banana shake', '27']);
  await fireEvent.press(s.getByLabelText('More for Overnight oats'));
  await fireEvent.press(s.getByLabelText('Remove Overnight oats'));
  await rerenderEditor(s, { ...params });
  await rerenderEditor(s, params);
  expect(s.getByText('4 of 10')).toBeTruthy();
  const q = await open(Picker, { mealId: 'm1', mealName: 'Banana shake', chosen: ['m2'] });
  await fireEvent.press(await q.findByTestId('option-m6'));
  await fireEvent.press(q.getByLabelText('Back'));
  expect([mockNav.popTo.mock.calls.length, mockNav.goBack.mock.calls.length]).toEqual([1, 1]);
});

it('case 3: the options picker is A to Z without this meal; archived ids count; at 10 the unticked rows are off; search; F06 and its New meal; loading and failure', async () => {
  const Picker = screen('MealOptionsPickerScreen');
  mockDb.hold['GET /coach/meal-templates'] = new Promise(() => {});
  let p = await open(Picker, { mealId: 'm1', mealName: 'Banana and whey shake', chosen: ['m2', 'gone'] });
  expect(p.getByLabelText('Loading your meals')).toBeTruthy();
  await p.unmount();
  delete mockDb.hold['GET /coach/meal-templates'];
  qc.clear();
  p = await open(Picker, { mealId: 'm1', mealName: 'Banana and whey shake', chosen: ['m2', 'gone'] });
  expect(await p.findByText('Your meals, A to Z')).toBeTruthy();
  expect(p.getAllByRole('checkbox').map((r) => r.props.accessibilityLabel)).toEqual([
    'Apple and peanut butter, 270 kcal, P 7, C 30, F 16', 'Chicken, rice and greens, 560 kcal, P 45, C 60, F 14',
    'Cottage cheese and pineapple, 230 kcal, P 24, C 26, F 3', 'Greek yoghurt and granola, 260 kcal, P 22, C 34, F 5',
    'Greek yoghurt, oats and berries, 420 kcal, P 35, C 48, F 9', 'Overnight oats, 380 kcal, P 18, C 52, F 10',
    'Rice cakes, honey and whey, 240 kcal, P 26, C 30, F 2', 'Salmon, potatoes and green beans, 620 kcal, P 42, C 55, F 22']);
  expect(p.getByText('For Banana and whey shake · 2 of 10')).toBeTruthy();
  expect(p.getByTestId('option-m2').props.accessibilityState).toMatchObject({ checked: true });
  for (const id of ['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']) await fireEvent.press(p.getByTestId(`option-${id}`));
  expect(p.getByText('For Banana and whey shake · 9 of 10')).toBeTruthy();
  await p.unmount();
  p = await open(Picker, { mealId: 'm1', mealName: '', chosen: ['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'gone', 'gone2', 'gone3'] });
  expect(await p.findByText('10 of 10')).toBeTruthy();
  expect(p.getByTestId('option-m9').props.accessibilityState).toMatchObject({ checked: false, disabled: true });
  await fireEvent.press(p.getByTestId('option-m9'));
  await fireEvent.press(p.getByTestId('option-m2'));
  expect(p.getByText('9 of 10')).toBeTruthy();
  await fireEvent.changeText(p.getByLabelText('Search your meals'), 'greek');
  expect(p.getAllByRole('checkbox')).toHaveLength(2);
  await fireEvent.changeText(p.getByLabelText('Search your meals'), 'zzz');
  expect(p.getByText('No meals match “zzz”.')).toBeTruthy();
  await p.unmount();
  mockDb.meals = [mockDb.meals[0]];
  qc.clear();
  p = await open(Picker, { mealId: 'm1', mealName: 'Banana and whey shake', chosen: [] });
  expect(await p.findByText('No other meals yet.')).toBeTruthy();
  expect(p.getByText('An option is another of your meals. Make one with its calories and macros, then add it here.')).toBeTruthy();
  expect(p.getByTestId('options-done').props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(p.getByLabelText('New meal'));
  expect(mockNav.push).toHaveBeenCalledWith('MealEditor');
  await p.unmount();
  qc.clear();
  mockDb.fail['GET /coach/meal-templates'] = { message: 'Network Error', isAxiosError: true };
  p = await open(Picker, { mealId: 'm1', mealName: 'Banana and whey shake', chosen: [] });
  expect(await p.findByText('Your meals didn’t load.')).toBeTruthy();
  expect(haptic('error')).toHaveBeenCalledTimes(1);
});

it('case 4: More enters Edit order; Move up, Move down and Remove; first and last are off; Done leaves; at 10 Add is off with the lock line; the actions on More do the same', async () => {
  const s = await editor({ mealId: 'm1' });
  await fireEvent.press(await s.findByLabelText('More for Greek yoghurt and granola'));
  expect(s.getByText('Move up and Move down set the order clients see.')).toBeTruthy();
  expect(s.getByLabelText('Move up Rice cakes, honey and whey').props.accessibilityState).toMatchObject({ disabled: true });
  expect(s.getByLabelText('Move down Cottage cheese and pineapple').props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(s.getByLabelText('Move up Greek yoghurt and granola'));
  await fireEvent.press(s.getByLabelText('Move down Rice cakes, honey and whey'));
  await fireEvent.press(s.getByLabelText('Remove Cottage cheese and pineapple'));
  await fireEvent.press(s.getByLabelText('Done editing'));
  expect(s.getAllByLabelText(/^More for /).map((b) => b.props.accessibilityLabel)).toEqual(['More for Greek yoghurt and granola', 'More for Rice cakes, honey and whey']);
  const more = s.getByLabelText('More for Rice cakes, honey and whey');
  expect(more.props.accessibilityActions.map((a: Row) => a.label)).toEqual(['Move up', 'Remove']);
  await act(async () => more.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } }));
  expect(s.getAllByLabelText(/^More for /).map((b) => b.props.accessibilityLabel)).toEqual(['More for Rice cakes, honey and whey', 'More for Greek yoghurt and granola']);
  await act(async () => s.getByLabelText('More for Greek yoghurt and granola').props.onAccessibilityAction({ nativeEvent: { actionName: 'remove' } }));
  expect(s.getByText('1 of 10')).toBeTruthy();
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0].body.swap_template_ids).toEqual(['m2']);
  mockDb.meals[0].swap_template_ids = ['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'g1', 'g2'];
  qc.clear();
  const t = await editor({ mealId: 'm1' });
  expect(await t.findByText('10 of 10')).toBeTruthy();
  expect(t.getByText('Up to 10 options. Remove one to add another.')).toBeTruthy();
  expect(t.getByLabelText('Add an option').props.accessibilityState).toMatchObject({ disabled: true });
});

it('case 5: an id missing from a fresh list is "A meal you archived", counts and is sent in place; a stale saved list draws nothing and builds no form; a failed re-read shows LoadFailed; a meal made on another device is never called archived', async () => {
  mockDb.meals[0].swap_template_ids = ['gone', 'm2', 'm3'];
  let s = await editor({ mealId: 'm1' });
  expect(await s.findByText('A meal you archived')).toBeTruthy();
  expect(s.getByText('Clients do not see it. It still counts toward the 10.')).toBeTruthy();
  expect(s.getByText('3 of 10')).toBeTruthy();
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0].body.swap_template_ids).toEqual(['gone', 'm2', 'm3']);
  await s.unmount();
  s = await editor({ mealId: 'm1' });
  await fireEvent.press(await s.findByLabelText('Remove the archived meal'));
  expect(s.getByText('2 of 10')).toBeTruthy();
  await s.unmount();
  // A stale saved list (hydrated from disk, older than staleTime) holds m1 and m2 only; m3 was made on another device.
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['meal-templates'], mockDb.meals.slice(0, 2).map((m) => ({ ...m, swap_template_ids: ['m2', 'm3'] })), { updatedAt: Date.now() - 6 * 60 * 1000 });
  mockDb.meals[0].swap_template_ids = ['m2', 'm3'];
  let release = () => {};
  mockDb.hold['GET /coach/meal-templates'] = new Promise<void>((r) => { release = r; });
  s = await editor({ mealId: 'm1' });
  expect(s.getByLabelText('Loading the meal')).toBeTruthy();
  expect([s.queryByText('A meal you archived'), s.queryByLabelText('Name')]).toEqual([null, null]);
  expect(s.getByTestId('meal-save').props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => release());
  expect(await s.findByText('Greek yoghurt and granola')).toBeTruthy();
  expect(s.queryByText('A meal you archived')).toBeNull();
  await s.unmount();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['meal-templates'], mockDb.meals.slice(0, 2), { updatedAt: Date.now() - 6 * 60 * 1000 });
  delete mockDb.hold['GET /coach/meal-templates'];
  mockDb.fail['GET /coach/meal-templates'] = { message: 'Network Error', isAxiosError: true };
  s = await editor({ mealId: 'm1' });
  expect(await s.findByText('This meal didn’t load.')).toBeTruthy();
  expect(s.getByText('Your plans are safe. Check your connection and try again.')).toBeTruthy();
  expect([s.queryByLabelText('Name'), s.queryByText('A meal you archived'), s.getByText('Try again')]).toEqual([null, null, expect.anything()]);
});

it('case 6: only his recipes, newest first, the linked one marked; a tap links; Remove link sends null; no recipes says so (never while loading); a failed read keeps the stored recipe', async () => {
  const Picker = screen('MealRecipePickerScreen');
  let p = await open(Picker, { mealId: 'm1', mealName: 'Banana and whey shake', recipeId: 'r1' });
  expect(await p.findByText('Your recipes, newest first')).toBeTruthy();
  expect(p.getByText('For Banana and whey shake')).toBeTruthy();
  expect(p.getAllByRole('checkbox').map((r) => r.props.accessibilityLabel)).toEqual([
    'Banana protein shake, linked, Per serving · 250 kcal · P 25 · C 32 · F 3, Shared with your clients, Contains dairy',
    'Protein Smoothie Bowl, Per serving · 440 kcal · P 38 · C 48 · F 9, Shared with your clients, Contains dairy and tree nuts',
    'Overnight protein oats, Per serving · 320 kcal · P 24 · C 38 · F 5, Only you, Contains soy']);
  expect(p.queryByText('Riley shared bowl')).toBeNull();
  expect(p.getByText('Linked')).toBeTruthy();
  await fireEvent.press(p.getByTestId('recipe-r3'));
  expect(mockNav.popTo).toHaveBeenLastCalledWith('MealEditor', { mealId: 'm1', picked: { recipeId: 'r3', at: expect.any(Number) } });
  await fireEvent.press(p.getByTestId('recipe-unlink'));
  expect(mockNav.popTo).toHaveBeenLastCalledWith('MealEditor', { mealId: 'm1', picked: { recipeId: null, at: expect.any(Number) } });
  await fireEvent.changeText(p.getByLabelText('Search your recipes'), 'zzz');
  expect(p.getByText('No recipes match “zzz”.')).toBeTruthy();
  await p.unmount();
  let s = await editor({ mealId: 'm1' });
  await rerenderEditor(s, { mealId: 'm1', picked: { recipeId: 'r3', at: 1 } });
  expect(await s.findByText('Overnight protein oats')).toBeTruthy();
  expect([s.getByText('Only you'), s.getByText('Only you can open it, so clients will not see this link.'),
    s.getByText('A client who saved an allergen this recipe declares does not see the link.')]).toBeTruthy();
  await fireEvent.press(s.getByLabelText('Remove link'));
  expect(s.getByText('Link one of your recipes. Clients can open it from this meal when you share it with them.')).toBeTruthy();
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0].body.recipe_id).toBeNull();
  await s.unmount();
  // No recipes of his own (Riley's shared one is not his): "No recipes yet" and no button; never while his id is unknown.
  mockDb.recipes = [mockDb.recipes[1]];
  mockDb.meals[0].recipe_id = null;
  qc.clear();
  mockUser = null;
  s = await editor({ mealId: 'm1' });
  expect(await s.findByLabelText('Loading your recipes')).toBeTruthy();
  expect(s.queryByText('No recipes yet')).toBeNull();
  mockUser = { id: 'coach' };
  await rerenderEditor(s, { mealId: 'm1' });
  expect(await s.findByText('No recipes yet')).toBeTruthy();
  expect(s.getByText('You have no recipes to link. Recipes cannot be made in the app yet.')).toBeTruthy();
  expect([s.queryByLabelText('Link a recipe'), s.queryByLabelText('Change recipe')]).toEqual([null, null]);
  await s.unmount();
  // A failed recipe read: F10's card in place of the Recipe card; Save sends the stored recipe_id unchanged.
  mockDb.meals[0].recipe_id = 'r1';
  qc.clear();
  mockDb.fail['GET /recipes'] = { message: 'Network Error', isAxiosError: true };
  s = await editor({ mealId: 'm1' });
  expect(await s.findByText('Your recipes didn’t load.')).toBeTruthy();
  expect(s.getByText('Your meal is safe. Check your connection and try again.')).toBeTruthy();
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1].body).toMatchObject({ recipe_id: 'r1', swap_template_ids: ['m2', 'm3', 'm4'] });
});

it('case 7: a New meal opens to the same blocks and its POST carries swap_template_ids and recipe_id ([] and null when none)', async () => {
  let s = await editor();
  expect(await s.findByText('0 of 10')).toBeTruthy();
  expect(s.getByText('Clients on a plan with this meal can pick one of these instead.')).toBeTruthy();
  expect(await s.findByText('Link one of your recipes. Clients can open it from this meal when you share it with them.')).toBeTruthy();
  expect([s.getByText('New meal'), s.getByText('Details'), s.queryByText('Archive this meal')]).toEqual([expect.anything(), expect.anything(), null]);
  await fireEvent.changeText(s.getByLabelText('Name'), 'Egg and avocado toast');
  for (const [label, v] of [['Calories (kcal)', '410'], ['Protein (g)', '20'], ['Carbs (g)', '34'], ['Fat (g)', '21']]) await fireEvent.changeText(s.getByLabelText(label), v);
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]).toEqual({ key: 'POST /coach/meal-templates', body: expect.objectContaining({ name: 'Egg and avocado toast', swap_template_ids: [], recipe_id: null }) });
  await s.unmount();
  s = await editor();
  await fireEvent.changeText(s.getByLabelText('Name'), 'Toast');
  await fireEvent.changeText(s.getByLabelText('Calories (kcal)'), '300');
  for (const label of ['Protein (g)', 'Carbs (g)', 'Fat (g)']) await fireEvent.changeText(s.getByLabelText(label), '10');
  await rerenderEditor(s, { picked: { options: ['m2', 'm3'], at: 1 } });
  await rerenderEditor(s, { picked: { recipeId: 'r2', at: 2 } });
  expect(await s.findByText('Protein Smoothie Bowl')).toBeTruthy();
  expect(s.getByText('2 of 10')).toBeTruthy();
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1].body).toMatchObject({ name: 'Toast', swap_template_ids: ['m2', 'm3'], recipe_id: 'r2' });
});

it.each<[string, unknown, string]>([
  ['MEAL_SWAP_INVALID', { response: { status: 400, data: { code: 'MEAL_SWAP_INVALID', error: 'MEAL_SWAP_INVALID', message: 'x' } } },
    'A swap must be one of your own meals that is not archived, and not this meal. Pick swaps from your meals and save again.'],
  ['MEAL_RECIPE_INVALID', { response: { status: 400, data: { code: 'MEAL_RECIPE_INVALID', error: 'MEAL_RECIPE_INVALID', message: 'x' } } },
    'The recipe must be one of your own recipes. Pick a recipe you created and save again.'],
  ['no connection', { message: 'Network Error', isAxiosError: true }, 'That did not save. Check your connection, then try again.'],
])('case 8: a save refused (%s) says its line above the footer; every value kept; one error haptic', async (_, err, line) => {
  mockDb.fail['PATCH /coach/meal-templates/m1'] = err;
  const s = await editor({ mealId: 'm1' });
  await fireEvent.changeText(await s.findByLabelText('Name'), 'Banana shake');
  await fireEvent.press(s.getByTestId('meal-save'));
  await s.findByText(line);
  expect(s.getAllByRole('alert').filter((a) => within(a).queryByText(line))).toHaveLength(1);
  expect(within(s.getByTestId('meal-footer')).getByText(line)).toBeTruthy();
  expect([s.getByLabelText('Name').props.value, s.getByText('3 of 10'), mockNav.goBack.mock.calls.length, haptic('error').mock.calls.length])
    .toEqual(['Banana shake', expect.anything(), 0, 1]);
});

it('case 9: the builder shows time order and keeps saved order; Swap and Remove act on the saved meal; a card opens its meal; an archived card is not a button', async () => {
  const b = await open(DayPlanBuilder, { planId: 'p1' });
  await b.findByDisplayValue('Foundations');
  const names = b.getAllByLabelText(/^Open /).map((x) => x.props.accessibilityLabel);
  expect(names).toEqual(['Open Breakfast: Greek yoghurt, oats and berries, 420 kcal, P 35, C 48, F 9',
    'Open Snack: Apple and peanut butter, 270 kcal, P 7, C 30, F 16', 'Open Dinner: Salmon, potatoes and green beans, 620 kcal, P 42, C 55, F 22']);
  await fireEvent.press(b.getAllByLabelText(/^Swap /)[0]);
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealPicker', { planId: 'p1', index: 1 });
  await fireEvent.press(b.getByLabelText(names[0]));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealEditor', { mealId: 'm7' });
  await b.unmount();
  let s = await open(MealPicker, { planId: 'p1', index: 1 });
  expect(await s.findByText('Swap breakfast')).toBeTruthy();
  await fireEvent.press(await s.findByTestId('pick-m6'));
  await waitFor(() => expect(plan()).toEqual(['m8 dinner 0 19:30', 'm6 breakfast 1 07:40', 'm5 snack 2 -']));
  await s.unmount();
  s = await open(MealPicker, { planId: 'p1', index: 1 });
  await fireEvent.press(await s.findByText('Remove breakfast'));
  await waitFor(() => expect(plan()).toEqual(['m8 dinner 0 19:30', 'm5 snack 2 -']));
  await s.unmount();
  mockDb.meals[7].archived_at = '2026-10-16T00:00:00.000Z';
  qc.clear();
  const a = await open(DayPlanBuilder, { planId: 'p1' });
  expect(await a.findByText('Archived meal. Clients see it until you swap it.')).toBeTruthy();
  expect(a.queryByLabelText(/^Open Dinner/)).toBeNull();
  expect(a.getAllByLabelText(/^Open /)).toHaveLength(2);
});

it('case 10: the time sheet opens at the stored time or the label hour; Set sends one PATCH changing only that time; No time sends null or nothing; Close, scrim and back send nothing; a failure closes it with the alert line', async () => {
  const b = await open(DayPlanBuilder, { planId: 'p1' });
  const dinner = await b.findByLabelText('7:30 pm');
  expect(dinner.props.accessibilityHint).toBe('Set the dinner time');
  expect(b.getByLabelText('Add a time').props.accessibilityHint).toBe('Set the snack time');
  await fireEvent.press(dinner);
  expect([b.getByText('Dinner time'), b.getByText('Salmon, potatoes and green beans · Foundations'), b.getByText('wheel 19:30'),
    b.getByText('Clients see this time on their own clock.'), b.getByLabelText('Set 7:30 pm')]).toBeTruthy();
  mockPick = new Date(2024, 0, 15, 18, 45);
  await fireEvent.press(b.getByTestId('time-wheel'));
  expect(b.getByLabelText('Set 6:45 pm')).toBeTruthy();
  await fireEvent.press(b.getByTestId('time-set'));
  await waitFor(() => expect(plan()).toEqual(['m8 dinner 0 18:45', 'm7 breakfast 1 07:40', 'm5 snack 2 -']));
  expect(writes()).toHaveLength(1);
  await waitFor(() => expect(b.queryByText('Dinner time')).toBeNull());
  await fireEvent.press(await b.findByLabelText('Add a time'));
  expect(b.getByText('wheel 15:30')).toBeTruthy();
  await fireEvent.press(b.getByTestId('time-none'));
  await waitFor(() => expect(b.queryByText('Snack time')).toBeNull());
  expect(writes()).toHaveLength(1);
  await fireEvent.press(await b.findByLabelText('7:40 am'));
  await fireEvent.press(b.getByTestId('time-close'));
  await fireEvent.press(await b.findByLabelText('7:40 am'));
  await fireEvent.press(b.getByTestId('time-scrim'));
  await fireEvent.press(await b.findByLabelText('7:40 am'));
  await act(async () => b.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(writes()).toHaveLength(1);
  await fireEvent.press(await b.findByLabelText('7:40 am'));
  await fireEvent.press(b.getByTestId('time-none'));
  await waitFor(() => expect(plan()).toEqual(['m8 dinner 0 18:45', 'm7 breakfast 1 -', 'm5 snack 2 -']));
  mockDb.fail['PATCH /coach/daily-meal-plans/p1'] = { message: 'Network Error', isAxiosError: true };
  await fireEvent.press(await b.findByLabelText('6:45 pm'));
  await fireEvent.press(b.getByTestId('time-set'));
  expect(await b.findByText('That did not save. Check your connection, then try again.')).toBeTruthy();
  expect([b.queryByText('Dinner time'), haptic('error').mock.calls.length]).toEqual([null, 1]);
});

it('case 10b: a stored time off the 5-minute grid is sent back unchanged when Set is tapped without moving the wheel', async () => {
  mockDb.plans[0].slots[0].time_of_day = '12:37';
  const b = await open(DayPlanBuilder, { planId: 'p1' });
  await fireEvent.press(await b.findByLabelText('12:37 pm'));
  await fireEvent.press(b.getByTestId('time-set'));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0].body.slots.map((x: Row) => x.time_of_day)).toEqual(['12:37', '07:40', null]);
});

it('case 11: Swap keeps its order and time; Add a meal keeps every time and takes the next order with none; Remove keeps the others as stored', async () => {
  mockDb.plans[0].slots = [slot('s1', 'm7', 'breakfast', 0, '07:40'), slot('s2', 'm9', 'lunch', 1, '12:35'), slot('s3', 'm8', 'dinner', 2, '19:30')];
  let s = await open(MealPicker, { planId: 'p1', index: 1 });
  await fireEvent.press(await s.findByTestId('pick-m3'));
  await waitFor(() => expect(plan()).toEqual(['m7 breakfast 0 07:40', 'm3 lunch 1 12:35', 'm8 dinner 2 19:30']));
  await s.unmount();
  s = await open(MealPicker, { planId: 'p1' });
  await fireEvent.press(await s.findByLabelText('Snack'));
  await fireEvent.press(await s.findByTestId('pick-m5'));
  await waitFor(() => expect(plan()).toEqual(['m7 breakfast 0 07:40', 'm3 lunch 1 12:35', 'm8 dinner 2 19:30', 'm5 snack 3 -']));
  await s.unmount();
  s = await open(MealPicker, { planId: 'p1', index: 0 });
  await fireEvent.press(await s.findByText('Remove breakfast'));
  await waitFor(() => expect(plan()).toEqual(['m3 lunch 1 12:35', 'm8 dinner 2 19:30', 'm5 snack 3 -']));
});

it('case 12: while a slot write is pending, and while the plan re-reads, the time lines, Swap and Add a meal are off', async () => {
  const b = await open(DayPlanBuilder, { planId: 'p1' });
  await fireEvent.press(await b.findByLabelText('7:30 pm'));
  mockDb.fail['PATCH /coach/daily-meal-plans/p1'] = 'hang';
  await fireEvent.press(b.getByTestId('time-set'));
  const off = () => [b.getByLabelText('7:40 am'), b.getByLabelText('Add a time'), ...b.getAllByLabelText(/^Swap /), b.getByTestId('plan-add')]
    .map((x) => x.props.accessibilityState?.disabled);
  await waitFor(() => expect(off()).toEqual([true, true, true, true, true, true]));
  await b.unmount();
  delete mockDb.fail['PATCH /coach/daily-meal-plans/p1'];
  qc.clear();
  const c = await open(DayPlanBuilder, { planId: 'p1' });
  await c.findByLabelText('7:40 am');
  mockDb.hold['GET /coach/daily-meal-plans/p1'] = new Promise(() => {});
  await act(async () => { void qc.invalidateQueries({ queryKey: ['daily-meal-plans', 'p1'] }); });
  const offC = () => [c.getByLabelText('7:40 am'), c.getByLabelText('Add a time'), ...c.getAllByLabelText(/^Swap /), c.getByTestId('plan-add')]
    .map((x) => x.props.accessibilityState?.disabled);
  await waitFor(() => expect(offC()).toEqual([true, true, true, true, true, true]));
});

it('case 13: at 320 pt with 130% text no text is cut, every control is at least 44 pt, the footer row and the sheet are whole', async () => {
  size(SIZES[1]);
  const all = [await editor({ mealId: 'm1' })];
  await all[0].findByText('Banana protein shake');
  await fireEvent.press(all[0].getByLabelText('More for Rice cakes, honey and whey'));
  all.push(await open(screen('MealOptionsPickerScreen'), { mealId: 'm1', mealName: 'Banana and whey shake', chosen: ['m2'] }));
  all.push(await open(screen('MealRecipePickerScreen'), { mealId: 'm1', mealName: 'Banana and whey shake', recipeId: 'r1' }));
  const b = await open(DayPlanBuilder, { planId: 'p1' });
  all.push(b);
  await fireEvent.press(await b.findByLabelText('7:30 pm'));
  await all[1].findByText('Your meals, A to Z');
  await all[2].findByText('Your recipes, newest first');
  for (const s of all) {
    expect(s.UNSAFE_queryAllByType(Text).filter((t) => t.props.numberOfLines != null)).toEqual([]);
    for (const c of [...s.queryAllByRole('button'), ...s.queryAllByRole('checkbox')]) {
      const st = StyleSheet.flatten(c.props.style) ?? {};
      const tall = Math.max(st.minHeight ?? 0, st.height ?? 0) + 2 * (c.props.hitSlop?.top ?? c.props.hitSlop ?? 0);
      if (tall < 44) throw new Error(`${c.props.accessibilityLabel} is ${tall} pt`);
    }
  }
  expect(all[0].getByTestId('meal-footer-row')).toBeTruthy();
  expect(b.getByTestId('time-sheet')).toBeTruthy();
});

it('case 15: the form survives its list (R5 latch): a stale flag, a re-read after a New meal and a failed background re-read keep the typed name, the picks and the note', async () => {
  const now = Date.now();
  qc.setQueryData(['meal-templates'], mockDb.meals.map((m) => ({ ...m })), { updatedAt: now });
  const s = await editor({ mealId: 'm1' });
  await fireEvent.changeText(await s.findByLabelText('Name'), 'Banana shake');
  await fireEvent.changeText(s.getByLabelText('Your note, clients see it'), 'Before you train.');
  await rerenderEditor(s, { mealId: 'm1', picked: { options: ['m2', 'm3', 'm4', 'm6'], at: 1 } });
  const kept = () => [s.getByLabelText('Name').props.value, s.getByLabelText('Your note, clients see it').props.value, s.getByText('4 of 10') && 4,
    s.queryByLabelText('Loading the meal'), s.queryByText('This meal didn’t load.')];
  const want = ['Banana shake', 'Before you train.', 4, null, null];
  // (b) five minutes of typing: the list goes stale on its own, with no re-read.
  jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);
  await rerenderEditor(s, { mealId: 'm1', picked: { options: ['m2', 'm3', 'm4', 'm6'], at: 1 } });
  expect(qc.getQueryCache().find({ queryKey: ['meal-templates'] })?.isStale()).toBe(true);
  expect(kept()).toEqual(want);
  // (a) a New meal saved inside the picker invalidates ['meal-templates']; the list re-reads under the editor.
  let release = () => {};
  mockDb.hold['GET /coach/meal-templates'] = new Promise<void>((r) => { release = r; });
  await act(async () => { void qc.invalidateQueries({ queryKey: ['meal-templates'] }); });
  expect(kept()).toEqual(want);
  await act(async () => release());
  expect(kept()).toEqual(want);
  // (c) a background re-read fails.
  delete mockDb.hold['GET /coach/meal-templates'];
  mockDb.fail['GET /coach/meal-templates'] = { message: 'Network Error', isAxiosError: true };
  await act(async () => { await qc.refetchQueries({ queryKey: ['meal-templates'] }).catch(() => {}); });
  expect(qc.getQueryState(['meal-templates'])?.status).toBe('error');
  expect(kept()).toEqual(want);
});
