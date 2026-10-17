/** MEALBUILD: Programs > Meal plans, Meals, the meal editor, the day-plan builder and Assign, real hooks against a fake of backend main's routes. */
import React from 'react';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockDb = { meals: [] as Row[], plans: [] as Row[], assignments: [] as Row[], clients: [] as Row[], fail: {} as Record<string, unknown>, log: [] as string[] };
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), popTo: jest.fn(), addListener: jest.fn(() => jest.fn()) };
let mockFlag = true;
let mockPick = new Date();

/** Backend main's coach meal routes: own rows only, archived rows hidden, DTO limits enforced. */
function mockRoute(method: string, url: string, body: Row = {}): Promise<{ data: unknown }> {
  const key = `${method} ${url}`; mockDb.log.push(key);
  if (key in mockDb.fail) return mockDb.fail[key] === 'hang' ? new Promise(() => {}) : Promise.reject(mockDb.fail[key]);
  const [, , kind, id, sub] = url.split('/');
  const live = (rows: Row[]) => rows.filter((r) => !r.archived_at);
  const meal = live(mockDb.meals).find((m) => m.id === id);
  const bad = ['calories_kcal', 'protein_g', 'carbs_g', 'fats_g'].some((k, i) => body[k] > [2000, 300, 400, 200][i]);
  const plan = (p: Row) => ({ ...p, slots: p.slots.map((s: Row) => ({ ...s, meal_template: mockDb.meals.find((m) => m.id === s.meal_template_id) })) });
  const no = (status: number, message: string) => Promise.reject({ response: { status, data: { message } } });
  const p = live(mockDb.plans).find((x) => x.id === id);
  const deadMeal = (body.slots ?? []).some((x: Row) => !live(mockDb.meals).some((m) => m.id === x.meal_template_id));
  if (body.slots) body = { ...body, slots: body.slots.map((x: Row, i: number) => ({ id: `n${i}`, ...x })) };
  let data: unknown;
  if (kind === 'clients') data = { calories_kcal: 2100, protein_g: 160, carbs_g: 220, fats_g: 70 };
  else if (kind === 'meal-templates') {
    if (method === 'GET') data = live(mockDb.meals);
    else if (bad) return no(400, 'Bad Request');
    else if (method === 'POST') mockDb.meals.push((data = { id: `m${mockDb.meals.length + 1}`, archived_at: null, ...body }) as Row);
    else if (!meal) return no(404, 'Meal template not found');
    else data = Object.assign(meal, method === 'DELETE' ? { archived_at: '2026-10-16T00:00:00.000Z' } : body);
  } else if (sub === 'assignments' && method === 'GET') data = mockDb.assignments.filter((a) => a.daily_meal_plan_id === id);
  else if (id && !p) return no(404, 'Daily meal plan not found');
  else if (sub === 'assignments') {
    if (!mockDb.clients.some((c) => c.id === body.client_id)) return no(404, 'Client not found');
    mockDb.assignments.push((data = { id: `a${mockDb.assignments.length}`, daily_meal_plan_id: id, ends_on: null, ...body }) as Row);
  } else if (method === 'GET') data = p ? plan(p) : live(mockDb.plans).map(plan);
  else if (deadMeal) return no(400, 'Meal template(s) not owned by coach');
  else if (method === 'POST') mockDb.plans.push((data = { id: `p${mockDb.plans.length + 1}`, coach_id: 'coach', notes: null, archived_at: null, ...body }) as Row);
  else data = plan(Object.assign(p as Row, body));
  return Promise.resolve({ data });
}
jest.mock('../../../../services/api', () => ({ __esModule: true, coachApi: { getClients: () => Promise.resolve({ data: mockDb.clients }) }, default: { get: (u: string) => mockRoute('GET', u),
  post: (u: string, b: Row) => mockRoute('POST', u, b), patch: (u: string, b: Row) => mockRoute('PATCH', u, b), delete: (u: string) => mockRoute('DELETE', u) } }));
jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  return { ...actual, featureFlags: Object.defineProperty({ ...actual.featureFlags }, 'mealPlansV2', { get: () => mockFlag }) };
});
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), SafeAreaView: require('react-native').View }));
jest.mock('../../../../components/coach/ai-entry/useAiEntryStatus', () => ({ useAiEntryStatus: () => ({ visible: false }) }));
jest.mock('../../../../hooks/usePrograms', () => ({
  ...jest.requireActual('../../../../hooks/usePrograms'),
  useProgramList: () => ({ data: { pages: [{ items: [], goal_tags: [] }] }, isLoading: false, isRefetching: false, error: null, refetch: jest.fn() }),
  useSavedWorkouts: () => ({ data: { pages: [{ items: [] }] }, isLoading: false, isRefetching: false, error: null, refetch: jest.fn() }),
}));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: ({ testID, onChange }: Row) =>
  require('react').createElement(require('react-native').Pressable, { testID, onPress: () => onChange({ type: 'set' }, mockPick) }) }));

import ProgramsLibraryScreen from '../../programs/ProgramsLibraryScreen';
import MealEditor from '../../CoachMealTemplatesScreen';
import DayPlanBuilder from '../DayPlanBuilderScreen';
import MealPicker from '../MealPickerScreen';
import MealPlanAssign from '../MealPlanAssignScreen';
import { toIsoDate } from '../../../../api/programsApi';
import { HapticService } from '../../../../ui/haptics/haptics.service';

const meal = (id: string, name: string, k: number, p: number, c: number, f: number) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null });
const slot = (id: string, meal_template_id: string, slot_label: string, order: number) => ({ id, meal_template_id, slot_label, order });
const assign = (plan: string, client: string, ends_on: string | null = null) =>
  ({ id: `${plan}-${client}`, daily_meal_plan_id: plan, client_id: client, starts_on: '2026-10-01T00:00:00.000Z', ends_on });
const haptic = (k: 'selection' | 'success' | 'error' | 'mediumImpact') => HapticService[k] as jest.Mock;
const mount = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
const editor = (mealId?: string, also?: React.ReactElement) => mount(<>{also}<MealEditor {...({ route: { params: { mealId } }, navigation: mockNav } as any)} /></>);
const open = (C: React.ComponentType<any>, params?: Row) => mount(<C route={{ params }} navigation={mockNav} />);
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const chip = (n: number) => `${day(n).toLocaleDateString('en-US', { weekday: 'short' })} ${day(n).getDate()}`;
const long = (n: number) => day(n).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

beforeEach(() => {
  jest.clearAllMocks();
  mockFlag = true;
  for (const k of ['selection', 'success', 'error', 'mediumImpact'] as const) jest.spyOn(HapticService, k).mockResolvedValue();
  mockDb.meals = [meal('m1', 'Overnight oats', 420, 24, 62, 9), meal('m2', 'Chicken rice bowl', 680, 52, 78, 14), meal('m3', 'Greek yogurt', 220, 20, 18, 6)];
  mockDb.plans = [
    { id: 'p1', coach_id: 'coach', name: 'Training day', notes: 'Eat the bigger lunch on lifting days.', archived_at: null, slots: [slot('s1', 'm1', 'breakfast', 0), slot('s2', 'm2', 'lunch', 1)] },
    { id: 'p2', coach_id: 'coach', name: 'Rest day', notes: null, archived_at: null, slots: [slot('s3', 'm3', 'snack', 0)] },
  ];
  mockDb.assignments = [assign('p1', 'c1'), assign('p1', 'c3'), assign('p1', 'c2', '2020-01-31T00:00:00.000Z'), assign('p2', 'c1')];
  mockDb.clients = [['c1', 'Maya Chen'], ['c2', 'Jordan Lee'], ['c3', 'Leo Park'], ['c4', 'Nina Shah']].map(([id, name]) => ({ id, name, email: `${id}@x.test` }));
  Object.assign(mockDb, { fail: {}, log: [] });
});
afterEach(() => require('@react-native-community/netinfo').__reset());

