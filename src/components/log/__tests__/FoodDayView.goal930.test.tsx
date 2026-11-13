// GOAL-930-M (owner #203-E50 "op 1 to all": the Food day a round toward its picked C2 Style C drawing, after
// RENDER-LOOK-4 graded it OFF). D1: C_first's drawn tool tiles (C_first.html :121-122 .c-big2) with the one tile whose
// feature is on phone main, Enter manually; Photo of a meal (MEAL-PHOTO-M) and Scan a barcode (203-D22) are not drawn.
// D2: C_first's gutter words beside the three empty meals (C_first.html :155, .c-e .tm "Morning", "Midday",
// "Evening"; :88 Inter 500 12 muted), hidden from the screen reader. D3: C_usual's time beside each usual meal still
// to eat (C_usual.html :155, "12:30 pm" and "7:00 pm").
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { colors } from '../../../theme/tokens';
import { getTodayString } from '../../../utils/date';
import type { FoodLog } from '../../../types';

const mockGet = jest.fn();
const mockDaily = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) }, logApi: { getDaily: (...a: unknown[]) => mockDaily(...a) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
// The [R41] phone sizes: 390 and 320 wide, 100 and 130 percent text.
let mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

// A fixed clock, never the real date (FIX-930R2 LO-930R2 B1 class). Only Date is faked.
jest.useFakeTimers({ now: new Date('2026-11-05T08:20:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const today = getTodayString();

mockGet.mockImplementation(async (url: string) => {
  if (url === '/assignments/me') return { data: { items: [], nextCursor: null } };
  throw new Error(`unexpected GET ${url}`);
});
const props = { onDateChange: jest.fn(), onLogPlanned: jest.fn(), onRepeat: jest.fn(), onSomethingElse: jest.fn(), onEditFood: jest.fn() };
type Over = Partial<React.ComponentProps<typeof FoodDayGate>>;
async function show(over: Over = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached={false} selectedDate={today} foodLogs={[]} eaten={{ calories: 0, protein: 0 }} targets={null}
        ready saving={false} notes={null} water={<Text>Water card</Text>} nowMin={8 * 60 + 20} {...props} {...over}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
}
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) ?? {};
const log = (id: string, mealType: FoodLog['mealType'], foodName: string, hhmm: string, extra: Partial<FoodLog> = {}): FoodLog => ({
  id, userId: 'u', coachId: '', date: today, mealType, foodName, calories: 380, protein: 20, carbs: 30, fat: 10,
  quantity: 1, unit: 'serving', createdAt: `${today}T${hhmm}:00`, ...extra,
});
// The gutter words are hidden from the screen reader, so their queries include hidden elements.
const H = { includeHiddenElements: true } as const;
const DRAWN_OUT = ['Photo of a meal', 'Scan a barcode', 'Keep on plate for later'];
const noDrawnOut = () => {
  for (const words of DRAWN_OUT) {
    expect(screen.queryByText(new RegExp(words, 'i'), H)).toBeNull();
    expect(screen.queryByLabelText(new RegExp(words, 'i'), H)).toBeNull();
  }
  expect(screen.queryAllByTestId(/photo/i, H)).toHaveLength(0);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
  mockDaily.mockResolvedValue({ data: { entries: [] } });
});

describe('D1 C_first: the drawn tool tiles, with the one tile whose feature is on phone main', () => {
  it('three equal columns, gap 8 (.c-big2 :121); Enter manually in the first, laid out from the left', async () => {
    await show();
    const row = await screen.findByTestId('food-day-first-tools');
    expect(flat(row)).toEqual(expect.objectContaining({ flexDirection: 'row', gap: 8 }));
    const cells = screen.getAllByTestId('food-day-first-tool-cell');
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(flat(c).flex).toBe(1);
    expect(within(cells[0]).getByTestId('food-day-first-manual')).toBeTruthy();
    // Columns 2 and 3 hold their place, empty: never a dead tile, never "soon" (REFINE-968 ruling 4).
    for (const c of cells.slice(1)) {
      expect(within(c).queryAllByRole('button')).toHaveLength(0);
      expect(within(c).queryAllByText(/./)).toHaveLength(0);
    }
  });

  it('the tile: 1 pt forest border, corner 16, at least 72 tall, padding 8 12, glyph above the label gap 6 (.c-big2 a :122)', async () => {
    await show();
    const tile = await screen.findByTestId('food-day-first-manual');
    const s = flat(tile);
    expect(s).toEqual(expect.objectContaining({ borderWidth: 1, borderColor: colors.forest, borderRadius: 16, minHeight: 72,
      paddingVertical: 8, paddingHorizontal: 12, gap: 6, alignItems: 'flex-start', justifyContent: 'center' }));
    expect(s.flexDirection ?? 'column').toBe('column');
    // The app's create-outline at the drawn 24, above the words (C2-S-28, main's).
    const glyph = screen.UNSAFE_getByProps({ name: 'create-outline' });
    expect(glyph.props.size).toBe(24);
    const words = within(tile).getByText('Enter manually');
    const type = flat(words);
    expect(type.fontFamily).toBe('Inter_500Medium');
    expect(type.fontSize).toBe(15);
    expect(Math.abs((type.lineHeight as number) - 18.75)).toBeLessThanOrEqual(1);
    expect(type.color).toBe(colors.forest);
  });

  it('keeps main\'s label, role, testID and handler: the manual form for the next meal with nothing yet', async () => {
    await show();
    const tile = await screen.findByLabelText('Enter manually');
    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.testID).toBe('food-day-first-manual');
    await fireEvent.press(tile);
    expect(props.onSomethingElse).toHaveBeenLastCalledWith('breakfast', undefined, true);
  });

  it.each([
    ['390 pt at 130%', { width: 390, fontScale: 1.3 }],
    ['320 pt at 100%', { width: 320, fontScale: 1 }],
    ['320 pt at 130%', { width: 320, fontScale: 1.3 }],
  ])('%s: the tile takes two shares so "manually" stays on one line', async (_label, size) => {
    mockWindow = { ...mockWindow, ...size };
    await show();
    const cells = await screen.findAllByTestId('food-day-first-tool-cell');
    expect(cells.map((c) => flat(c).flex)).toEqual([2, 1, 1]);
  });

  it('nothing drawn for a feature phone main does not have; every pressable on the first day does something (KT-3)', async () => {
    await show();
    await screen.findByTestId('food-day-first-tools');
    noDrawnOut();
    const handlers = Object.values(props);
    const all = [...screen.getAllByRole('button'), ...screen.getAllByRole('search')];
    expect(all.length).toBeGreaterThan(0);
    for (const node of all) {
      handlers.forEach((h) => h.mockClear());
      await fireEvent.press(node);
      expect(handlers.reduce((n, h) => n + h.mock.calls.length, 0)).toBeGreaterThan(0);
    }
  });
});

describe('D2 C_first: Morning, Midday and Evening in the gutter beside empty meals', () => {
  it('each empty meal shows its drawn word in the time gutter, hidden from the reader; its spoken label stays main\'s', async () => {
    await show();
    for (const [meal, word, label] of [['breakfast', 'Morning', 'Breakfast'], ['lunch', 'Midday', 'Lunch'], ['dinner', 'Evening', 'Dinner']]) {
      const row = await screen.findByTestId(`food-day-first-${meal}`);
      const w = within(row).getByText(word, H);
      expect(w.props.accessibilityElementsHidden).toBe(true);
      expect(w.props.importantForAccessibility).toBe('no-hide-descendants');
      // .c-e .tm (:88): the gutter's own type, the same Text style a log time uses.
      expect(flat(w)).toEqual(expect.objectContaining({ fontSize: 12, textAlign: 'right', color: expect.any(String) }));
      expect(row.props.accessibilityLabel).toBe(`${label}. Nothing yet`);
    }
  });

  it('once a meal has a log its log time shows and its word goes (main :298)', async () => {
    await show({ foodLogs: [log('5', 'lunch', 'Tomato soup', '12:05')], eaten: { calories: 380, protein: 20 }, nowMin: 13 * 60 });
    const lunch = await screen.findByTestId('food-day-first-lunch');
    expect(within(lunch).getByText('12:05 pm')).toBeTruthy();
    expect(within(lunch).queryByText('Midday', H)).toBeNull();
    expect(within(screen.getByTestId('food-day-first-breakfast')).getByText('Morning', H)).toBeTruthy();
    expect(within(screen.getByTestId('food-day-first-dinner')).getByText('Evening', H)).toBeTruthy();
    expect(screen.getAllByText(/^(Morning|Midday|Evening)$/, H)).toHaveLength(2);
    // Hidden from the reader: no query that skips hidden elements finds them.
    expect(screen.queryAllByText(/^(Morning|Midday|Evening)$/)).toHaveLength(0);
  });
});

describe('D3 C_usual: a time beside each usual meal still to eat', () => {
  const Y = '2026-11-04';
  const S = '2026-11-01';
  const food = (id: string, name: string, kcal: number) => ({ id, name, calories_per_serving: kcal, protein: 20, carbs: 30, fat: 10, nutrient_basis: 'PER_SERVING' });
  const entry = (meal: string, id: string, name: string, kcal: number, at?: string) => ({ meal_type: meal, food_item_id: id, quantity_multiplier: 1,
    original_quantity: 1, original_unit: 'serving', food_item: food(id, name, kcal), ...(at ? { logged_at: at } : {}) });
  const week = (timed: boolean) => (date: string) => ({ data: { entries: date === Y || date === S ? [
    entry('breakfast', 'oats', 'Overnight oats', 380, timed ? `${date}T08:05:00` : undefined),
    entry('lunch', 'wrap', 'Turkey and hummus wrap, apple', 565, timed ? `${date}T${date === Y ? '12:30' : '13:15'}:00` : undefined),
    entry('dinner', 'curry', 'Chickpea and spinach curry', 540, timed ? `${date}T19:00:00` : undefined),
  ] : [] } });
  const oats = log('b1', 'breakfast', 'Overnight oats', '08:05', { fillsUsualMeal: true });
  const order = () => screen.getAllByTestId(/^food-day-(slot|extra|now|workout|next)\b/).map((n) => n.props.testID as string);

  it('12:10 pm: breakfast at its log time, the now line, Up next lunch at 12:30 pm, dinner at 7:00 pm', async () => {
    mockDaily.mockImplementation(async (date: string) => week(true)(date));
    await show({ foodLogs: [oats], eaten: { calories: 380, protein: 20 }, targets: { calories: 2000, protein: 120 }, nowMin: 12 * 60 + 10 });
    expect(await screen.findByText('Your usual day')).toBeTruthy();
    expect(order()).toEqual(['food-day-slot-breakfast', 'food-day-now', 'food-day-next', 'food-day-slot-dinner']);
    const next = screen.getByTestId('food-day-next');
    expect(within(next).getByText('UP NEXT, YOUR USUAL LUNCH')).toBeTruthy();
    expect(within(next).getByText('12:30 pm')).toBeTruthy();
    const dinner = screen.getByTestId('food-day-slot-dinner');
    expect(within(dinner).getByText('7:00 pm')).toBeTruthy();
    // FoodDayView.tsx:384: a timed meal's spoken label starts with its time, as a timed plan meal's does.
    expect(dinner.props.accessibilityLabel).toMatch(/^7:00 pm\. Dinner\. Your usual: Chickpea and spinach curry\./);
    noDrawnOut();
  });

  it('3:10 pm: the usual lunch at 12:30 pm sits above the now line and is still Up next', async () => {
    mockDaily.mockImplementation(async (date: string) => week(true)(date));
    await show({ foodLogs: [oats], eaten: { calories: 380, protein: 20 }, targets: { calories: 2000, protein: 120 }, nowMin: 15 * 60 + 10 });
    expect(await screen.findByText('Your usual day')).toBeTruthy();
    expect(order()).toEqual(['food-day-slot-breakfast', 'food-day-next', 'food-day-now', 'food-day-slot-dinner']);
    expect(within(screen.getByTestId('food-day-next')).getByText('12:30 pm')).toBeTruthy();
  });

  it('past days with no logged_at: no time and main\'s order', async () => {
    mockDaily.mockImplementation(async (date: string) => week(false)(date));
    await show({ foodLogs: [oats], eaten: { calories: 380, protein: 20 }, targets: { calories: 2000, protein: 120 }, nowMin: 15 * 60 + 10 });
    expect(await screen.findByText('Your usual day')).toBeTruthy();
    expect(order()).toEqual(['food-day-slot-breakfast', 'food-day-now', 'food-day-next', 'food-day-slot-dinner']);
    expect(within(screen.getByTestId('food-day-next')).queryByText(/\d:\d\d [ap]m/)).toBeNull();
    expect(within(screen.getByTestId('food-day-slot-dinner')).queryByText(/\d:\d\d [ap]m/)).toBeNull();
  });
});
