/**
 * GOAL-927-M (203-D20 op 1, #203-E50): the meal plan, Macro targets and Fasting a round toward their drawings.
 * One case per CLOSE row a number or element can pin, each naming its frame and pixel rows, at 390 pt with the
 * phone's text at 100 percent and at 320 x 568 at 130 percent. Frames at context main a9434a53:
 *   C2 C_day      planning/MOCKUP3/C2/style-c/C_day_ios390_100.png (2x) and MOCK-C2/html/C_day.html (the drawn CSS);
 *   K5 C_macros   planning/MOCKUP3/K5/style-c/C_macros_ios390_100.png (2x; nearest drawing, the coach's K5 macros);
 *   C8 C_fasting  planning/MOCKUP3/C8/style-c/C_fasting_ios390_100.png (1.5x: 1.5 px = 1 pt).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { processColor, StyleSheet, type ViewStyle } from 'react-native';
import { render, screen, waitFor, within } from '@testing-library/react-native';
import { colors, gold, lightTokens } from '../../../theme/tokens';
import { clockOf } from '../../../utils/log/foodTimeline';

jest.mock('../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary,
    primary: sc.accent, surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
let mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, props) };
});
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
let mockParams: Record<string, string> | undefined;
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: mockParams }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: () => mockDaily() }));
const mockButtons: Array<{ planSlotId?: string; planned?: boolean }> = [];
jest.mock('../../../components/mealplan/LogPlannedMealButton', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    plannedMealFromSlot: (s: { meal_template: { name: string } }) => ({ name: s.meal_template.name }),
    default: (p: { meal: { name: string }; planSlotId?: string; planned?: boolean }) => {
      mockButtons.push({ planSlotId: p.planSlotId, planned: p.planned });
      return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: `Log this meal: ${p.meal.name}`,
        style: { minHeight: 44 } }, React.createElement(Text, null, p.planned ? 'Ate it as planned' : 'Log this meal'));
    },
  };
});
let mockFlag = true;
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { get foodPlanChecklist() { return mockFlag; } } }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { id: 'c1', name: 'Sam Lee' } }) }));
let mockLog: { data?: unknown; isError: boolean; isLoading: boolean } = { data: undefined, isError: false, isLoading: false };
const mockLogDates: string[] = [];
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: (date: string) => { mockLogDates.push(date); return { ...mockLog, refetch: jest.fn(), isRefetching: false }; },
}));
let mockTarget: Record<string, unknown> | null = null;
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: mockTarget, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ reportMacroDisplay: jest.fn(), useMacroDisplayMode: () => 'full' }));
const mockUser = { id: 'u1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  fastingApi: { getHistory: jest.fn(), start: jest.fn(), end: jest.fn(), deleteFast: jest.fn() },
}));
jest.mock('../../../utils/fastingAlert', () => ({ scheduleFastEndAlert: jest.fn(), cancelFastEndAlert: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../../../components/FadeInView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children);
});

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import ClientMacrosScreen from '../ClientMacrosScreen';
import FastingScreen from '../FastingScreen';
import { fastingApi } from '../../../services/api';

const mockDaily = jest.fn();
const sc = lightTokens;
// Decorative parts (marks, gutter, tiles, the now line, bones, the gold rule) are hidden from readers, as on main.
const HIDDEN = { includeHiddenElements: true } as const;
const paint = (v: unknown) => (v && typeof v === 'object' && 'payload' in (v as object) ? (v as { payload: unknown }).payload : v);
const flat = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as Record<string, unknown>;
type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] | null };
function hosts(root: unknown): Host[] {
  const out: Host[] = [];
  const walk = (n: Host | Host[] | string | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root as Host | Host[] | null);
  return out;
}

// ---------- fixtures (fictional: client Alex, coach Sam) ----------
const slot = (id: string, label: string, name: string, kcal: number, time: string | null, description: string | null = null) => ({
  id, daily_meal_plan_id: 'dp', meal_template_id: `m-${id}`, slot_label: label, order: 0, time_of_day: time,
  meal_template: { id: `m-${id}`, coach_id: 'coach', name, calories_kcal: kcal, protein_g: 30, carbs_g: 40, fats_g: 12,
    fiber_g: null, items: null, description, created_at: '2026-10-01', archived_at: null },
});
const NOTE = 'Protein at every meal. Water before coffee.';
const planOf = (slots: ReturnType<typeof slot>[], notes: string | null = NOTE) => ({
  data: { date: '2026-10-13', assignments: [{ id: 'a1', daily_meal_plan_id: 'dp', client_id: 'u1', assigned_by_coach_id: 'coach',
    starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
    daily_meal_plan: { id: 'dp', coach_id: 'coach', name: 'Training day', notes, created_at: '2026-10-01', archived_at: null, slots } }] },
  isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(),
});
const DAY = [
  slot('a', 'breakfast', 'Greek yoghurt, oats and berries', 420, '07:40'),
  slot('b', 'lunch', 'Chicken, rice and greens', 680, '12:35'),
  slot('c', 'dinner', 'Salmon, potatoes and beans', 640, '18:30', 'Salmon 150 g, new potatoes 200 g, green beans'),
];
const entry = (id: string, slotId: string | null, meal: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, food_item_id: `fi-${id}`, user_id: 'u1', meal_type: meal, quantity_multiplier: 1, logged_at: '2026-10-13T08:00:00.000Z',
  food_item: { id: `fi-${id}`, name, calories: 400, protein_g: 30, carbs_g: 40, fat_g: 10 }, plan_slot_id: slotId, ...extra,
});
const LOG = { entries: [
  entry('e1', 'a', 'breakfast', 'Greek yoghurt, oats and berries'),
  entry('e2', 'b', 'lunch', 'Chicken, rice and greens', { original_quantity: 300, original_unit: 'g' }),
  entry('e3', null, 'snack', 'Flat white'),
], total_calories: 1560, total_protein_g: 97 };
const TARGET = { id: 't1', client_id: 'u1', coach_id: 'c1', calories_kcal: 2200, protein_g: 160, carbs_g: 220, fats_g: 70,
  fiber_g: 30, notes: 'Holding steady this block.', effective_from: '2026-10-01', macro_display_mode: 'full' };

const SIZES: Array<[string, typeof mockDims]> = [
  ['390 pt at 100%', { width: 390, height: 844, scale: 2, fontScale: 1 }],
  ['320 x 568 at 130%', { width: 320, height: 568, scale: 2, fontScale: 1.3 }],
];

describe.each(SIZES)('meal plan toward C2 C_day, %s', (_size, dims) => {
  beforeEach(() => {
    mockDims = dims; mockParams = undefined; mockFlag = true; mockButtons.length = 0; mockLogDates.length = 0;
    mockTarget = TARGET; mockLog = { data: LOG, isError: false, isLoading: false };
    mockDaily.mockReturnValue(planOf(DAY));
    jest.useFakeTimers({ now: new Date(2026, 9, 13, 15, 10) });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('a: the eyebrow is the day as the Food day writes it (C_day y 128-156 px, "TODAY, TUESDAY 13 OCTOBER")', async () => {
    await render(<ClientDailyMealPlanScreen />);
    expect(within(screen.getByTestId('daily-meal-plan-masthead')).getByText('TODAY, TUESDAY 13 OCTOBER')).toHaveStyle({
      fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.98 });
    expect(screen.queryByText('MEAL PLAN')).toBeNull();
  });

  it('a: a dated drop shows that day\'s long date (C_day eyebrow, another day)', async () => {
    mockParams = { date: '2026-10-07' };
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByText('WEDNESDAY 7 OCTOBER')).toBeTruthy();
    expect(screen.getByText('Meal plan')).toBeTruthy();
  });

  it('title: Cormorant 500 at 32/40 (C_day .h1 2rem/1.25 500, y 205-262 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByText("Today's meals")).toHaveStyle({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 32, lineHeight: 40 });
  });

  it('i: the coach\'s note in curly quotes, italic 19/26 in the light ink (C_day .q 1.1875rem/1.35, y 292-332 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    const note = screen.getByTestId('daily-meal-plan-note');
    expect(note).toHaveTextContent(`“${NOTE}”`);
    expect(note).toHaveStyle({ fontSize: 19, lineHeight: 26, color: sc.textOnAccent });
  });

  it('i: a note that already has its quote marks is not quoted twice', async () => {
    mockDaily.mockReturnValue(planOf(DAY, '"Protein first."'));
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByTestId('daily-meal-plan-note')).toHaveTextContent('"Protein first."');
  });

  it('b: the left line in Inter 500 15/21 with one gold mark per meal, eaten ones filled (C_day .sum y 360-398 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByText('640 kcal and 63 g protein left.')).toHaveStyle({ fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 21 });
    const segs = screen.getAllByTestId('daily-meal-plan-seg', HIDDEN);
    expect(segs.map((s) => flat(s).width)).toEqual([18, 18, 18]);
    expect(segs.map((s) => flat(s).height)).toEqual([4, 4, 4]);
    expect(segs.map((s) => flat(s).backgroundColor)).toEqual([gold[300], gold[300], sc.data.plannedOnDark]);
    expect(mockLogDates.every((d) => d === '2026-10-13')).toBe(true);
  });

  it('b: over the target the Food day\'s over words (FoodDayView.tsx:234)', async () => {
    mockLog = { data: { ...LOG, total_calories: 2450, total_protein_g: 190 }, isError: false, isLoading: false };
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByText("250 kcal above today's target. Protein 190 of 160 g.")).toBeTruthy();
  });

  it('b: no target, no line; the day\'s log failing, no line and no filled marks (H7)', async () => {
    mockTarget = null;
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.queryByText(/protein left\.$/)).toBeNull();
    expect(screen.queryAllByTestId('daily-meal-plan-seg', HIDDEN)).toHaveLength(0);
  });

  it('c: each meal\'s coach time in the drawn time column, Inter 500 12, right-aligned (C_day .tm, x 52-156 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    const w = Math.round(54 * Math.min(Math.max(dims.fontScale, 1), 1.6));
    for (const t of ['7:40 am', '12:35 pm', '6:30 pm']) {
      expect(screen.getByText(t)).toHaveStyle({ fontFamily: 'Inter_500Medium', fontSize: 12, width: w, textAlign: 'right' });
    }
  });

  it('c: the gold now line after the last meal at or before the clock, today only (C_day .c-now y 1122-1146 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    const now = screen.getByTestId('daily-meal-plan-now', HIDDEN);
    expect(within(now).getByText('3:10 pm', HIDDEN)).toHaveStyle({ fontFamily: 'Inter_600SemiBold', color: sc.accentText });
    const order = hosts(screen.toJSON()).map((n) => n.props.testID).filter((id) => typeof id === 'string'
      && /^daily-meal-plan-(now|mark-)/.test(id as string));
    expect(order).toEqual(['daily-meal-plan-mark-a', 'daily-meal-plan-mark-b', 'daily-meal-plan-now', 'daily-meal-plan-mark-c']);
    expect(within(now).queryByRole('button', HIDDEN)).toBeNull();
  });

  it('c: one meal with no time: no time for it and no now line (RULING 5, H6)', async () => {
    mockDaily.mockReturnValue(planOf([DAY[0], { ...DAY[1], time_of_day: null }, DAY[2]]));
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.queryByText('12:35 pm')).toBeNull();
    expect(screen.queryByTestId('daily-meal-plan-now', HIDDEN)).toBeNull();
  });

  it('d: an eaten meal\'s mark fills forest, an uneaten one stays hollow; 14 pt marks (C_day .mk 14 px, y 484-510 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByTestId('daily-meal-plan-mark-a', HIDDEN)).toHaveStyle({ width: 14, height: 14, borderWidth: 1.5, backgroundColor: sc.accent });
    expect(screen.getByTestId('daily-meal-plan-mark-b', HIDDEN)).toHaveStyle({ backgroundColor: sc.accent });
    expect(screen.getByTestId('daily-meal-plan-mark-c', HIDDEN)).toHaveStyle({ width: 14, backgroundColor: sc.bgSurface });
    expect(screen.getByText('Logged as planned')).toHaveStyle({ fontSize: 13 });
    expect(screen.getByText(/^Logged with a change: /)).toBeTruthy();
  });

  it('d: switch off (RULING 4 (i)): every mark hollow, no done lines, every meal keeps Log this meal', async () => {
    mockFlag = false;
    await render(<ClientDailyMealPlanScreen />);
    for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(`daily-meal-plan-mark-${id}`, HIDDEN)).toHaveStyle({ backgroundColor: sc.bgSurface });
    expect(screen.queryByText('Logged as planned')).toBeNull();
    expect(mockButtons.some((b) => b.planned)).toBe(false);
  });

  it('e: "Ate it as planned" on the next meal only, on the drawn cream card with its description (C_day .c-next y 1304-1515 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    expect([...new Set(mockButtons.filter((b) => b.planned).map((b) => b.planSlotId))]).toEqual(['c']);
    const card = screen.getByTestId('daily-meal-plan-next-card');
    expect(card).toHaveStyle({ backgroundColor: colors.cream, borderRadius: 16 });
    expect(within(card).getByText('Salmon 150 g, new potatoes 200 g, green beans')).toBeTruthy();
    expect(within(card).getByText('Ate it as planned')).toBeTruthy();
  });

  it('e: on another day every meal keeps main\'s link (the button logs to today, RULING 6)', async () => {
    mockParams = { date: '2026-10-12' };
    await render(<ClientDailyMealPlanScreen />);
    expect(mockButtons.some((b) => b.planned)).toBe(false);
    expect(screen.queryByTestId('daily-meal-plan-now', HIDDEN)).toBeNull();
  });

  it('f: the gutter is a dotted line drawn in svg, not a solid bar (C_day .c-tl:before 1.5px dotted, x 172-174 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    const lines = screen.getAllByTestId('plan-gutter-line', HIDDEN);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) {
      expect(flat(l).backgroundColor).toBeUndefined();
      const dashed = hosts(l).some((n) => n.props.strokeDasharray != null);
      expect(dashed).toBe(true);
    }
  });

  it('the cream tile at 52 pt, radius 12 (C_day .c-th span 52px, y 480-584 px)', async () => {
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByTestId('daily-meal-plan-art-a', HIDDEN)).toHaveStyle({ width: 52, height: 52, borderRadius: 12, backgroundColor: colors.cream });
  });

  it('g: loading draws the masthead bones (C_loading) and keeps the block\'s Loading label', async () => {
    mockDaily.mockReturnValue({ data: undefined, isLoading: true, isError: false, isRefetching: false, refetch: jest.fn() });
    await render(<ClientDailyMealPlanScreen />);
    expect(within(screen.getByTestId('daily-meal-plan-masthead')).getAllByTestId('plan-mast-bone', HIDDEN).length).toBe(2);
    expect(screen.queryByText("Today's meals")).toBeNull();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('h: P7 keeps main\'s words, with the day eyebrow on the masthead', async () => {
    mockParams = { assignmentId: 'gone' };
    await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByText('This plan is not available for this day')).toBeTruthy();
    expect(screen.getByText('TODAY, TUESDAY 13 OCTOBER')).toBeTruthy();
  });
});

describe.each(SIZES)('Macro targets toward K5 C_macros (nearest drawing, the coach\'s K5 macros), %s', (_size, dims) => {
  beforeEach(() => {
    mockDims = dims; mockTarget = TARGET;
    mockLog = { data: { total_calories: 2380, total_protein_g: 171, total_carbs_g: 196, total_fat_g: 74 }, isError: false, isLoading: false };
  });

  it('a: the deep forest masthead with its rounded foot (K5 #1C3023 y 0-603 px; foot radius 24 pt, x 20-39 px at y 595-603)', async () => {
    await render(<ClientMacrosScreen />);
    expect(screen.getByTestId('macros-masthead')).toHaveStyle({ backgroundColor: lightTokens.surface.masthead,
      borderBottomLeftRadius: 24, borderBottomRightRadius: 24 });
  });

  it('a: the route\'s bar takes the same deep forest (ClientNavigator ClientMacros options)', () => {
    const nav = fs.readFileSync(path.resolve(__dirname, '../../../navigation/ClientNavigator.tsx'), 'utf8');
    const line = nav.split('\n').find((l) => l.includes('name="ClientMacros"')) ?? '';
    expect(line).toContain("backOnlyHeader('Macro targets', lightTokens.surface.masthead)");
  });

  it('b: "2,200" grouped as K5 writes "2,100", Cormorant at 52 pt (K5 digit height 67 px at 2x, y 252-318)', async () => {
    await render(<ClientMacrosScreen />);
    expect(screen.getByText('2,200')).toHaveStyle({ fontSize: 52 });
    expect(screen.getByText('2,380 kcal eaten today')).toBeTruthy();
  });

  it.each([[999, '999'], [1000, '1,000']])('b: %s kcal reads "%s" (H9)', async (kcal, shown) => {
    mockTarget = { ...TARGET, calories_kcal: kcal };
    await render(<ClientMacrosScreen />);
    expect(screen.getByText(shown)).toBeTruthy();
  });

  it('c: the cards sit on the page in the paper colour (K5 cards #FFFDF8 on the page, y 632+ px)', async () => {
    await render(<ClientMacrosScreen />);
    expect(screen.getByTestId('macros-cells')).toHaveStyle({ backgroundColor: sc.bgSurface });
  });

  it('the outlined tiles at K5\'s 56 pt (y 362-473 px)', async () => {
    await render(<ClientMacrosScreen />);
    expect(screen.getByTestId('macros-tile-protein')).toHaveStyle({ minHeight: 56 });
  });
});

describe.each(SIZES)('Fasting toward C8 C_fasting, %s', (_size, dims) => {
  const H = 3600000;
  const at = (d: Date) => clockOf(d.getHours() * 60 + d.getMinutes());
  let start: Date;
  beforeEach(() => {
    mockDims = dims;
    start = new Date(Date.now() - (5 * 60 + 15) * 60000);
    const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(8, 0, 0, 0); return d; };
    (fastingApi.getHistory as jest.Mock).mockResolvedValue({ data: [
      { id: 'run', protocol: '16:8', start_time: start.toISOString(), end_time: null },
      { id: 'f1', protocol: '16:8', start_time: day(1).toISOString(), end_time: new Date(day(1).getTime() + 16.2 * H).toISOString() },
      { id: 'f2', protocol: '16:8', start_time: day(2).toISOString(), end_time: new Date(day(2).getTime() + 16 * H).toISOString() },
      { id: 'f3', protocol: '16:8', start_time: '2026-10-11T08:00:00', end_time: '2026-10-11T20:30:00' },
    ] });
  });
  const ready = async () => {
    await render(<FastingScreen />);
    await waitFor(() => expect(screen.getByTestId('fasting-scroll')).toBeTruthy());
  };

  it('a: the gold ring, 150 pt across with a 9 pt stroke, on the paper (C8 x 36-260 px, stroke 273-285 px at x 148)', async () => {
    await ready();
    const ring = screen.getByTestId('fasting-ring');
    expect(ring).toHaveStyle({ width: 150, height: 150 });
    const circles = hosts(ring).filter((n) => n.props.strokeWidth != null);
    expect(circles.map((c) => paint(c.props.stroke))).toEqual(expect.arrayContaining([processColor(sc.border), processColor(sc.data.goal)]));
    expect(circles.every((c) => Number(c.props.strokeWidth) === 9)).toBe(true);
    expect(within(screen.getByTestId('fasting-masthead')).queryByText('5h 15m')).toBeNull();
  });

  it('a: the elapsed time in the serif with "of 16 h" under it; the percent is the ring\'s value (C8 y 357-415 px)', async () => {
    await ready();
    expect(screen.getByText('5h 15m')).toHaveStyle({ fontFamily: 'CormorantGaramond_400Regular', fontSize: 24 });
    expect(screen.getByText('of 16 h')).toHaveStyle({ fontSize: 13 });
    expect(screen.getByTestId('fasting-timer').props.accessibilityValue).toEqual({ text: '33 percent' });
  });

  it('b: the side column: Ends, Started and the run line (C8 x 285+ px, y 307-468 px)', async () => {
    await ready();
    const side = screen.getByTestId('fasting-side');
    const end = new Date(start.getTime() + 16 * H);
    expect(within(side).getByText(`Ends ${at(end)}`)).toHaveStyle({ fontFamily: 'Inter_600SemiBold', fontSize: 17 });
    const weekday = start.toLocaleDateString('en-US', { weekday: 'long' });
    expect(within(side).getByText(`Started ${weekday}, ${at(start)}`)).toHaveStyle({ fontSize: 16, color: sc.textMuted });
    expect(within(side).getByText('2 days in a row with a completed fast')).toBeTruthy();
    expect(within(screen.getByTestId('fasting-masthead')).queryByText(/days in a row/)).toBeNull();
  });

  it('c: End fast is outlined, forest words on the paper, radius 12, 54 pt (C8 y 519-599 px)', async () => {
    await ready();
    const btn = screen.getByLabelText('End fast');
    expect(btn).toHaveStyle({ borderWidth: 1, borderColor: sc.accent, borderRadius: 12, minHeight: 54 });
    expect(flat(btn).backgroundColor).toBeUndefined();
    expect(within(btn).getByText('End fast')).toHaveStyle({ color: sc.accentText });
    expect(screen.getByTestId('fasting-gold-rule', HIDDEN)).toHaveStyle({ height: 1, backgroundColor: sc.data.goal });
  });

  it('d: recent fasts are plain rows with a hairline, short date left and hours with a space right (C8 y 653-850 px)', async () => {
    await ready();
    expect(screen.getByText('Sun, Oct 11')).toHaveStyle({ fontFamily: 'Inter_400Regular', fontSize: 16 });
    expect(screen.getByText('12.5 h')).toHaveStyle({ fontFamily: 'Inter_500Medium', fontSize: 16 });
    expect(screen.getByTestId('fasting-history-f3')).toHaveStyle({ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border });
    const gutters = hosts(screen.getByTestId('fasting-history-f3')).filter((n) => flat(n).width === 24 && n.props.accessibilityElementsHidden);
    expect(gutters).toHaveLength(0);
    expect(screen.getByTestId('remove-fast-f3')).toBeTruthy();
    expect(screen.getByTestId('remove-fast-run')).toBeTruthy();
  });

  it('f: with no fast running, Start fast is outlined too, under main\'s window on the paper (RULING 12)', async () => {
    (fastingApi.getHistory as jest.Mock).mockResolvedValue({ data: [] });
    await ready();
    const btn = screen.getByLabelText('Start fast');
    expect(btn).toHaveStyle({ borderWidth: 1, borderColor: sc.accent, borderRadius: 12, minHeight: 54 });
    expect(within(screen.getByTestId('fasting-masthead')).queryByText('Fasting window')).toBeNull();
    expect(screen.getByText('Fasting window')).toBeTruthy();
    expect(screen.queryByTestId('fasting-ring')).toBeNull();
  });

  it('title: Cormorant 500 at 32 on a short masthead with no gold rule (C8 "Fasting" cap 183-212 px at 1.5x)', async () => {
    await ready();
    expect(screen.getByTestId('fasting-title')).toHaveStyle({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 32 });
  });
});