it('is off by default, and off Programs has no Meal plans', async () => {
  expect(jest.requireActual('../../../../config/featureFlags').featureFlags.mealPlansV2).toBe(false);
  mockFlag = false;
  const s = await mount(<ProgramsLibraryScreen />);
  expect(s.queryByTestId('programs-tab-plans')).toBeNull();
});

it('Meal plans shows kcal, note, meals, protein and clients on each plan; Meals opens the editor', async () => {
  const s = await mount(<ProgramsLibraryScreen />);
  await fireEvent.press(s.getByTestId('programs-tab-plans'));
  expect(haptic('selection')).toHaveBeenCalledTimes(1);
  expect(await s.findByLabelText('Training day, 1,100 kcal, 2 clients')).toBeTruthy();
  expect(s.getByLabelText('Rest day, 220 kcal, 1 client')).toBeTruthy();
  expect(s.getByText('2 day plans · 3 meals · 2 clients on a plan')).toBeTruthy();
  expect(s.getByText('“Eat the bigger lunch on lifting days.”')).toBeTruthy();
  expect(s.getByText('2 meals · protein 76 g')).toBeTruthy();
  await fireEvent.press(s.getByLabelText('Rest day, 220 kcal, 1 client'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('DayPlanBuilder', { planId: 'p2' });
  await fireEvent.press(s.getByTestId('plan-new'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('DayPlanBuilder');
  await fireEvent.press(s.getByTestId('programs-tab-meals'));
  await fireEvent.press(await s.findByLabelText('Overnight oats, 420 kcal · P 24 · C 62 · F 9'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealEditor', { mealId: 'm1' });
  await fireEvent.press(s.getByTestId('meal-new'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealEditor');
  await fireEvent.press(s.getByTestId('programs-tab-workouts'));
  expect(s.queryByText('Your meal plans')).toBeNull();
});

it('the editor holds backend limits, says when a save fails, then creates the meal', async () => {
  const s = await editor();
  await fireEvent.changeText(s.getByLabelText('Name'), 'Salmon and potatoes');
  for (const [label, v] of [['Calories (kcal)', '2500'], ['Protein (g)', '42'], ['Carbs (g)', '50'], ['Fat (g)', '22']]) {
    await fireEvent.changeText(s.getByLabelText(label), v);
  }
  expect(s.getByText('Up to 2,000 kcal, 300 g protein, 400 g carbs and 200 g fat.')).toBeTruthy();
  expect(s.getByTestId('meal-save').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(s.getByLabelText('Calories (kcal)'), '640');
  expect(s.getByText('640 kcal · P 42 · C 50 · F 22')).toBeTruthy();
  mockDb.fail['POST /coach/meal-templates'] = { message: 'Network Error', isAxiosError: true };
  await fireEvent.press(s.getByTestId('meal-save'));
  expect(await s.findByText('That did not save. Check your connection, then try again.')).toBeTruthy();
  expect(haptic('error')).toHaveBeenCalledTimes(1);
  delete mockDb.fail['POST /coach/meal-templates'];
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(mockNav.goBack).toHaveBeenCalledTimes(1));
  expect(mockDb.meals[3]).toMatchObject({ name: 'Salmon and potatoes', description: '', calories_kcal: 640, protein_g: 42, carbs_g: 50, fats_g: 22 });
  expect(haptic('mediumImpact')).toHaveBeenCalledTimes(2);
  expect(haptic('success')).toHaveBeenCalledTimes(1);
});

it('editing saves the meal and Archive asks first, then archives it; each write refreshes the day plans', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const s = await editor('m1', <ProgramsLibraryScreen />);
  await fireEvent.press(s.getByTestId('programs-tab-plans'));
  expect(await s.findByLabelText('Training day, 1,100 kcal, 2 clients')).toBeTruthy();
  await fireEvent.changeText(await s.findByLabelText('Calories (kcal)'), '520');
  await fireEvent.press(s.getByTestId('meal-save'));
  expect(await s.findByLabelText('Training day, 1,200 kcal, 2 clients')).toBeTruthy();
  await fireEvent.press(s.getByText('Archive this meal'));
  expect(alert).toHaveBeenCalledWith('Archive Overnight oats?', expect.any(String), expect.any(Array));
  await act(async () => (alert.mock.calls[0][2] as any)[1].onPress());
  expect(mockDb.meals[0].archived_at).toBeTruthy();
  await waitFor(() => expect(mockDb.log.filter((k) => k === 'GET /coach/daily-meal-plans')).toHaveLength(3));
  expect(mockNav.goBack).toHaveBeenCalledTimes(2);
});

it('loading, a failed load (one error haptic, Try again, Contact support), offline and first use', async () => {
  mockDb.fail['GET /coach/meal-templates'] = 'hang';
  mockDb.fail['GET /coach/daily-meal-plans'] = { response: { status: 500, data: {} } };
  const s = await mount(<ProgramsLibraryScreen />);
  await fireEvent.press(s.getByTestId('programs-tab-meals'));
  expect(s.getByLabelText('Loading your meals')).toBeTruthy();
  await fireEvent.press(s.getByTestId('programs-tab-plans'));
  expect(await s.findByText('Your meal plans didn’t load.')).toBeTruthy();
  expect(s.getByText('Your plans are safe. Try again in a moment.')).toBeTruthy();
  expect(haptic('error')).toHaveBeenCalledTimes(1);
  await fireEvent.press(s.getByText('Contact support'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('SupportInbox');
  delete mockDb.fail['GET /coach/daily-meal-plans'];
  mockDb.plans = [];
  await fireEvent.press(s.getByText('Try again'));
  expect(await s.findByText('No day plans yet.')).toBeTruthy();
  await act(async () => require('@react-native-community/netinfo').__setState({ isConnected: false }));
  expect(s.getByText(/^You’re offline\. This is your list as of .+\. Saving needs a connection\.$/)).toBeTruthy();
});

it('a new day plan is named, created, then opens in the builder', async () => {
  const s = await open(DayPlanBuilder);
  expect(s.getByTestId('plan-create').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(s.getByLabelText('Day plan name'), 'Travel day');
  await fireEvent.press(s.getByTestId('plan-create'));
  await waitFor(() => expect(mockNav.setParams).toHaveBeenCalledWith({ planId: 'p3' }));
  expect(mockDb.plans[2]).toMatchObject({ name: 'Travel day', slots: [] });
  expect([haptic('mediumImpact').mock.calls.length, haptic('success').mock.calls.length]).toEqual([1, 1]);
});

it('the builder shows the day and its clients, saves the note, and opens Swap, Add a meal and Assign', async () => {
  const s = await open(DayPlanBuilder, { planId: 'p1', assigned: 'Assigned to Jordan from Fri, Oct 16.' });
  expect(await s.findByText('1,100')).toBeTruthy();
  expect(s.getByText('Protein 76 g   Carbs 140 g   Fat 23 g')).toBeTruthy();
  expect(await s.findByText('2 clients follow this plan')).toBeTruthy();
  expect(s.getByText('Assigned to Jordan from Fri, Oct 16.')).toBeTruthy();
  expect(s.getByText('Changes reach the 2 clients on this plan right away. Food they already logged stays as it was.')).toBeTruthy();
  const note = s.getByLabelText('Your note on this plan, clients see it');
  await fireEvent.changeText(note, 'Lunch is the big meal.');
  await fireEvent(note, 'endEditing');
  await waitFor(() => expect(mockDb.plans[0].notes).toBe('Lunch is the big meal.'));
  expect(haptic('success')).toHaveBeenCalledTimes(1);
  await fireEvent.press(s.getByLabelText('Swap lunch'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealPicker', { planId: 'p1', index: 1 });
  await fireEvent.press(s.getByTestId('plan-add'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealPicker', { planId: 'p1' });
  await fireEvent.press(s.getByTestId('plan-assign'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealPlanAssign', { planId: 'p1' });
});

it('Back saves a name and note still being typed, once, even if onEndEditing lands late', async () => {
  const s = await open(DayPlanBuilder, { planId: 'p2' });
  await fireEvent.changeText(await s.findByLabelText('Day plan name'), 'Low day');
  await fireEvent.changeText(s.getByLabelText('Your note on this plan, clients see it'), 'Water first.');
  const leave = (mockNav.addListener.mock.calls as any[]).find(([event]) => event === 'beforeRemove')[1];
  await act(async () => { leave(); s.getByLabelText('Day plan name').props.onEndEditing(); });
  await waitFor(() => expect(mockDb.plans[1]).toMatchObject({ name: 'Low day', notes: 'Water first.' }));
  expect(mockDb.log.filter((k) => k.startsWith('PATCH'))).toEqual(['PATCH /coach/daily-meal-plans/p2']);
});

it('Swap, Add a meal and Remove save the slots; an archived meal says what to do', async () => {
  const slots = () => mockDb.plans[0].slots.map((x: Row) => `${x.meal_template_id} ${x.slot_label} ${x.order}`);
  let s = await open(MealPicker, { planId: 'p1', index: 1 });
  expect(await s.findByText('Swap lunch')).toBeTruthy();
  await fireEvent.press(await s.findByTestId('pick-m3'));
  await waitFor(() => expect(slots()).toEqual(['m1 breakfast 0', 'm3 lunch 1']));
  expect([mockNav.goBack.mock.calls.length, haptic('success').mock.calls.length]).toEqual([1, 1]);
  await s.unmount();
  s = await open(MealPicker, { planId: 'p1' });
  await fireEvent.press(await s.findByLabelText('Snack'));
  expect(haptic('selection')).toHaveBeenCalledTimes(1);
  await fireEvent.press(await s.findByTestId('pick-m2'));
  await waitFor(() => expect(slots()).toEqual(['m1 breakfast 0', 'm3 lunch 1', 'm2 snack 2']));
  await s.unmount();
  s = await open(MealPicker, { planId: 'p1', index: 0 });
  await fireEvent.press(await s.findByText('Remove breakfast'));
  await waitFor(() => expect(slots()).toEqual(['m3 lunch 0', 'm2 snack 1']));
  await s.unmount();
  mockDb.meals[2].archived_at = '2026-10-16T00:00:00.000Z';
  s = await open(MealPicker, { planId: 'p1' });
  await fireEvent.press(await s.findByTestId('pick-m1'));
  expect(await s.findByText('A meal in this plan was archived. Swap it, then try again.')).toBeTruthy();
  expect(haptic('error')).toHaveBeenCalledTimes(1);
});

it('Assign: dates, the target line with no verdict, then success back on the builder', async () => {
  const s = await open(MealPlanAssign, { planId: 'p2' });
  await fireEvent.press(await s.findByTestId('client-c2'));
  expect(haptic('selection')).toHaveBeenCalledTimes(1);
  expect(await s.findByText('Plan 220 · target 2,100 kcal')).toBeTruthy();
  await fireEvent.press(s.getByLabelText('2 weeks'));
  await fireEvent.press(s.getByTestId('assign-submit'));
  await waitFor(() => expect(mockNav.popTo).toHaveBeenCalledWith('DayPlanBuilder',
    { planId: 'p2', assigned: `Assigned to Jordan from ${day(0).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.` }));
  expect(mockDb.assignments[mockDb.assignments.length - 1]).toMatchObject({ daily_meal_plan_id: 'p2', client_id: 'c2', starts_on: toIsoDate(day(0)), ends_on: toIsoDate(day(13)) });
  expect([haptic('mediumImpact').mock.calls.length, haptic('success').mock.calls.length]).toEqual([1, 1]);
});

it.each<[number, string, string]>([
  [1, '1 day', `On ${long(40)} only`], [10, '10 days', `From ${long(40)} to ${long(49)}`],
  [42, '6 weeks', `From ${long(40)} to ${long(81)}`], [0, 'No end date', `From ${long(40)}, no end date`],
])('Assign (#MEAL-1): any start date, and %i days long reads %s', async (days, label, range) => {
  const s = await open(MealPlanAssign, { planId: 'p2' });
  await fireEvent.press(await s.findByTestId('client-c2'));
  mockPick = day(40);
  await fireEvent.press(s.getByLabelText('Pick a start date'));
  await fireEvent.press(s.getByTestId('assign-date'));
  if (days) {
    mockPick = day(39 + days);
    await fireEvent.press(s.getByLabelText('Pick an end date'));
    await fireEvent.press(s.getByTestId('assign-date'));
  }
  await fireEvent.press(s.getByText('Done'));
  expect([s.getByText(long(40)), s.getByText(label), s.getByText(range), s.queryByTestId('assign-date')]).toEqual([expect.anything(), expect.anything(), expect.anything(), null]);
  expect(s.getByLabelText('Pick a start date').props.accessibilityState.selected).toBe(true);
  expect(s.getByLabelText(days ? 'Pick an end date' : 'No end date').props.accessibilityState).toMatchObject(days ? { selected: true } : { checked: true });
  await fireEvent.press(s.getByTestId('assign-submit'));
  await waitFor(() => expect(mockDb.assignments[mockDb.assignments.length - 1]).toMatchObject(
    { client_id: 'c2', starts_on: toIsoDate(day(40)), ends_on: days ? toIsoDate(day(39 + days)) : null }));
});

it.each(['GET /coach/daily-meal-plans', 'GET /coach/daily-meal-plans/p1/assignments'])('Assign waits while %s fails, then Try again reads it', async (read) => {
  mockDb.fail[read] = { response: { status: 500, data: {} } };
  const s = await open(MealPlanAssign, { planId: 'p2' });
  await fireEvent.press(await s.findByTestId('client-c3'));
  expect(await s.findByText('Your meal plans didn’t load.')).toBeTruthy();
  await fireEvent.press(s.getByTestId('assign-submit'));
  expect([s.getByTestId('assign-submit').props.accessibilityState.disabled, mockDb.log.some((k) => k.startsWith('POST'))]).toEqual([true, false]);
  delete mockDb.fail[read];
  await fireEvent.press(s.getByText('Try again'));
  expect(await s.findByText('Leo is on Training day from Thu, Oct 1. On days both plans cover, Leo sees the one that starts later.')).toBeTruthy();
  expect(s.getByTestId('assign-submit').props.accessibilityState.disabled).toBe(false);
});

it('Assign conflicts: same plan and same start day block, an overlap explains, a moved client and an archived plan say so', async () => {
  mockDb.assignments.push({ ...assign('p2', 'c4'), starts_on: toIsoDate(day(2)) });
  const s = await open(MealPlanAssign, { planId: 'p1' });
  await fireEvent.press(await s.findByTestId('client-c1'));
  expect(await s.findByText('Maya is already on Training day from Thu, Oct 1.')).toBeTruthy();
  expect(s.getByTestId('assign-submit').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(s.getByTestId('client-c4'));
  const from = day(2).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  expect(s.getByText(`Nina is on Rest day from ${from}. On days both plans cover, Nina sees the one that starts later.`)).toBeTruthy();
  await fireEvent.press(s.getByLabelText(chip(2)));
  expect(s.getByText(`Nina starts Rest day on ${from}. Pick another start date.`)).toBeTruthy();
  expect(s.getByTestId('assign-submit').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(s.getByLabelText('Today'));
  await fireEvent.press(s.getByTestId('client-c2'));
  mockDb.clients = mockDb.clients.filter((c) => c.id !== 'c2');
  await fireEvent.press(s.getByTestId('assign-submit'));
  expect(await s.findByText('Jordan is no longer your client.')).toBeTruthy();
  mockDb.plans[0].archived_at = '2026-10-16T00:00:00.000Z';
  await fireEvent.press(s.getByTestId('assign-submit'));
  expect(await s.findByText('This day plan was archived.')).toBeTruthy();
  expect([haptic('error').mock.calls.length, mockNav.popTo.mock.calls.length]).toEqual([2, 0]);
});
