/**
 * KITCHEN-M: the Kitchen page in the owner's picked Style 2 Menu (PICK #ALM-P2, #ALM-E26; frames S2_* on ctx#610), with
 * the owner's "Log food" button, and its coachless version. The real screen mounts with the API mocked at its edge
 * (services/api, mealTemplatesApi), at 390 x 844 with the phone's text at 100 percent and at 320 x 568 at 130 percent.
 * Each test sets every switch it could read, so it passes in the required run and in "All switches on" alike. The clock
 * is set once per test (a system time only; react-query's and waitFor's timers stay real). Fixtures are fictional
 * (client Jordan, coach Sam); today is Tuesday 2026-10-13.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
let mockNet = { isOnline: true, isInternetReachable: true as boolean | null };
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  ...jest.requireActual('../../../../hooks/useNetworkStatus'), useNetworkStatus: () => mockNet,
}));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-13' }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  logApi: { getDaily: (date: string) => mockGet('/log/daily', date) },
  recipesApi: { list: () => mockGet('/recipes') },
  listsApi: { getList: (type: string) => mockGet(`/lists/${type}`) },
}));
jest.mock('../../../../api/mealTemplatesApi', () => ({ mealTemplatesApi: { todayForClient: (d: string) => mockGet('/me/meal-plan/today', d) } }));
const mockHaptics: Record<string, jest.Mock> = {};
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: (_t, key: string) => (mockHaptics[key] ??= jest.fn(async () => undefined)) }),
}));
const mockTrack = jest.fn();
jest.mock('../../../../lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));
const mockInvalidate = jest.fn();
jest.mock('../../../../services/queryClient', () => ({ queryClient: { invalidateQueries: (...a: unknown[]) => mockInvalidate(...a) } }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'jordan' }) }));
const mockStore = { selectedDate: '2026-10-13', setSelectedDate: jest.fn(), refreshShownDay: jest.fn() };
jest.mock('../../../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockStore, { getState: () => mockStore }) }));
const mockEnqueue = jest.fn();
jest.mock('../../../../services/foodLogQueue', () => ({ ...jest.requireActual('../../../../services/foodLogQueue'), enqueue: (...a: unknown[]) => mockEnqueue(...a) }));

import { forgetSaveKeys } from '../../../../utils/log/saveKey';
import KitchenScreen from '../KitchenScreen';
import { WORDS } from '../kitchen';

const SRC = path.resolve(__dirname, '..', '..', '..', '..');
const HIDDEN = { includeHiddenElements: true } as const;

// ---------- fixtures (fictional: client Jordan, coach Sam) ----------
let k = 0;
const food = (name: string, calories: number, protein: number, m: number, qty: number | null, unit: string | null, truth: string | null = 'ok') => {
  k += 1;
  return { id: `i${k}`, saved_meal_id: 'm', food_item_id: `f${k}`, quantity_multiplier: m, original_quantity: qty, original_unit: unit,
    position: k, food_item: { id: `f${k}`, name, calories, protein_g: protein, carbs_g: 0, fat_g: 0 }, ...(truth === null ? {} : { food_truth: truth }) };
};
const meal = (id: string, name: string, items: unknown[] | undefined) =>
  ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', ...(items ? { items } : {}) });
const MEALS = (truth: string | null = 'held') => [
  meal('m1', 'Usual breakfast', [food('Greek yoghurt, plain', 59, 12, 2.0, 200, 'g'), food('Rolled oats', 379, 13.2, 0.5, 50, 'g'),
    food('Blueberries', 57, 0.7, 0.8, 80, 'g'), food('Honey', 314, 0.3, 0.21, 1, 'tsp')]),
  meal('m2', 'Post-gym shake', [food('Whey', 240, 26, 1, 1, 'scoop'), food('Banana', 100, 4, 1, 1, 'medium')]),
  meal('m3', 'Friday wrap', [food('Chicken wrap', 565, 38, 1, null, null)]),
  meal('m4', 'Pantry bar', [food('Oat bar', 190, 6, 1, null, null), food('Mystery bar', 250, 9, 1, null, null, truth)]),
  meal('m5', 'Old cereal', [food('Old flakes', 0, 0, 1, 40, 'g', 'legacy_zero')]),
  meal('m6', 'Gone lunch', []),
];
const slot = (id: string, label: string, name: string, kcal: number, order: number) => ({ id, daily_meal_plan_id: 'dp',
  meal_template_id: `t-${id}`, slot_label: label, order, time_of_day: null, meal_template: { id: `t-${id}`, coach_id: 'sam', name,
    calories_kcal: kcal, protein_g: 30, carbs_g: 40, fats_g: 12, fiber_g: null, items: null, description: null, created_at: '2026-10-01', archived_at: null } });
const PLAN = { date: '2026-10-13', assignments: [{ id: 'a1', daily_meal_plan_id: 'dp', client_id: 'jordan', assigned_by_coach_id: 'sam',
  starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01', daily_meal_plan: { id: 'dp', coach_id: 'sam', name: 'Cut', notes: null,
    created_at: '2026-10-01', archived_at: null, slots: [slot('s1', 'breakfast', 'Oats and berries', 420, 0),
      slot('s2', 'lunch', 'Chicken bowl', 560, 1), slot('s3', 'dinner', 'Salmon, potatoes and green beans', 620, 2)] } }] };
const ate = (id: string, mealType: string, name: string, slotId: string) => ({ id, food_item_id: `f-${id}`, user_id: 'jordan', meal_type: mealType,
  quantity_multiplier: 1, food_item: { id: `f-${id}`, name, calories: 400, protein_g: 30 }, plan_slot_id: slotId });
const DAY = (eaten = 2) => ({ entries: [ate('e1', 'breakfast', 'Oats and berries', 's1'), ate('e2', 'lunch', 'Chicken bowl', 's2'),
  ate('e3', 'dinner', 'Salmon, potatoes and green beans', 's3')].slice(0, eaten) });
const GROCERY = [...['Milk', 'Eggs', 'Spinach', 'Rice'].map((name, i) => ({ id: `g${i}`, name, quantity: 1, is_checked: false, added_at: '2026-10-12' })),
  { id: 'g9', name: 'Oats', quantity: 1, is_checked: true, added_at: '2026-10-12' }];
const SHOPPING = [{ id: 'p1', name: 'Paper towels', quantity: 1, is_checked: false, added_at: '2026-10-12' },
  { id: 'p2', name: 'Soap', quantity: 1, is_checked: false, added_at: '2026-10-12' }];
const RECIPES = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `Recipe ${i}`, created_by_id: i < 2 ? 'sam' : 'kitchen' }));

type Answer = unknown | (() => unknown);
let server: Record<string, Answer>;
const fail = (status?: number, message = '') => () => Promise.reject(status ? Object.assign(new Error(message), { response: { status, data: { message } } }) : new Error('Network Error'));
const ok = (data: unknown) => Promise.resolve({ data });
function answer(url: string) {
  const a = server[url];
  if (typeof a === 'function') return (a as () => unknown)();
  return a === undefined ? fail(500)() : ok(a);
}
const reads = (url: string) => mockGet.mock.calls.filter((c) => c[0] === url).length;
const posts = () => mockPost.mock.calls;
const COACH_READS = ['/v1/clients/me/coach', '/me/meal-plan/today', '/log/daily'];

function setClock(h: number, m: number) {
  jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  jest.setSystemTime(new Date(2026, 9, 13, h, m));
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(<QueryClientProvider client={client}><KitchenScreen /></QueryClientProvider>);
  await screen.findByTestId('kitchen-log-food');
  return client;
}
const settle = () => waitFor(() => expect(screen.queryByTestId('kitchen-loading')).toBeNull());
async function openSheet(name: string) {
  await fireEvent.press(screen.getByTestId(`kitchen-meal-${MEALS().find((m) => m.name === name)!.id}`));
  return screen.getByTestId('kitchen-sheet');
}
const pressAdd = async () => { await fireEvent.press(screen.getByTestId('kitchen-add')); };
const focus = async () => { await act(async () => { (mockListeners.focus ?? []).forEach((cb) => cb()); }); };
type JsonNode = { type: string; props: Record<string, unknown>; children: Array<JsonNode | string> | null };
function allWords(): string {
  const out: string[] = [];
  const walk = (node: JsonNode | JsonNode[] | string | null) => {
    if (!node) return;
    if (typeof node === 'string') { out.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const key of ['accessibilityLabel', 'accessibilityHint']) if (typeof node.props[key] === 'string') out.push(node.props[key] as string);
    (node.children ?? []).forEach(walk);
  };
  walk(screen.toJSON() as JsonNode | JsonNode[] | null);
  return out.join(' | ');
}

beforeEach(() => {
  jest.useRealTimers();
  setClock(8, 0);
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  Object.assign(mockFlags, { youTabV2: true, foodPlanChecklist: true, clientTimelineV2: true, clientPathCopilot: true, romanChat: true });
  mockUser = { id: 'jordan', coach_id: 'sam' };
  mockNet = { isOnline: true, isInternetReachable: true };
  (NetInfo as unknown as { __reset: () => void }).__reset();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockGet.mockReset().mockImplementation((url: string) => answer(url));
  mockPost.mockReset();
  [mockNav.navigate, mockNav.goBack, mockParent.navigate, mockTrack, mockInvalidate, mockStore.setSelectedDate, mockStore.refreshShownDay, mockEnqueue]
    .forEach((f) => f.mockClear());
  Object.values(mockHaptics).forEach((f) => f.mockClear());
  forgetSaveKeys();
  server = {
    '/me/foods/saved-meals': MEALS(), '/lists/grocery': GROCERY, '/lists/shopping': SHOPPING, '/recipes': RECIPES,
    '/me/meal-plan/today': PLAN, '/log/daily': DAY(), '/v1/clients/me/coach': { name: 'Sam Rivera' },
  };
});
afterEach(() => jest.useRealTimers());

describe('KITCHEN-M: the Kitchen page (Style 2 Menu)', () => {
  it('1. the route: Kitchen in the More stack once, OWN, no options; open through the payment lockout; no You row (door from Food)', () => {
    const nav = fs.readFileSync(path.join(SRC, 'navigation', 'ClientNavigator.tsx'), 'utf8');
    expect(nav).toContain("import KitchenScreen from '../screens/client/kitchen/KitchenScreen';");
    expect(nav.match(/const ProtectedKitchenScreen = withProtectedScreen\(KitchenScreen, OWN\);/g)).toHaveLength(1);
    expect(nav.match(/name="Kitchen"/g)).toHaveLength(1);
    expect(nav).toContain('<MoreStackNav.Screen name="Kitchen" component={ProtectedKitchenScreen} />');
    expect(nav).toMatch(/\n {2}Kitchen: undefined;\n/);
    const lockout = fs.readFileSync(path.join(SRC, 'entitlements', 'dunning', 'DunningLockoutProvider.tsx'), 'utf8');
    expect(lockout).toMatch(/OPEN_FOR_OWN_LOGGING[^]*?'Kitchen'[^]*?\]\);/);
    expect(fs.readFileSync(path.join(SRC, 'screens', 'client', 'MoreScreen.tsx'), 'utf8')).not.toMatch(/Kitchen/);
  });

  it('2. S1: the masthead line, the meals in the server\'s order, Usual breakfast 420 kcal and 32 g protein', async () => {
    await mount();
    await settle();
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText('Your meals, recipes and grocery list.')).toBeTruthy();
    const ids = screen.getAllByTestId(/^kitchen-meal-/).map((n) => n.props.testID);
    expect(ids).toEqual(['kitchen-meal-m1', 'kitchen-meal-m2', 'kitchen-meal-m3', 'kitchen-meal-m4', 'kitchen-meal-m5', 'kitchen-meal-m6']);
    expect(screen.getByLabelText('Usual breakfast, 420 kcal, 32 g protein')).toBeTruthy();
    expect(screen.getByLabelText('Post-gym shake, 340 kcal, 30 g protein')).toBeTruthy();
    expect(screen.getByLabelText('Friday wrap, 565 kcal, 38 g protein')).toBeTruthy();
    expect(within(screen.getByTestId('kitchen-meal-m1')).getByText(/420/)).toBeTruthy();
    expect(screen.getByText('Your meals')).toBeTruthy();
    expect(screen.getByText('More in your kitchen')).toBeTruthy();
  });

  it.each([['held'], [null]])('3. truth (R4): a food whose truth is %p, and a legacy_zero food: no number, no total, still addable', async (truth) => {
    server['/me/foods/saved-meals'] = MEALS(truth as string | null);
    await mount();
    await settle();
    expect(screen.getByLabelText('Pantry bar, no total: numbers held back for 1 of its foods')).toBeTruthy();
    expect(screen.getByLabelText('Old cereal, no total: numbers held back for 1 of its foods')).toBeTruthy();
    expect(within(screen.getByTestId('kitchen-meal-m4')).getByText('No total')).toBeTruthy();
    expect(within(screen.getByTestId('kitchen-meal-m5')).getByText('No total')).toBeTruthy();
    // Never a partial total: the Oat bar's 190 is not the meal's number.
    expect(within(screen.getByTestId('kitchen-meal-m4')).queryByText(/190/)).toBeNull();
    const sheet = await openSheet('Pantry bar');
    expect(within(sheet).getByText('No total. 2 foods.')).toBeTruthy();
    expect(within(sheet).getByText('Numbers for Mystery bar are held back here, so this meal has no total. Adding it checks the food again.')).toBeTruthy();
    expect(within(sheet).getByText(/Numbers held back/)).toBeTruthy();
    expect(within(sheet).queryByText(/250/)).toBeNull();
    expect(within(sheet).queryByText(/440/)).toBeNull();
    expect(within(sheet).getByText('190 kcal')).toBeTruthy();
    expect(screen.getByTestId('kitchen-add').props.accessibilityState?.disabled).toBeFalsy();
  });

  it('4. the log (R6): one post with today, the meal and the key in body and header; Added bar; Food day refreshed; See today', async () => {
    await mount();
    await settle();
    mockPost.mockImplementation(() => ok([{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'n4' }]));
    await openSheet('Usual breakfast');
    await pressAdd();
    expect(posts()).toHaveLength(1);
    const [url, body, config] = posts()[0];
    expect(url).toBe('/me/foods/saved-meals/m1/log');
    expect(body).toEqual({ date: '2026-10-13', meal_type: 'breakfast', client_uuid: expect.stringMatching(/^pfl_/) });
    expect(config).toEqual({ headers: { 'Idempotency-Key': body.client_uuid } });
    expect(`${body.client_uuid}:30`.length).toBeLessThanOrEqual(128);
    expect(screen.queryByTestId('kitchen-sheet')).toBeNull();
    expect(screen.getByText("Added to today's breakfast.")).toBeTruthy();
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['food', 'log'] });
    expect(mockStore.refreshShownDay).toHaveBeenCalledWith('jordan', '2026-10-13');
    expect(mockTrack).toHaveBeenCalledWith('meal_logged', { meal_type: 'breakfast', source: 'saved_meal' });
    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('kitchen-see-today'));
    expect(mockStore.setSelectedDate).toHaveBeenCalledWith('2026-10-13');
    expect(mockParent.navigate).toHaveBeenCalledWith('Log');
    expect(screen.queryByTestId('kitchen-added')).toBeNull();
  });

  it('5. retry: a lost answer shows KK-6 and Try again with the same key; a 500 keeps it; a 404 lets it go; two taps send once', async () => {
    await mount();
    await settle();
    await openSheet('Usual breakfast');
    mockPost.mockImplementationOnce(fail());
    await pressAdd();
    expect(screen.getByText('This meal was not added. Check the connection and try again.')).toBeTruthy();
    expect(within(screen.getByTestId('kitchen-add')).getByText('Try again')).toBeTruthy();
    mockPost.mockImplementationOnce(fail(500));
    await pressAdd();
    mockPost.mockImplementationOnce(fail(404, 'Food not found'));
    await pressAdd();
    const keys = posts().map((c) => c[1].client_uuid);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    let release: (v: unknown) => void = () => undefined;
    mockPost.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    await fireEvent.press(screen.getByTestId('kitchen-add'));
    expect(posts()).toHaveLength(4);
    expect(posts()[3][1].client_uuid).not.toBe(keys[0]);
    await act(async () => { release({ data: [{ id: 'n1' }] }); });
    expect(screen.getByText("Added to today's breakfast.")).toBeTruthy();
  });

  it('6. refusals: Food not found says KK-5; Saved meal not found says KK-7 and reads again; offline says KK-9 and sends nothing', async () => {
    await mount();
    await settle();
    await openSheet('Usual breakfast');
    mockPost.mockImplementationOnce(fail(404, 'Food not found'));
    await pressAdd();
    expect(screen.getByText('A food in this meal can no longer be logged, so nothing was added.')).toBeTruthy();
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
    expect(screen.queryByTestId('kitchen-added')).toBeNull();
    expect(mockHaptics.error).toHaveBeenCalled();
    const before = reads('/me/foods/saved-meals');
    mockPost.mockImplementationOnce(fail(404, 'Saved meal not found'));
    await pressAdd();
    expect(screen.getByText('This meal is no longer saved.')).toBeTruthy();
    expect(screen.queryByTestId('kitchen-add')).toBeNull();
    await waitFor(() => expect(reads('/me/foods/saved-meals')).toBe(before + 1));
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    const sent = posts().length;
    (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false, isInternetReachable: false });
    await openSheet('Friday wrap');
    await pressAdd();
    expect(screen.getByText('Adding a saved meal needs a connection. Nothing was added.')).toBeTruthy();
    expect(posts()).toHaveLength(sent);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('7. Gone lunch (items: []): KK-8a on the row, no total, KK-8b in the sheet, no Add, nothing sent; an answer of [] is not added', async () => {
    await mount();
    await settle();
    const row = screen.getByTestId('kitchen-meal-m6');
    expect(within(row).getByText('No foods left in this meal')).toBeTruthy();
    expect(within(row).queryByText('No total')).toBeNull();
    expect(within(row).queryByText(/kcal/)).toBeNull();
    const sheet = await openSheet('Gone lunch');
    expect(within(sheet).getByText('Its foods were removed, so there is nothing to add.')).toBeTruthy();
    expect(within(sheet).queryByText(/0 foods|No total/)).toBeNull();
    expect(screen.queryByTestId('kitchen-add')).toBeNull();
    expect(posts()).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    const before = reads('/me/foods/saved-meals');
    mockPost.mockImplementationOnce(() => ok([]));
    await openSheet('Friday wrap');
    await pressAdd();
    expect(screen.getByText('Its foods were removed, so there is nothing to add.')).toBeTruthy();
    expect(screen.queryByTestId('kitchen-added')).toBeNull();
    await waitFor(() => expect(reads('/me/foods/saved-meals')).toBe(before + 1));
  });

  it.each([[8, 0, 'Breakfast'], [12, 0, 'Lunch'], [16, 0, 'Snacks'], [18, 30, 'Dinner'], [22, 0, 'Snacks']])(
    '8. at %p:%p the sheet opens on %p (R5); a changed choice is what is sent', async (h, m, label) => {
      setClock(h as number, m as number);
      await mount();
      await settle();
      await openSheet('Friday wrap');
      expect(screen.getByRole('radio', { name: label as string }).props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
      mockPost.mockImplementation(() => ok([{ id: 'n1' }]));
      await fireEvent.press(screen.getByRole('radio', { name: 'Dinner' }));
      await pressAdd();
      expect(posts()[0][1].meal_type).toBe('dinner');
    });

  it('9. S3 no coach: no From, no coach, plan or day read on open, pull to refresh or return; no coach, plan or Roman word', async () => {
    mockUser = { id: 'jordan', coach_id: null };
    await mount();
    await settle();
    await waitFor(() => expect(screen.getByLabelText('Recipes, 12')).toBeTruthy());
    expect(screen.queryByTestId('kitchen-from')).toBeNull();
    expect(screen.queryByTestId('kitchen-plan-card')).toBeNull();
    await act(async () => { await screen.getByTestId('kitchen-refresh').props.onRefresh(); });
    await focus();
    await focus();
    for (const url of COACH_READS) expect(reads(url)).toBe(0);
    expect(allWords()).not.toMatch(/Sam|coach|plan|Roman/i);
  });

  it('10. From {coach} (R8): the dinner still to eat; all eaten, no plan or a failed read: no card; a failed coach read: From your coach', async () => {
    await mount();
    await settle();
    const card = await screen.findByTestId('kitchen-plan-card');
    expect(screen.getByText('From Sam')).toBeTruthy();
    expect(card.props.accessibilityLabel).toBe("Salmon, potatoes and green beans, Tonight's dinner, 620 kcal");
    expect(within(card).getByText("Tonight's dinner")).toBeTruthy();
    await fireEvent.press(card);
    expect(mockNav.navigate).toHaveBeenCalledWith('ClientDailyMealPlan');
    await screen.unmount();
    for (const change of [{ '/log/daily': DAY(3) }, { '/me/meal-plan/today': { date: '2026-10-13', assignments: [] } },
      { '/me/meal-plan/today': fail(500) }, { '/log/daily': fail(500) }]) {
      Object.assign(server, { '/me/meal-plan/today': PLAN, '/log/daily': DAY() }, change);
      await mount();
      await settle();
      await waitFor(() => expect(reads('/me/meal-plan/today')).toBeGreaterThan(0));
      await act(async () => undefined);
      expect(screen.queryByTestId('kitchen-plan-card')).toBeNull();
      expect(screen.queryByTestId('kitchen-from')).toBeNull();
      await screen.unmount();
    }
    Object.assign(server, { '/me/meal-plan/today': PLAN, '/log/daily': DAY(), '/v1/clients/me/coach': fail(500) });
    await mount();
    await screen.findByTestId('kitchen-plan-card');
    await waitFor(() => expect(screen.getByText('From your coach')).toBeTruthy());
    expect(screen.getByLabelText('Recipes, 12, 2 from your coach')).toBeTruthy();
  });

  it('11. S2: the empty words; no Save a meal from today, Rename or Delete anywhere (R1); Log food still there', async () => {
    server['/me/foods/saved-meals'] = [];
    await mount();
    await settle();
    expect(await screen.findByText('No saved meals yet. Save one you eat often and log it again in two taps.')).toBeTruthy();
    expect(allWords()).not.toMatch(/Save a meal|Rename|Delete/);
    expect(screen.getByTestId('kitchen-log-food')).toBeTruthy();
  });

  it('12. S7 and S8: still bones read once; a failed read shows the notice and Try again; the rest still works; never empty or 0', async () => {
    let release: (v: unknown) => void = () => undefined;
    server['/me/foods/saved-meals'] = () => new Promise((r) => { release = r; });
    await mount();
    expect(screen.getAllByLabelText('Loading saved meals')).toHaveLength(1);
    expect(screen.getByTestId('kitchen-mast-bone', HIDDEN)).toBeTruthy();
    expect(screen.queryByText('Your meals, recipes and grocery list.')).toBeNull();
    expect(screen.getByText('Kitchen')).toBeTruthy();
    await act(async () => { release({ data: { error: 'not a list' } }); });
    expect(await screen.findByText("Couldn't load saved meals")).toBeTruthy();
    expect(screen.getByText('Check the connection and try again.')).toBeTruthy();
    expect(screen.queryByText(/No saved meals yet/)).toBeNull();
    expect(await screen.findByTestId('kitchen-plan-card')).toBeTruthy();
    expect(screen.getByLabelText('Grocery list, 4 to get')).toBeTruthy();
    expect(screen.getByTestId('kitchen-log-food')).toBeTruthy();
    server['/me/foods/saved-meals'] = MEALS();
    const before = reads('/me/foods/saved-meals');
    await fireEvent.press(screen.getByTestId('kitchen-retry'));
    await waitFor(() => expect(reads('/me/foods/saved-meals')).toBe(before + 1));
    expect(await screen.findByTestId('kitchen-meal-m1')).toBeTruthy();
    await screen.unmount();
    server['/lists/grocery'] = fail(403, 'Forbidden');
    await mount();
    await settle();
    await waitFor(() => expect(reads('/lists/grocery')).toBeGreaterThan(0));
    await act(async () => undefined);
    expect(screen.getByLabelText('Grocery list')).toBeTruthy();
    expect(allWords()).not.toMatch(/0 to get/);
  });

  it('13. cached meals stay on a failed refresh; a focus after the first re-reads every read (coached), and none of the three coachless', async () => {
    await mount();
    await settle();
    await screen.findByTestId('kitchen-plan-card');
    await focus(); // the first focus is the mount's: skipped
    const counts = () => ['/me/foods/saved-meals', '/lists/grocery', '/lists/shopping', '/recipes', ...COACH_READS].map(reads);
    const before = counts();
    server['/me/foods/saved-meals'] = fail();
    await focus();
    await waitFor(() => expect(counts()).toEqual(before.map((c) => c + 1)));
    await act(async () => undefined);
    expect(screen.getByTestId('kitchen-meal-m1')).toBeTruthy();
    expect(screen.queryByText("Couldn't load saved meals")).toBeNull();
  });

  it('14. 320 x 568 at 130%: no text cut by numberOfLines (the buttons wrap); every control at least 44 pt', async () => {
    mockDims = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    await mount();
    await settle();
    await openSheet('Pantry bar');
    const nodes: JsonNode[] = [];
    const walk = (node: JsonNode | JsonNode[] | string | null) => {
      if (!node || typeof node === 'string') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      nodes.push(node);
      (node.children ?? []).forEach(walk);
    };
    walk(screen.toJSON() as JsonNode | JsonNode[] | null);
    // Only main's PrimaryButton sets numberOfLines; the page asks it to wrap (two lines), so no label is cut.
    const capped = nodes.filter((n) => n.type === 'Text' && n.props.numberOfLines != null);
    expect(capped.map((n) => [n.children?.join(''), n.props.numberOfLines])).toEqual([['Log food', 2], ['Add to today', 2]]);
    const controls = nodes.filter((n) => n.props.accessibilityRole === 'button' || n.props.accessibilityRole === 'radio');
    expect(controls.length).toBeGreaterThan(10);
    const small = controls.map((c) => {
      const st = (StyleSheet.flatten(c.props.style as never) ?? {}) as { minHeight?: number; height?: number };
      return [c.props.accessibilityLabel, Math.max(st.minHeight ?? 0, st.height ?? 0)] as const;
    }).filter(([, size]) => size < 44);
    expect(small).toEqual([]);
  });

  it('15. guards: no colour literal, no pale green name, no heavy weight, no note marker, no first person in a new product file', () => {
    const files = ['screens/client/kitchen/kitchen.ts', 'screens/client/kitchen/KitchenScreen.tsx', 'screens/client/kitchen/SavedMealSheet.tsx',
      'api/savedFoodsApi.ts'].map((f) => fs.readFileSync(path.join(SRC, f), 'utf8'));
    for (const src of files) {
      expect(src).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/);
      expect(src).not.toMatch(/surface\.sage|sageLine/);
      expect(src).not.toMatch(/fontWeight: '(700|800)'/);
      expect(src).not.toMatch(new RegExp(['TO', 'DO|FIX', 'ME|X', 'XX'].join(''))); // spelled in parts: quietLuxuryDoctrine reads test files too
    }
    expect(Object.values(WORDS).filter((w) => /\b(we|us|our)\b|!/i.test(w))).toEqual([]);
  });

  it('16. More in your kitchen: each row opens its page and Back returns; the counts from their own reads; no "from" with no coach', async () => {
    await mount();
    await settle();
    await waitFor(() => expect(screen.getByLabelText('Recipes, 12, 2 from Sam')).toBeTruthy());
    expect(screen.getByLabelText('Grocery list, 4 to get')).toBeTruthy();
    for (const [label, route] of [['Recipes', 'Recipes'], ['Grocery list', 'GroceryList'], ['Prep guide', 'PrepGuide'], ['Food this week', 'FoodWeek']]) {
      await fireEvent.press(screen.getByTestId(`kitchen-row-${label}`));
      expect(mockNav.navigate).toHaveBeenLastCalledWith(route);
    }
    await fireEvent.press(screen.getByLabelText('Go back'));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });

  it('17. the sheet\'s Day line is not a control: no button role and no press', async () => {
    await mount();
    await settle();
    await openSheet('Usual breakfast');
    const day = screen.getByTestId('kitchen-day');
    expect(day.props.accessibilityRole).toBeUndefined();
    expect(day.props.onPress).toBeUndefined();
    expect(day.props.accessibilityLabel).toBe('Day, Today');
  });

  it('18. Log food (#ALM-E26): in every state; opens today on the Food tab; off, not hidden, while offline', async () => {
    await mount();
    await settle();
    const button = screen.getByTestId('kitchen-log-food');
    expect(within(button).getByText('Log food')).toBeTruthy();
    expect(button.props.accessibilityHint).toBe('Opens today on the Food tab');
    await fireEvent.press(button);
    expect(mockStore.setSelectedDate).toHaveBeenCalledWith('2026-10-13');
    expect(mockParent.navigate).toHaveBeenCalledWith('Log');
    await screen.unmount();
    mockNet = { isOnline: false, isInternetReachable: false };
    mockParent.navigate.mockClear();
    await mount();
    await settle();
    expect(screen.getByTestId('kitchen-log-food').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(screen.getByTestId('kitchen-log-food'));
    expect(mockParent.navigate).not.toHaveBeenCalled();
  });

  it('19. the Added bar stays until See today, another sheet or leaving the page', async () => {
    await mount();
    await settle();
    mockPost.mockImplementation(() => ok([{ id: 'n1' }]));
    await openSheet('Friday wrap');
    await pressAdd();
    expect(screen.getByTestId('kitchen-added')).toBeTruthy();
    await openSheet('Usual breakfast');
    expect(screen.queryByTestId('kitchen-added')).toBeNull();
    await pressAdd();
    expect(screen.getByTestId('kitchen-added')).toBeTruthy();
    await act(async () => { (mockListeners.blur ?? []).forEach((cb) => cb()); });
    expect(screen.queryByTestId('kitchen-added')).toBeNull();
  });
});
