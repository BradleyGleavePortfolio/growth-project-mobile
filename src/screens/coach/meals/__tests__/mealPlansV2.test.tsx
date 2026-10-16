/** MEALBUILD: Programs > Meal plans, Meals and the meal editor, real hooks against a fake of backend main's routes. */
import React from 'react';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockDb = { meals: [] as Row[], plans: [] as Row[], assignments: [] as Row[], fail: {} as Record<string, unknown> };
const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
let mockFlag = true;

/** Backend main's coach meal routes: own rows only, archived rows hidden, DTO limits enforced. */
function mockRoute(method: string, url: string, body: Row = {}): Promise<{ data: unknown }> {
  const key = `${method} ${url}`;
  if (key in mockDb.fail) return mockDb.fail[key] === 'hang' ? new Promise(() => {}) : Promise.reject(mockDb.fail[key]);
  const [, , kind, id, sub] = url.split('/');
  const live = (rows: Row[]) => rows.filter((r) => !r.archived_at);
  const meal = live(mockDb.meals).find((m) => m.id === id);
  const bad = ['calories_kcal', 'protein_g', 'carbs_g', 'fats_g'].some((k, i) => body[k] > [2000, 300, 400, 200][i]);
  const plan = (p: Row) => ({ ...p, slots: p.slots.map((s: Row) => ({ ...s, meal_template: mockDb.meals.find((m) => m.id === s.meal_template_id) })) });
  const no = (status: number, message: string) => Promise.reject({ response: { status, data: { message } } });
  let data: unknown;
  if (kind === 'meal-templates') {
    if (method === 'GET') data = live(mockDb.meals);
    else if (bad) return no(400, 'Bad Request');
    else if (method === 'POST') mockDb.meals.push((data = { id: `m${mockDb.meals.length + 1}`, archived_at: null, ...body }) as Row);
    else if (!meal) return no(404, 'Meal template not found');
    else data = Object.assign(meal, method === 'DELETE' ? { archived_at: '2026-10-16T00:00:00.000Z' } : body);
  } else if (sub === 'assignments') data = mockDb.assignments.filter((a) => a.daily_meal_plan_id === id);
  else data = live(mockDb.plans).map(plan);
  return Promise.resolve({ data });
}
jest.mock('../../../../services/api', () => ({ __esModule: true, coachApi: {}, default: { get: (u: string) => mockRoute('GET', u),
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
  useProgramList: () => ({ data: { pages: [{ items: [], goal_tags: [] }] }, isLoading: false, error: null, refetch: jest.fn() }),
  useSavedWorkouts: () => ({ data: { pages: [{ items: [] }] }, isLoading: false, error: null, refetch: jest.fn() }),
}));

import ProgramsLibraryScreen from '../../programs/ProgramsLibraryScreen';
import MealEditor from '../../CoachMealTemplatesScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';

const meal = (id: string, name: string, k: number, p: number, c: number, f: number) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null });
const slot = (id: string, meal_template_id: string, slot_label: string, order: number) => ({ id, meal_template_id, slot_label, order });
const assign = (plan: string, client: string, ends_on: string | null = null) =>
  ({ id: `${plan}-${client}`, daily_meal_plan_id: plan, client_id: client, starts_on: '2026-10-01T00:00:00.000Z', ends_on });
const haptic = (k: 'selection' | 'success' | 'error' | 'mediumImpact') => HapticService[k] as jest.Mock;
const mount = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
const editor = (mealId?: string) => mount(<MealEditor {...({ route: { params: { mealId } }, navigation: mockNav } as any)} />);

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
  mockDb.fail = {};
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
  await fireEvent.press(s.getByTestId('programs-tab-meals'));
  await fireEvent.press(await s.findByLabelText('Overnight oats, 420 kcal · P 24 · C 62 · F 9'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealEditor', { mealId: 'm1' });
  await fireEvent.press(s.getByTestId('meal-new'));
  expect(mockNav.navigate).toHaveBeenLastCalledWith('MealEditor');
  await fireEvent.press(s.getByTestId('programs-tab-workouts'));
  expect(s.getByText('Programs')).toBeTruthy();
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

it('editing saves the meal, and Archive asks first, then archives it', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const s = await editor('m1');
  await fireEvent.changeText(await s.findByLabelText('Protein (g)'), '30');
  await fireEvent.press(s.getByTestId('meal-save'));
  await waitFor(() => expect(mockDb.meals[0].protein_g).toBe(30));
  await fireEvent.press(s.getByText('Archive this meal'));
  expect(alert).toHaveBeenCalledWith('Archive Overnight oats?', expect.any(String), expect.any(Array));
  await act(async () => (alert.mock.calls[0][2] as any)[1].onPress());
  expect(mockDb.meals[0].archived_at).toBeTruthy();
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
