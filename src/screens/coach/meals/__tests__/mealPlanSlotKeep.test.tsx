/**
 * MEALPLAN-SLOT-KEEP-M (SWEEP-MEAL-PLANS B1): every coach save of a day plan's meals keeps each meal it does not change
 * on its own row, so the foods a client logged for those meals (LoggedFoodEntry.plan_slot_id) and her grocery items
 * (ListItem.source_plan_slot_id) keep their link to the plan.
 *
 * Backend main's PATCH coach/daily-meal-plans/:id (real-meal-plans.service.ts updatePlan, FOODLINK) keeps a row only
 * while its `${slot_label}#${order}` is sent again; every other row is deleted (the links go null, onDelete: SetNull)
 * and made again under a new id. The DTO takes order 0..20 and the table is unique on (plan, slot_label, order).
 *
 * One table over every door that saves a plan's meals from the phone (MealPickerScreen.write is the only caller of
 * PATCH with slots; DayPlanBuilderScreen creates a plan with no meals and saves only its name and note; no phone path
 * reorders or copies a plan's meals): Remove, Swap (the same kind or a new one), Add a meal, and a save after the list
 * order moved. The fake server below follows updatePlan's rule line for line, so a lost row shows as a new id and a
 * collision as a lost meal or a refused save.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockSent: Row[][] = [];
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
const mockMeal = (id: string, name: string) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: 500, protein_g: 30, carbs_g: 50, fats_g: 15, fiber_g: null, items: null, created_at: '2026-11-01T00:00:00.000Z', archived_at: null });
const mockMeals = [mockMeal('m1', 'Overnight oats'), mockMeal('m2', 'Chicken rice bowl'), mockMeal('m3', 'Salmon and greens'), mockMeal('m4', 'Greek yogurt')];
let mockSlots: Row[] = [];
let mockNew = 0;
/** The plan as the server answers it: slots ordered by slot_label, then order (getPlan and updatePlan's orderBy). */
const mockPlan = () => ({ id: 'p1', coach_id: 'coach', name: 'Training day', notes: null, created_at: '2026-11-01T00:00:00.000Z', archived_at: null,
  slots: [...mockSlots].sort((a, b) => a.slot_label.localeCompare(b.slot_label) || a.order - b.order)
    .map((s) => ({ ...s, daily_meal_plan_id: 'p1', meal_template: mockMeals.find((m) => m.id === s.meal_template_id) })) });

/** Backend main's updatePlan slot write (FOODLINK), with the DTO's order range and the table's unique key. */
function mockServerPatch(body: Row) {
  const sent = body.slots as Row[];
  if (sent.some((s) => s.order !== undefined && !(Number.isInteger(s.order) && s.order >= 0 && s.order <= 20))) {
    return Promise.reject(Object.assign(new Error('order must not be greater than 20'), { response: { status: 400, data: {} } }));
  }
  const key = (s: Row) => `${s.slot_label}#${s.order}`;
  const next = sent.map((s, idx) => ({ meal_template_id: s.meal_template_id, slot_label: s.slot_label, order: s.order ?? idx, time_of_day: s.time_of_day ?? null }));
  const wanted = new Map(next.map((s) => [key(s), s]));
  const kept = new Set(mockSlots.map(key));
  const fresh = next.filter((s) => !kept.has(key(s)));
  if (new Set(fresh.map(key)).size < fresh.length) {
    return Promise.reject(Object.assign(new Error('Unique constraint failed'), { response: { status: 500, data: {} } }));
  }
  mockSlots = [
    ...mockSlots.filter((e) => wanted.has(key(e))).map((e) => ({ ...e, meal_template_id: wanted.get(key(e))!.meal_template_id })),
    ...fresh.map((s) => ({ id: `new${mockNew++}`, ...s })),
  ];
  return Promise.resolve({ data: mockPlan() });
}

jest.mock('../../../../services/api', () => ({
  __esModule: true,
  foodApi: { search: () => Promise.resolve({ data: { results: [] } }) },
  default: {
    get: (url: string) => Promise.resolve({ data: url.startsWith('/coach/meal-templates') ? mockMeals : mockPlan() }),
    patch: (_url: string, body: Row) => { mockSent.push(body.slots); return mockServerPatch(body); },
    post: () => Promise.reject(new Error('not used')),
    delete: () => Promise.reject(new Error('not used')),
  },
}));
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({}), useFocusEffect: jest.fn(), usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), SafeAreaView: require('react-native').View }));
jest.mock('../../../../components/log/QuantityPickerModal', () => ({ __esModule: true, default: () => null }));

import MealPicker from '../MealPickerScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';

const slot = (id: string, meal_template_id: string, slot_label: string, order: number) => ({ id, meal_template_id, slot_label, order, time_of_day: null });
const NAME: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const mount = (index?: number) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MealPicker {...({ route: { params: { planId: 'p1', index } }, navigation: mockNav } as any)} />
  </QueryClientProvider>,
);
/** The builder's list place of a row: the server's answer sorted by order (sortedSlots), as DayPlanBuilder passes it. */
const placeOf = (id: string) => [...mockPlan().slots].sort((a, b) => a.order - b.order).findIndex((s) => s.id === id);
/** Every row after the saves as "row id, kind, meal"; a row the server made again has a new id (new0, new1, ...). */
const rows = () => mockSlots.map((s) => `${s.id} ${s.slot_label} ${s.meal_template_id}`).sort();
/** One food she logged for each meal before the saves; a food stays linked to her plan only while its row is there. */
let logged: string[] = [];
const linked = () => logged.filter((id) => mockSlots.some((s) => s.id === id)).sort();

