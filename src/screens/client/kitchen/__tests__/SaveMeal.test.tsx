/**
 * SAVED-MEAL-SAVE-M: "Save a meal from today" on the Kitchen page (Style 2 Menu, frames S2_page, S2_empty, S2_save on
 * ctx#610). The real Kitchen screen mounts with the API mocked at its edge, at 390 x 844 with the phone's text at 100
 * percent and at 320 x 568 at 130 percent. Each test sets every switch it could read. The clock is set once per test
 * (a system time only; react-query's and waitFor's timers stay real); every logged_at is built from local clock parts,
 * so "12:35 pm" holds in any time zone. The test's QueryClient keeps the app's 30 s freshness and has no retries. A
 * lost answer is a rejection with no response. Fixtures fictional (client Jordan, coach Sam); today is 2026-10-13.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { AccessibilityInfo, Keyboard, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

let mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...jest.requireActual('../../../../constants/colors').default } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, { ...props }) };
});
jest.mock('../../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
const mockListeners: Record<string, Array<() => void>> = {};
const mockParent = { navigate: jest.fn() };
const mockNav = {
  navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn(() => mockParent),
  addListener: jest.fn((event: string, cb: () => void) => { (mockListeners[event] ??= []).push(cb); return () => undefined; }),
};
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: new Proxy({}, { get: (_t, key: string) => mockFlags[key] ?? false }),
}));
let mockUser: { id: string; coach_id?: string | null } = { id: 'jordan', coach_id: 'sam' };
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  ...jest.requireActual('../../../../hooks/useNetworkStatus'), useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-13' }));
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), patch: (...a: unknown[]) => mockPatch(...a),
    delete: (...a: unknown[]) => mockDelete(...a) },
  logApi: { getDaily: (date: string) => mockGet('/log/daily', date) },
  recipesApi: { list: () => mockGet('/recipes') },
  listsApi: { getList: (type: string) => mockGet(`/lists/${type}`) },
}));
jest.mock('../../../../api/mealTemplatesApi', () => ({ mealTemplatesApi: { todayForClient: (d: string) => mockGet('/me/meal-plan/today', d) } }));
const mockHaptics: Record<string, jest.Mock> = {};
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: (_t, key: string) => (mockHaptics[key] ??= jest.fn(async () => undefined)) }),
}));
jest.mock('../../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'jordan' }) }));
const mockStore = { selectedDate: '2026-10-13', setSelectedDate: jest.fn(), refreshShownDay: jest.fn() };
jest.mock('../../../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockStore, { getState: () => mockStore }) }));
const mockEnqueue = jest.fn();
jest.mock('../../../../services/foodLogQueue', () => ({ ...jest.requireActual('../../../../services/foodLogQueue'), enqueue: (...a: unknown[]) => mockEnqueue(...a) }));

import KitchenScreen from '../KitchenScreen';

const SRC = path.resolve(__dirname, '..', '..', '..', '..');

// ---------- fixtures (fictional: client Jordan, coach Sam) ----------
const at = (h: number, m: number) => new Date(2026, 9, 13, h, m).toISOString();
let k = 0;
const entry = (meal: string, h: number, min: number, name: string, kcal: number, protein: number, m: number,
  qty: number | null = null, unit: string | null = null) => {
  k += 1;
  return { id: `e${k}`, food_item_id: `f${k}`, user_id: 'jordan', meal_type: meal, quantity_multiplier: m,
    original_quantity: qty, original_unit: unit, logged_at: at(h, min), created_at: at(h, min),
    food_item: { id: `f${k}`, name, calories: kcal, protein_g: protein, carbs_g: 0, fat_g: 0 } };
};
function DAY() {
  k = 0;
  return { date: '2026-10-13', entries: [
    entry('breakfast', 7, 40, 'Greek yoghurt, plain', 59, 10, 2.0, 200, 'g'),
    entry('breakfast', 7, 40, 'Rolled oats', 379, 13.2, 0.5, 50, 'g'),
    entry('breakfast', 7, 40, 'Blueberries', 57, 0.7, 0.8, 80, 'g'),
    entry('snack', 10, 15, 'Flat white', 110, 6, 1.0, 1, 'cup'),
    entry('lunch', 12, 35, 'Chicken breast, grilled', 165, 31, 1.5, 150, 'g'),
    entry('lunch', 12, 35, 'Rice, cooked', 130, 1.7, 1.8, 180, 'g'),
    entry('lunch', 12, 35, 'Avocado', 120, 1, 1.0),
  ] };
}
const LUNCH_BODY = { name: 'Chicken breast, Rice and Avocado', items: [
  { food_item_id: 'f5', quantity_multiplier: 1.5, original_quantity: 150, original_unit: 'g' },
  { food_item_id: 'f6', quantity_multiplier: 1.8, original_quantity: 180, original_unit: 'g' },
  { food_item_id: 'f7', quantity_multiplier: 1 },
] };
const savedItem = (meal: string, food: string, m: number, i: number) => ({ id: `${meal}-i${i}`, saved_meal_id: meal, food_item_id: food,
  quantity_multiplier: m, position: i, food_truth: 'ok', food_item: { id: food, name: food, calories: 100, protein_g: 5 } });
const saved = (id: string, name: string, items = [savedItem(id, 'fx', 1, 0)]) =>
  ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', items });
const MEALS = () => [saved('m1', 'Usual breakfast'), saved('m2', 'Post-gym shake'), saved('m3', 'Friday wrap')];
const WRITTEN = (id = 'm9') => saved(id, LUNCH_BODY.name, LUNCH_BODY.items.map((it, i) => savedItem(id, it.food_item_id, it.quantity_multiplier, i)));
/** The server writes the meal: its list holds it first from then on. */
const writes = (meal = WRITTEN()) => () => { server[LIST] = [meal, ...MEALS()]; return ok(meal); };

type Answer = unknown | (() => unknown);
let server: Record<string, Answer>;
const refusal = (status: number, message = '', code?: string) =>
  Object.assign(new Error(message), { response: { status, data: { statusCode: status, message, ...(code ? { code } : {}) } } });
const lost = () => Promise.reject(new Error('Network Error'));
const ok = (data: unknown) => Promise.resolve({ data });
function answer(url: string) {
  const a = server[url];
  if (typeof a === 'function') return (a as () => unknown)();
  return a === undefined ? Promise.reject(refusal(500)) : ok(a);
}
const reads = (url: string) => mockGet.mock.calls.filter((c) => c[0] === url).length;
const LIST = '/me/foods/saved-meals';

function setClock(h: number, m: number) {
  jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  jest.setSystemTime(new Date(2026, 9, 13, h, m));
}
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 30_000 }, mutations: { gcTime: Infinity } } });
  await render(<QueryClientProvider client={client}><KitchenScreen /></QueryClientProvider>);
  await screen.findByTestId('kitchen-log-food');
  await waitFor(() => expect(screen.queryByTestId('kitchen-loading')).toBeNull());
  return client;
}
const way = () => screen.getByTestId('kitchen-save-way');
async function openSave() {
  await fireEvent.press(await screen.findByTestId('kitchen-save-way'));
  return screen.getByTestId('kitchen-save-sheet');
}
const loaded = () => screen.findByTestId('save-food-e5');
const submit = () => screen.getByTestId('save-submit');
const pressSave = async () => { await fireEvent.press(submit()); };
const label = (node: { props: Record<string, unknown> }) => {
  const texts: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === 'string') texts.push(n);
    else if (n && typeof n === 'object' && 'children' in (n as object)) ((n as { children: unknown[] }).children ?? []).forEach(walk);
  };
  walk(node);
  return texts.join('');
};
const announced = () => (AccessibilityInfo.announceForAccessibility as jest.Mock).mock.calls.map((c) => c[0]);
const ticked = (id: string) => screen.getByTestId(`save-food-${id}`).props.accessibilityState?.checked;
const pending = <T,>() => { let settle: (v: T) => void = () => undefined; let fail: (e: unknown) => void = () => undefined;
  const p = new Promise<T>((res, rej) => { settle = res; fail = rej; }); return { p, settle, fail }; };