type Door = { remove: string } | { swap: string; meal: string; kind?: string } | { add: string; kind?: string };
/** One coach save through the picker, each tap made once the plan and the meals have loaded, as the coach sees them. */
async function save(door: Door) {
  const target = 'remove' in door ? door.remove : 'swap' in door ? door.swap : undefined;
  const s = await mount(target === undefined ? undefined : placeOf(target));
  if ('remove' in door) {
    const label = NAME[mockSlots.find((x) => x.id === door.remove)!.slot_label].toLowerCase();
    await fireEvent.press(await s.findByText(`Remove ${label}`));
  } else {
    const meal = 'add' in door ? door.add : door.meal;
    await s.findByTestId(`pick-${meal}`);
    if (door.kind) {
      const chip = NAME[door.kind];
      await fireEvent.press(s.getByLabelText(chip));
      await waitFor(() => expect(s.getByLabelText(chip).props.accessibilityState).toMatchObject({ checked: true }));
    }
    await fireEvent.press(s.getByTestId(`pick-${meal}`));
  }
  await waitFor(() => expect(mockNav.goBack).toHaveBeenCalled());
  mockNav.goBack.mockClear();
  await s.unmount();
}

const B = slot('s-b', 'm1', 'breakfast', 0);
const L = slot('s-l', 'm2', 'lunch', 1);
const D = slot('s-d', 'm3', 'dinner', 2);

const CASES: [string, Row[], Door[], string[]][] = [
  ['Remove the first meal: lunch and dinner keep their rows', [B, L, D], [{ remove: 's-b' }],
    ['s-d dinner m3', 's-l lunch m2']],
  ['Remove a middle meal: the later meal (dinner) keeps its row', [B, L, D], [{ remove: 's-l' }],
    ['s-b breakfast m1', 's-d dinner m3']],
  ['Remove the last meal (control)', [B, L, D], [{ remove: 's-d' }],
    ['s-b breakfast m1', 's-l lunch m2']],
  ['Swap a meal for another of the same kind (control)', [B, L, D], [{ swap: 's-l', meal: 'm4' }],
    ['s-b breakfast m1', 's-d dinner m3', 's-l lunch m4']],
  ['Swap in a plan whose orders are not its list places (after an earlier Remove; the server answers in kind order): every row stays',
    [B, { ...D, order: 2 }, slot('s-s', 'm4', 'snack', 5)], [{ swap: 's-b', meal: 'm2' }],
    ['s-b breakfast m2', 's-d dinner m3', 's-s snack m4']],
  ['Swap that changes the kind: the other meals keep their rows (the changed meal is a new one)', [B, L, D], [{ swap: 's-l', meal: 'm4', kind: 'snack' }],
    ['new0 snack m4', 's-b breakfast m1', 's-d dinner m3']],
  ['Swap to a kind whose order is taken (orders kept per kind): no meal is lost and the others keep their rows',
    [{ ...B, order: 0 }, { ...L, order: 0 }, { ...D, order: 0 }], [{ swap: 's-l', meal: 'm4', kind: 'dinner' }],
    ['new0 dinner m4', 's-b breakfast m1', 's-d dinner m3']],
  ['Add a meal after a Remove: it takes a free order, never the kept dinner\'s, and every row stays',
    [B, D], [{ add: 'm4', kind: 'dinner' }],
    ['new0 dinner m4', 's-b breakfast m1', 's-d dinner m3']],
  ['Add a meal when the last order is the server\'s cap (20): it takes a free order within 0..20',
    [B, { ...D, order: 20 }], [{ add: 'm4', kind: 'snack' }],
    ['new0 snack m4', 's-b breakfast m1', 's-d dinner m3']],
  ['A save after the list order moved (a kind change re-sorts the server\'s answer), then a Remove: every kept row keeps its id',
    [B, L, D], [{ swap: 's-l', meal: 'm4', kind: 'snack' }, { remove: 's-b' }],
    ['new0 snack m4', 's-d dinner m3']],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSent.length = 0;
  mockNew = 0;
  for (const k of ['selection', 'success', 'error', 'mediumImpact'] as const) jest.spyOn(HapticService, k).mockResolvedValue();
});

it.each(CASES)('%s', async (_name, start, doors, after) => {
  mockSlots = start.map((s) => ({ ...s }));
  logged = start.map((s) => s.id);
  for (const door of doors) await save(door);
  expect(HapticService.error).not.toHaveBeenCalled();
  expect(mockSent).toHaveLength(doors.length);
  // What the phone sent: every key once, every order in the DTO's range.
  for (const sent of mockSent) {
    expect(new Set(sent.map((x) => `${x.slot_label}#${x.order}`)).size).toBe(sent.length);
    expect(sent.every((x) => Number.isInteger(x.order) && x.order >= 0 && x.order <= 20)).toBe(true);
  }
  expect(rows()).toEqual(after);
  // Her logged foods stay on every meal the saves kept.
  expect(linked()).toEqual(after.map((r) => r.split(' ')[0]).filter((id) => !id.startsWith('new')).sort());
});