beforeEach(() => {
  jest.useRealTimers();
  setClock(13, 5);
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  Object.assign(mockFlags, { youTabV2: true, foodPlanChecklist: true, clientTimelineV2: true, clientPathCopilot: true, romanChat: true });
  mockUser = { id: 'jordan', coach_id: null };
  (NetInfo as unknown as { __reset: () => void }).__reset();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockGet.mockReset().mockImplementation((url: string) => answer(url));
  [mockPost, mockPatch, mockDelete].forEach((f) => f.mockReset());
  [mockNav.navigate, mockParent.navigate, mockEnqueue].forEach((f) => f.mockClear());
  Object.values(mockHaptics).forEach((f) => f.mockClear());
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
  server = {
    [LIST]: MEALS(), '/lists/grocery': [], '/lists/shopping': [], '/recipes': [], '/log/daily': DAY(),
    '/me/meal-plan/today': { date: '2026-10-13', assignments: [] }, '/v1/clients/me/coach': { name: 'Sam Rivera' },
  };
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('SAVED-MEAL-SAVE-M: Save a meal from today (Style 2 Menu)', () => {
  it('1. the way in: last row of Your meals with KS-2; none while loading or failed with nothing cached; kept on a failed refresh; no KS-2 at 100; reads today on every open', async () => {
    let release: (v: unknown) => void = () => undefined;
    server[LIST] = () => new Promise((res) => { release = res; });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 30_000 }, mutations: { gcTime: Infinity } } });
    await render(<QueryClientProvider client={client}><KitchenScreen /></QueryClientProvider>);
    await screen.findByTestId('kitchen-loading');
    expect(screen.queryByTestId('kitchen-save-way')).toBeNull();
    await act(async () => { release({ data: MEALS() }); });
    const row = await screen.findByTestId('kitchen-save-way');
    expect(within(screen.getByTestId('kitchen-meals')).getByTestId('kitchen-save-way')).toBe(row);
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('Save a meal from today');
    expect(row.props.accessibilityHint).toBe("Opens today's foods to save as a meal");
    // A coachless page open makes no /log/daily read (KITCHEN-M's case 9); opening the sheet reads today and nothing else.
    expect(reads('/log/daily')).toBe(0);
    const before = mockGet.mock.calls.length;
    await fireEvent.press(row);
    expect(screen.getByTestId('kitchen-save-sheet')).toBeTruthy();
    expect(within(screen.getByTestId('kitchen-save-sheet')).getByText('Save a meal from today')).toBeTruthy();
    await loaded();
    expect(mockGet.mock.calls.slice(before)).toEqual([['/log/daily', '2026-10-13']]);
    // Again within 30 s, after a food reached the day elsewhere: read again, and the new food is there.
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    const day = DAY();
    day.entries.push(entry('snack', 13, 0, 'Apple', 52, 0.3, 1));
    server['/log/daily'] = day;
    await fireEvent.press(way());
    expect(await screen.findByTestId('save-food-e8')).toBeTruthy();
    expect(reads('/log/daily')).toBe(2);
    // A refresh that fails over cached meals keeps the way in.
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    server[LIST] = () => Promise.reject(refusal(500));
    await act(async () => { await client.refetchQueries({ queryKey: ['me', 'foods', 'saved-meals'] }); });
    expect(way()).toBeTruthy();
  });

  it('1b. no way in when the meals read failed with nothing cached; with 100 meals it keeps its label and drops KS-2', async () => {
    server[LIST] = () => Promise.reject(refusal(500));
    await mount();
    await screen.findByTestId('kitchen-error');
    expect(screen.queryByTestId('kitchen-save-way')).toBeNull();
    await act(async () => { server[LIST] = Array.from({ length: 100 }, (_, i) => saved(`h${i}`, `Meal ${i}`)); });
    await fireEvent.press(screen.getByTestId('kitchen-retry'));
    const row = await screen.findByTestId('kitchen-save-way');
    expect(row.props.accessibilityLabel).toBe('Save a meal from today');
    expect(row.props.accessibilityHint).toBeUndefined();
  });

  it('2 and 17. the sheet: groups newest first with their times, lunch ticked, the button counts the picks, the default name', async () => {
    await mount();
    const sheet = await openSave();
    await loaded();
    expect(within(sheet).getByText('Tick the foods that belong together.')).toBeTruthy();
    const titles = within(sheet).getAllByTestId(/^save-group-/).map(label);
    expect(titles).toEqual(['Lunch, 12:35 pm', 'Snacks, 10:15 am', 'Breakfast, 7:40 am']);
    expect(['e5', 'e6', 'e7'].map(ticked)).toEqual([true, true, true]);
    expect(['e1', 'e2', 'e3', 'e4'].map(ticked)).toEqual([false, false, false, false]);
    const chicken = screen.getByTestId('save-food-e5');
    expect(chicken.props.accessibilityRole).toBe('checkbox');
    expect(within(chicken).getByText('Chicken breast, grilled')).toBeTruthy();
    expect(within(chicken).getByText('150 g')).toBeTruthy();
    expect(within(chicken).getByText('248')).toBeTruthy();
    expect(within(screen.getByTestId('save-food-e7')).getByText('1 serving')).toBeTruthy();
    expect(label(submit())).toBe('Save 3 foods as a meal');
    expect(screen.getByTestId('save-name').props.value).toBe('Chicken breast, Rice and Avocado');
    expect(screen.getByTestId('save-name').props.accessibilityLabel).toBe('Name of this meal');
    expect(screen.getByTestId('save-name').props.maxLength).toBe(80);
    // 17: Flat white ticked: four foods, the name follows, the body sends the day's order.
    await fireEvent.press(screen.getByTestId('save-food-e4'));
    expect(label(submit())).toBe('Save 4 foods as a meal');
    expect(screen.getByTestId('save-name').props.value).toBe('Flat white, Chicken breast, Rice and 1 more');
    mockPost.mockImplementation(() => ok(WRITTEN()));
    await pressSave();
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][1].items.map((i: { food_item_id: string }) => i.food_item_id)).toEqual(['f4', 'f5', 'f6', 'f7']);
    await waitFor(() => expect(screen.queryByTestId('kitchen-save-sheet')).toBeNull());
  });

  it('17b. unticking every food disables "Save as a meal"; one food reads "Save 1 food as a meal"', async () => {
    await mount();
    await openSave();
    await loaded();
    await fireEvent.press(screen.getByTestId('save-food-e5'));
    await fireEvent.press(screen.getByTestId('save-food-e6'));
    expect(label(submit())).toBe('Save 1 food as a meal');
    await fireEvent.press(screen.getByTestId('save-food-e7'));
    expect(label(submit())).toBe('Save as a meal');
    expect(submit().props.accessibilityState.disabled).toBe(true);
  });

  it('3. the save: one POST with exactly the body; on 201 the sheet closes, the meal is first, the list is read again, KS-7 once, one success haptic', async () => {
    await mount();
    await openSave();
    await loaded();
    const listReads = reads(LIST);
    mockPost.mockImplementation(writes());
    await pressSave();
    await waitFor(() => expect(screen.queryByTestId('kitchen-save-sheet')).toBeNull());
    expect(mockPost.mock.calls).toEqual([[LIST, LUNCH_BODY]]);
    expect(screen.getAllByTestId(/^kitchen-meal-/)[0].props.testID).toBe('kitchen-meal-m9');
    await waitFor(() => expect(reads(LIST)).toBe(listReads + 1));
    expect(announced().filter((w) => w === 'Saved Chicken breast, Rice and Avocado to your meals.')).toHaveLength(1);
    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
  });

  it('3b. the sheet closed while the POST is pending: the answer still puts the meal first', async () => {
    await mount();
    await openSave();
    await loaded();
    const wait = pending<{ data: unknown }>();
    mockPost.mockImplementation(() => wait.p);
    await pressSave();
    await fireEvent.press(screen.getByTestId('kitchen-sheet-scrim', { includeHiddenElements: true }));
    expect(screen.queryByTestId('kitchen-save-sheet')).toBeNull();
    server[LIST] = [WRITTEN(), ...MEALS()];
    await act(async () => { wait.settle({ data: WRITTEN() }); });
    await waitFor(() => expect(screen.getAllByTestId(/^kitchen-meal-/)[0].props.testID).toBe('kitchen-meal-m9'));
  });

  it('3c. closed while the POST is pending and opened again: the first answer puts its meal first and leaves the new sheet open as she left it (KITCHEN-M C2 class)', async () => {
    const client = await mount();
    await openSave();
    await loaded();
    const wait = pending<{ data: unknown }>();
    mockPost.mockImplementationOnce(() => wait.p);
    await pressSave();
    await fireEvent.press(screen.getByTestId('kitchen-sheet-scrim', { includeHiddenElements: true }));
    expect(screen.queryByTestId('kitchen-save-sheet')).toBeNull();
    await openSave();
    await loaded();
    await fireEvent.changeText(screen.getByTestId('save-name'), 'Second lunch');
    server[LIST] = [WRITTEN(), ...MEALS()];
    await act(async () => { wait.settle({ data: WRITTEN() }); });
    await waitFor(() => expect((client.getQueryData(['me', 'foods', 'saved-meals']) as { id: string }[])[0].id).toBe('m9'));
    // The answer belongs to the sheet that sent it, which is gone: the sheet she opened since stays open with her name.
    expect(screen.getByTestId('kitchen-save-sheet')).toBeTruthy();
    expect(screen.getByTestId('save-name').props.value).toBe('Second lunch');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('4. the name (R5): a typed name survives a pick change, a failed save and Try again; spaces disable Save; what is sent is trimmed', async () => {
    await mount();
    await openSave();
    await loaded();
    await fireEvent.changeText(screen.getByTestId('save-name'), '  Big lunch  ');
    await fireEvent.press(screen.getByTestId('save-food-e4'));
    expect(screen.getByTestId('save-name').props.value).toBe('  Big lunch  ');
    mockPost.mockImplementationOnce(lost);
    await pressSave();
    await screen.findByText('This meal was not saved. Check the connection and try again.');
    expect(screen.getByTestId('save-name').props.value).toBe('  Big lunch  ');
    expect(ticked('e4')).toBe(true);
    mockPost.mockImplementation(() => ok(saved('m9', 'Big lunch')));
    await fireEvent.press(screen.getByTestId('save-submit'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(mockPost.mock.calls[1][1].name).toBe('Big lunch');
  });

  it('4b. a name of spaces disables Save; a long default is cut at a word end to 80 or fewer', async () => {
    k = 40;
    server['/log/daily'] = { entries: [entry('dinner', 12, 50, 'Wholegrain sourdough toast with extra seeds', 200, 8, 1),
      entry('dinner', 12, 50, 'Smoked salmon and cream cheese spread', 200, 8, 1), entry('dinner', 12, 50, 'Cucumber', 10, 0, 1)] };
    await mount();
    await openSave();
    await screen.findByTestId('save-food-e41');
    const name = screen.getByTestId('save-name').props.value as string;
    expect(name).toBe('Wholegrain sourdough toast with extra seeds, Smoked salmon and cream cheese');
    expect(name.length).toBeLessThanOrEqual(80);
    await fireEvent.changeText(screen.getByTestId('save-name'), '    ');
    expect(submit().props.accessibilityState.disabled).toBe(true);
  });

  it('5. the guard (R6): no answer shows KS-3; the list is read again at once; Try again reads it first; the meal there means no second POST', async () => {
    await mount();
    await openSave();
    await loaded();
    const listReads = reads(LIST);
    mockPost.mockImplementation(lost);
    await pressSave();
    await screen.findByText('This meal was not saved. Check the connection and try again.');
    expect(label(submit())).toBe('Try again');
    await waitFor(() => expect(reads(LIST)).toBe(listReads + 1)); // the background re-read
    server[LIST] = [WRITTEN(), ...MEALS()];
    await fireEvent.press(submit());
    await waitFor(() => expect(screen.queryByTestId('kitchen-save-sheet')).toBeNull());
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(reads(LIST)).toBeGreaterThanOrEqual(listReads + 2);
    expect(screen.getAllByTestId(/^kitchen-meal-/)[0].props.testID).toBe('kitchen-meal-m9');
    expect(announced()).toContain('Saved Chicken breast, Rice and Avocado to your meals.');
  });

  it('5b. no answer and the meal is not on the list: exactly one second POST; a 500 behaves the same', async () => {
    await mount();
    await openSave();
    await loaded();
    mockPost.mockImplementationOnce(() => Promise.reject(refusal(500))).mockImplementationOnce(lost)
      .mockImplementation(writes());
    await pressSave();
    await screen.findByText('This meal was not saved. Check the connection and try again.');
    await fireEvent.press(submit());
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    await screen.findByText('This meal was not saved. Check the connection and try again.');
    await fireEvent.press(submit());
    await waitFor(() => expect(screen.queryByTestId('kitchen-save-sheet')).toBeNull());
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it('5c. two fast taps send one POST; closing after a lost answer leaves the page showing a meal the server wrote', async () => {
    await mount();
    await openSave();
    await loaded();
    const wait = pending<{ data: unknown }>();
    mockPost.mockImplementationOnce(() => wait.p);
    await act(async () => { fireEvent.press(submit()); fireEvent.press(submit()); });
    expect(mockPost).toHaveBeenCalledTimes(1);
    server[LIST] = [WRITTEN(), ...MEALS()];
    await act(async () => { wait.fail(new Error('Network Error')); });
    await screen.findByText('This meal was not saved. Check the connection and try again.');
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    await waitFor(() => expect(screen.getAllByTestId(/^kitchen-meal-/)[0].props.testID).toBe('kitchen-meal-m9'));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('6. refusals: Food not found shows KS-4 and keeps picks and name; 409 SAVED_MEALS_LIMIT shows KM-25 and reads again; a 400 shows KS-19', async () => {
    await mount();
    await openSave();
    await loaded();
    mockPost.mockImplementationOnce(() => Promise.reject(refusal(404, 'Food not found')));
    await pressSave();
    await screen.findByText('A food you picked can no longer be saved, so this meal was not saved.');
    expect(screen.getByTestId('kitchen-save-sheet')).toBeTruthy();
    expect(['e5', 'e6', 'e7'].map(ticked)).toEqual([true, true, true]);
    expect(screen.getByTestId('save-name').props.value).toBe('Chicken breast, Rice and Avocado');
    mockPost.mockImplementationOnce(() => Promise.reject(refusal(400, 'name must be shorter')));
    await pressSave();
    await screen.findByText('This meal was not saved.');
    const listReads = reads(LIST);
    mockPost.mockImplementationOnce(() => Promise.reject(refusal(409, 'You can save up to 100 meals', 'SAVED_MEALS_LIMIT')));
    await pressSave();
    await screen.findByText('You have 100 saved meals, the most there can be. Delete one to save another.');
    expect(screen.queryByTestId('save-submit')).toBeNull();
    await waitFor(() => expect(reads(LIST)).toBe(listReads + 1));
  });

  it('6b. offline: KS-5, the api is never called and nothing is stored', async () => {
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    await mount();
    await openSave();
    await loaded();
    (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false, isInternetReachable: false });
    await pressSave();
    await screen.findByText('Saving a meal needs a connection. Nothing was saved.');
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('kitchen-save-sheet')).toBeTruthy();
  });

  it('7. the limit from the cache: 100 meals show KM-25 with no Save; 99 show the normal sheet', async () => {
    server[LIST] = Array.from({ length: 100 }, (_, i) => saved(`h${i}`, `Meal ${i}`));
    await mount();
    await openSave();
    expect(await screen.findByText('You have 100 saved meals, the most there can be. Delete one to save another.')).toBeTruthy();
    expect(screen.queryByTestId('save-submit')).toBeNull();
    expect(screen.queryByTestId('save-food-e5')).toBeNull();
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
  });

  it('7b. 99 meals: the normal sheet', async () => {
    server[LIST] = Array.from({ length: 99 }, (_, i) => saved(`h${i}`, `Meal ${i}`));
    await mount();
    await openSave();
    await loaded();
    expect(submit()).toBeTruthy();
  });

  it('8. SS4 and SS5: nothing today shows KS-1 and no Save; a failed read shows KS-9 and Try again; loading reads KS-8 once; never KS-1 from a failed read', async () => {
    server['/log/daily'] = { date: '2026-10-13', entries: [] };
    await mount();
    await openSave();
    expect(await screen.findByText('No foods from today to save yet. Foods you log on the Food tab show here once they are sent.')).toBeTruthy();
    expect(screen.queryByTestId('save-submit')).toBeNull();
    expect(screen.queryByTestId('save-name')).toBeNull();
  });

  it('8b. a failed today read with nothing cached: KS-9 and Try again, which reads again; {} and a string read as failed', async () => {
    let release: (v: unknown) => void = () => undefined;
    server['/log/daily'] = () => new Promise((res) => { release = res; });
    await mount();
    await openSave();
    expect(await screen.findByTestId('save-loading')).toBeTruthy();
    expect(screen.getAllByLabelText("Loading today's foods")).toHaveLength(1);
    await act(async () => { release({ data: {} }); });
    expect(await screen.findByText("Couldn't load today's foods")).toBeTruthy();
    expect(screen.queryByText(/No foods from today/)).toBeNull();
    server['/log/daily'] = 'nope';
    const before = reads('/log/daily');
    await fireEvent.press(screen.getByTestId('save-retry'));
    await waitFor(() => expect(reads('/log/daily')).toBe(before + 1));
    expect(await screen.findByText("Couldn't load today's foods")).toBeTruthy();
    server['/log/daily'] = () => Promise.reject(refusal(500));
    await fireEvent.press(screen.getByTestId('save-retry'));
    await waitFor(() => expect(reads('/log/daily')).toBe(before + 2));
    expect(screen.queryByText(/No foods from today/)).toBeNull();
    server['/log/daily'] = DAY();
    await fireEvent.press(screen.getByTestId('save-retry'));
    expect(await screen.findByTestId('save-food-e5')).toBeTruthy();
  });

  it('9. SS8: 31 picked foods disable Save with KS-6; an entry at multiplier 60 cannot be ticked and shows KS-17', async () => {
    k = 100;
    server['/log/daily'] = { entries: [...Array.from({ length: 31 }, (_, i) => entry('lunch', 12, 30, `Food ${i}`, 10, 1, 1)),
      entry('dinner', 12, 40, 'Old row', 100, 1, 60)] };
    await mount();
    await openSave();
    await screen.findByTestId('save-food-e132');
    const old = screen.getByTestId('save-food-e132');
    expect(old.props.accessibilityState).toEqual(expect.objectContaining({ checked: false, disabled: true }));
    expect(within(old).getByText("Can't be saved in a meal")).toBeTruthy();
    await fireEvent.press(old);
    expect(ticked('e132')).toBe(false);
    await waitFor(() => expect(ticked('e101')).toBe(false));
    // Dinner (the newest group) holds only the row that cannot be saved; tick the 31 lunch foods.
    for (let i = 101; i <= 131; i += 1) await fireEvent.press(screen.getByTestId(`save-food-e${i}`));
    expect(screen.getByText('A saved meal holds up to 30 foods. Untick 1 to save it.')).toBeTruthy();
    expect(submit().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('save-food-e131'));
    expect(screen.queryByText(/holds up to 30 foods/)).toBeNull();
    expect(submit().props.accessibilityState.disabled).toBe(false);
  });

  it('13. SS9: with the keyboard up at 320 x 568 and 130%, the Name field and Save stay in the pinned foot inside the visible window', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    const kb: Record<string, Array<(e: unknown) => void>> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: (e: unknown) => void) => {
      (kb[event] ??= []).push(fn);
      return { remove: jest.fn() };
    }) as never);
    try {
      mockDims = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
      await mount();
      await openSave();
      await loaded();
      const avoider = screen.getByTestId('kitchen-sheet-avoider');
      const frame = fs.readFileSync(path.join(SRC, 'screens', 'client', 'kitchen', 'SavedMealSheet.tsx'), 'utf8');
      expect(frame).toMatch(/<KeyboardAvoidingView behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\} style=\{s\.avoid\}/);
      expect(StyleSheet.flatten(avoider.props.style).justifyContent).toBe('flex-end');
      const foot = screen.getByTestId('kitchen-sheet-foot');
      expect(within(foot).getByTestId('save-name')).toBeTruthy();
      expect(within(foot).getByTestId('save-submit')).toBeTruthy();
      expect(within(screen.getByTestId('kitchen-sheet-body')).queryByTestId('save-name')).toBeNull();
      const KEYBOARD = 260; // the iOS keyboard with its suggestion bar at 320 pt
      await act(async () => { [...(kb.keyboardWillShow ?? []), ...(kb.keyboardDidShow ?? [])].forEach((fn) => fn({ endCoordinates: { height: KEYBOARD } })); });
      const sheet = StyleSheet.flatten(screen.getByTestId('kitchen-save-sheet').props.style);
      const windowLeft = 568 - KEYBOARD;
      expect(sheet.maxHeight).toBeLessThanOrEqual(windowLeft);
      expect(StyleSheet.flatten(screen.getByTestId('kitchen-sheet-body').props.style).flexShrink).toBeGreaterThanOrEqual(1);
      // The fixed parts, measured from their styles at 130 percent: the header (grab, a two-line title) and the foot.
      const st = (id: string) => StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style) as Record<string, number>;
      const text = (id: string, lines = 1) => { const t = st(id); return lines * t.lineHeight * 1.3 + (t.paddingTop ?? 0) + (t.marginTop ?? 0) + (t.marginBottom ?? 0); };
      const grab = st('kitchen-sheet-grab');
      const header = sheet.paddingTop + grab.height + grab.marginBottom + text('kitchen-sheet-title', 2);
      const f = st('kitchen-sheet-foot');
      const field = st('save-name');
      const fieldH = Math.max(field.minHeight ?? 0, field.lineHeight * 1.3 + (field.paddingVertical ?? 0) * 2);
      const button = Math.max(st('save-submit').minHeight ?? 0, 54) + (st('save-submit-wrap').marginTop ?? 0);
      const footH = (f.paddingTop ?? 0) + text('save-name-label') + fieldH + button + sheet.paddingBottom;
      expect(header + footH).toBeLessThanOrEqual(windowLeft);
      // Return puts the keyboard down and does not save.
      await fireEvent(screen.getByTestId('save-name'), 'submitEditing');
      expect(mockPost).not.toHaveBeenCalled();
      expect(screen.getByTestId('save-name').props.returnKeyType).toBe('done');
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
    }
  });

  it('14. 320 x 568 at 130%: no text of this PR capped by numberOfLines; every control at least 44 pt', async () => {
    mockDims = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    await mount();
    expect(StyleSheet.flatten(way().props.style).minHeight).toBeGreaterThanOrEqual(44);
    await openSave();
    await loaded();
    type JsonNode = { type: string; props: Record<string, unknown>; children: Array<JsonNode | string> | null };
    const nodes: JsonNode[] = [];
    const walk = (node: JsonNode | JsonNode[] | string | null) => {
      if (!node || typeof node === 'string') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      nodes.push(node);
      (node.children ?? []).forEach(walk);
    };
    walk(screen.toJSON() as JsonNode | JsonNode[] | null);
    const capped = nodes.filter((n) => n.type === 'Text' && n.props.numberOfLines != null).map((n) => [n.children?.join(''), n.props.numberOfLines]);
    // Only main's PrimaryButton sets numberOfLines; every one asks it to wrap to two lines.
    expect(capped).toEqual([['Log food', 2], ['Save 3 foods as a meal', 2]]);
    const controls = nodes.filter((n) => ['button', 'checkbox', 'radio'].includes(n.props.accessibilityRole as string));
    const small = controls.map((c) => {
      const s = (StyleSheet.flatten(c.props.style as never) ?? {}) as { minHeight?: number; height?: number };
      return [c.props.accessibilityLabel, Math.max(s.minHeight ?? 0, s.height ?? 0)] as const;
    }).filter(([, size]) => size < 44);
    expect(small).toEqual([]);
  });

  it('15. guards: no colour literal, no pale green name, no heavy weight, no note marker, no first person in the new files', () => {
    for (const f of ['screens/client/kitchen/saveMeal.ts', 'screens/client/kitchen/SaveMealSheet.tsx', 'screens/client/kitchen/useSavedMealWrites.ts']) {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8');
      expect(src).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/);
      expect(src).not.toMatch(/surface\.sage|sageLine/);
      expect(src).not.toMatch(/fontWeight: '(700|800)'/);
      expect(src).not.toMatch(new RegExp(['TO', 'DO|FIX', 'ME|X', 'XX'].join('')));
      expect(src).not.toMatch(/console\.(error|log|warn)\(/); // W4: nothing of her meal reaches a log
    }
  });

  it('16. the Save row closes the empty group too and opens the sheet', async () => {
    server[LIST] = [];
    await mount();
    const empty = await screen.findByTestId('kitchen-empty');
    expect(empty).toBeTruthy();
    expect(within(screen.getByTestId('kitchen-meals')).getByTestId('kitchen-save-way')).toBeTruthy();
    await openSave();
    expect(await screen.findByTestId('save-food-e5')).toBeTruthy();
  });

  it('19. Style 2 (S2_save at 320 pt, 130%): a fade marks a list that scrolls, over its last visible row above the pinned foot; none when it fits or at its end', async () => {
    mockDims = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    await mount();
    await openSave();
    await loaded();
    const body = screen.getByTestId('kitchen-sheet-body');
    // The list fits: no fade.
    const ev = (nativeEvent: object) => ({ nativeEvent, persist: () => undefined });
    await fireEvent(body, 'layout', ev({ layout: { x: 0, y: 0, width: 288, height: 300 } }));
    await fireEvent(body, 'contentSizeChange', 288, 280);
    expect(screen.queryByTestId('kitchen-sheet-fade', { includeHiddenElements: true })).toBeNull();
    // More below than the window shows: the fade sits between the list and the foot, and takes no touch.
    await fireEvent(body, 'contentSizeChange', 288, 900);
    const fade = screen.getByTestId('kitchen-sheet-fade', { includeHiddenElements: true });
    expect(fade.props.pointerEvents).toBe('none');
    // Scrolled to its end: nothing more below, no fade.
    await fireEvent.scroll(body, ev({ contentOffset: { x: 0, y: 600 }, contentSize: { width: 288, height: 900 },
      layoutMeasurement: { width: 288, height: 300 } }));
    expect(screen.queryByTestId('kitchen-sheet-fade', { includeHiddenElements: true })).toBeNull();
    // The meal sheet's add body has no foot: never a fade there.
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    await fireEvent.press(await screen.findByTestId('kitchen-meal-m1'));
    expect(screen.queryByTestId('kitchen-sheet-fade', { includeHiddenElements: true })).toBeNull();
  });
});
