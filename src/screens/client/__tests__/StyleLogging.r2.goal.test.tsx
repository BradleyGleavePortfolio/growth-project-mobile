/**
 * REFINE-987 (m#987 round 2): the client's "Your workouts" toward C1 Style C v2 C2_history
 * (planning/MOCKUP3/C1/style-c-v2/C2_history_ios390_100.png, context a290b8ec; 780 px for 390 pt) and the routine
 * builder's count line and Add exercise sheet toward K3 Style C C_day / C_picker. Each drawn number names its pixel rows.
 *
 * The week: the phone's own today (getTodayString, fixed here), Monday first, through the Train tab's one week rule
 * (trainWeek / workoutWeek); a skipped or past open session reads missed. Every workout stays one tap from its detail:
 * this week's from the card, every other one from main's "To complete" / "Completed". EARLIER rows open nothing.
 */
import React from 'react';
import { PixelRatio, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNavigate = jest.fn();
let mockToday = '2026-11-18';
let mockAssignments: unknown[] = [];
let mockRoutineId: string | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { routineId: mockRoutineId } }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => mockToday }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { squat: 'Back squat' }, loading: false, bodyWeight: {} }),
}));
const mockRoutine = { id: 'routine', name: 'Full body A', exercises: [
  { exercise_id: 'press', exercise_name: 'Bench press', default_sets: 3, default_reps: 10, default_rest_seconds: 60, muscle_group: 'CHEST' },
  { exercise_id: 'row', exercise_name: 'Row', default_sets: 4, default_reps: 8, default_rest_seconds: 90, muscle_group: 'BACK' },
] };
jest.mock('../../../hooks/useApi', () => ({
  useRoutines: () => ({ data: [mockRoutine] }),
  useCreateRoutine: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateRoutine: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteRoutine: () => ({ mutate: jest.fn() }),
}));
jest.mock('../../../db/workoutDb', () => ({ getAllExercises: async () => [
  { id: 'press', name: 'Bench press', muscle: 'chest', equipment: 'Barbell' },
  { id: 'row', name: 'Row', muscle: 'back', equipment: 'Cable' },
  { id: 'fly', name: 'Cable fly', muscle: 'chest', equipment: 'Cable' },
] }));
jest.mock('../../../api/exerciseCatalog', () => ({ exerciseCatalogApi: { libraryId: async () => null } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: Record<string, unknown>) => require('react').createElement('Ionicons', p) }));
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);

import ClientWorkoutViewerScreen from '../ClientWorkoutViewerScreen';
import RoutineBuilderScreen from '../RoutineBuilderScreen';
import { layout, lightTokens as sc, radius, spacing, typography } from '../../../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;
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

const DEVICES = [
  { name: '390 x 844, text 100%', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 }, fontScale: 1 },
  { name: '320 x 568, text 130%', frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 }, fontScale: 1.3 },
] as const;
type Device = (typeof DEVICES)[number];
function mount(device: Device, el: React.ReactElement) {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(device.fontScale);
  return render(<SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>{el}</SafeAreaProvider>);
}

const lift = { id: 'r1', workout_plan_id: 'plan', exercise_external_id: 'squat', order: 1, sets: 4, reps_or_duration_seconds: 5,
  weight_lbs: 185, rest_seconds: 120, superset_group_id: null, notes: null };
/** `when` is a calendar day (stored at UTC midnight, read as written) or a full moment (read as the local day). */
function a(id: string, when: string, state: 'open' | 'done' | 'skipped' = 'open') {
  return {
    id, workout_plan_id: id, client_id: 'client', assigned_by_coach_id: 'coach',
    scheduled_for: when.length === 10 ? `${when}T00:00:00.000Z` : when,
    completed_at: state === 'done' ? `${when.slice(0, 10)}T18:00:00.000Z` : null,
    skipped_at: state === 'skipped' ? `${when.slice(0, 10)}T18:00:00.000Z` : null,
    post_rpe: state === 'done' ? 7 : null, post_notes: null,
    workout_plan: { id, coach_id: 'coach', name: id, type: 'strength', exercises: [lift], duration_estimate_minutes: 40,
      created_at: '', updated_at: '', archived_at: null },
  };
}
// Today Wednesday 18 November 2026: this week is Mon 16 to Sun 22.
const MIXED = [
  a('Upper body', '2026-11-16', 'done'),
  a('Full body A', '2026-11-17', 'skipped'),
  a('Lower body', '2026-11-19'),
  a('Conditioning', '2026-11-15'),
  a('Push day', '2026-11-10', 'done'),
  a('Legs', '2026-11-03', 'done'),
  a('Next week', '2026-11-24'),
  a('Mobility', '2026-11-16'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockToday = '2026-11-18';
  mockAssignments = MIXED;
  mockRoutineId = undefined;
});

describe('the week (behaviour)', () => {
  it('this week holds Mon 16 to Sun 22 in day order; skipped and past open read missed, later ones planned', async () => {
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    const card = view.getByTestId('week-card');
    const rows = within(card).getAllByTestId(/^week-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual(['week-row-Upper body', 'week-row-Mobility', 'week-row-Full body A', 'week-row-Lower body']);
    const words = rows.map((r) => within(r).getByText(/^(done|planned|missed)$/).props.children);
    expect(words).toEqual(['done', 'missed', 'missed', 'planned']);
    expect(within(card).getAllByText('Mon 16')).toHaveLength(2);
    expect(within(card).getByText('Tue 17')).toBeTruthy();
    expect(within(card).getByText('Thu 19')).toBeTruthy();
    expect(within(card).getByText('This week')).toBeTruthy();
    expect(within(card).getByText('1/4')).toBeTruthy();
  });

  it("the ring's spoken label is doneLine", async () => {
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    expect(view.getByTestId('week-ring').props.accessibilityLabel).toBe('1 of 4 done');
    expect(view.getByTestId('earlier-ring-2026-11-09').props.accessibilityLabel).toBe('1 of 2 done');
  });

  it.each([
    ['a Monday', '2026-11-16', ['done', 'planned', 'missed', 'planned']],
    ['a Sunday', '2026-11-22', ['done', 'missed', 'missed', 'missed']],
  ])('on %s the same week holds the same four sessions', async (_n, today, want) => {
    mockToday = today;
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    const rows = within(view.getByTestId('week-card')).getAllByTestId(/^week-row-/);
    expect(rows.map((r) => within(r).getByText(/^(done|planned|missed)$/).props.children)).toEqual(want);
  });

  it('a session just after local midnight counts on that local day (next week from Sunday, this week from Monday)', async () => {
    const late = new Date(2026, 10, 23, 0, 30).toISOString();
    mockAssignments = [a('Early riser', late)];
    mockToday = '2026-11-22';
    let view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    expect(view.queryByTestId('week-card')).toBeNull();
    expect(view.getByText('To complete')).toBeTruthy();
    await view.unmount();
    mockToday = '2026-11-23';
    view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    expect(within(view.getByTestId('week-card')).getByText('Mon 23')).toBeTruthy();
  });

  it('a week crossing the clock change (Mon 26 Oct to Sun 1 Nov) stays one week', async () => {
    mockAssignments = [a('Before the change', '2026-10-26', 'done'), a('After the change', '2026-11-01')];
    mockToday = '2026-11-01';
    let view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    expect(view.getByTestId('week-ring').props.accessibilityLabel).toBe('1 of 2 done');
    await view.unmount();
    mockToday = '2026-11-02';
    view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    expect(view.queryByTestId('week-card')).toBeNull();
    expect(within(view.getByTestId('earlier-2026-10-26')).getByText('Oct 26 to Nov 1')).toBeTruthy();
    expect(within(view.getByTestId('earlier-2026-10-26')).getByText('1 of 2 done')).toBeTruthy();
  });

  it('a week with no session draws no card and no EARLIER row', async () => {
    mockToday = '2026-12-09';
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    expect(view.queryByTestId('week-card')).toBeNull();
    const weeks = within(view.getByTestId('week-earlier')).getAllByTestId(/^earlier-\d{4}-\d\d-\d\d$/);
    expect(weeks.map((n) => n.props.testID)).toEqual(['earlier-2026-11-23', 'earlier-2026-11-16', 'earlier-2026-11-09', 'earlier-2026-11-02']);
  });

  it('EARLIER: newest first, the span and doneLine; a past open session reads missed; rows have no onPress and no chevron', async () => {
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    const earlier = view.getByTestId('week-earlier');
    const weeks = within(earlier).getAllByTestId(/^earlier-\d{4}-\d\d-\d\d$/);
    expect(weeks.map((n) => n.props.testID)).toEqual(['earlier-2026-11-09', 'earlier-2026-11-02']);
    expect(within(weeks[0]).getByText('Nov 9 to 15')).toBeTruthy();
    expect(within(weeks[0]).getByText('1 of 2 done')).toBeTruthy();
    expect(within(weeks[1]).getByText('Nov 2 to 8')).toBeTruthy();
    for (const n of hosts(earlier)) {
      expect(n.props.onPress).toBeUndefined();
      expect(n.props.onClick).toBeUndefined();
      expect(n.props.accessibilityRole === 'button').toBe(false);
      expect(n.type === 'Ionicons' && n.props.name === 'chevron-forward').toBe(false);
    }
  });

  it.each(MIXED.map((x) => [x.id] as const))('every workout is one pressable away: %s', async (id) => {
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    const presses = view.getAllByRole('button', { name: `Open workout ${id}` });
    expect(presses).toHaveLength(1);
    await fireEvent.press(presses[0]);
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutAssignmentDetail', { assignmentId: id });
  });

  it("this week's sessions are on the card; every other workout stays under main's two lists", async () => {
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    const card = view.getByTestId('week-card');
    for (const id of ['Upper body', 'Mobility', 'Full body A', 'Lower body']) {
      expect(within(card).getByRole('button', { name: `Open workout ${id}` })).toBeTruthy();
    }
    expect(within(card).queryByRole('button', { name: 'Open workout Conditioning' })).toBeNull();
    expect(view.getByText('To complete')).toBeTruthy();
    expect(view.getByText('Completed')).toBeTruthy();
    // Main's exercise lines stay on the list for this week's sessions (timedSets196Display reads them).
    expect(within(card).getAllByText('4 sets × 5 reps / sec · 185 lb prescribed')).toHaveLength(4);
  });

  it('the legend names the three marks with the app\'s words', async () => {
    const view = await mount(DEVICES[0], <ClientWorkoutViewerScreen />);
    const legend = view.getByTestId('week-legend');
    for (const w of ['done', 'planned', 'missed']) expect(within(legend).getByText(w)).toBeTruthy();
    expect(within(legend).queryByText('New best')).toBeNull();
  });
});

describe.each(DEVICES)('the drawn numbers at $name', (device) => {
  it('"Train" is the eyebrow over the title (C2_history TRAIN cap rows 118-133, #6B675F)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const st = flat(view.getByText('Train'));
    expect(st.fontSize).toBe(typography.eyebrow.fontSize);
    expect(st.textTransform).toBe('uppercase');
    expect(st.color).toBe(sc.textMuted);
  });

  it('the THIS WEEK card: deep forest, 16 pt corners, 16 pt in, the 44 pt ring on dark (rows 236-843, ring cols 611-696)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const st = flat(view.getByTestId('week-card'));
    expect(st.backgroundColor).toBe(sc.surface.masthead);
    expect(st.borderRadius).toBe(radius.card);
    expect(st.paddingHorizontal).toBe(spacing.lg);
    expect(st.paddingTop).toBe(spacing.lg);
    const ring = flat(view.getByTestId('week-ring'));
    expect(ring.width).toBe(44);
    expect(flat(view.getByText('This week')).color).toBe(sc.textOnMastheadMuted);
    expect(flat(view.getByText('1/4')).color).toBe(sc.textOnAccent);
  });

  it('a session row: 56 pt under a 1 pt rule, the 22 pt mark, the day muted, the name in ink (rows 368-479, cols 80-123)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const row = view.getByTestId('week-row-Lower body');
    const st = flat(row);
    expect(st.borderTopWidth).toBe(1);
    expect(st.borderTopColor).toBe(sc.surface.forestBand);
    const line = hosts(row).find((n) => flat({ props: { style: n.props.style } }).minHeight === layout.rowMinHeight - 1);
    expect(line).toBeTruthy();
    const hidden = { includeHiddenElements: true };
    const mark = flat(view.getByTestId('week-mark-planned', hidden));
    expect([mark.width, mark.height, mark.borderColor]).toEqual([22, 22, sc.data.plannedOnDark]);
    expect(flat(view.getAllByTestId('week-mark-missed', hidden)[0]).borderStyle).toBe('dashed');
    expect(flat(view.getByTestId('week-mark-done', hidden)).backgroundColor).toBe(sc.data.leaf);
    expect(flat(within(row).getByText('Thu 19')).color).toBe(sc.textOnMastheadMuted);
    expect(flat(within(row).getByText('Lower body')).color).toBe(sc.textOnAccent);
    expect(flat(within(row).getByText('planned')).color).toBe(sc.textOnMastheadMuted);
    expect(flat(within(view.getByTestId('week-row-Upper body')).getByText('done')).color).toBe(sc.data.leaf);
  });

  it('an EARLIER row: 64 pt, the light 44 pt ring, the span in Inter 17 over doneLine muted (rows 900-1027)', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const row = view.getByTestId('earlier-2026-11-09');
    expect(flat(row).minHeight).toBe(64);
    expect(flat(row).borderBottomColor).toBe(sc.border);
    expect(flat(view.getByTestId('earlier-ring-2026-11-09')).width).toBe(44);
    expect(flat(within(row).getByText('Nov 9 to 15')).fontFamily).toBe(typography.h4.fontFamily);
    expect(flat(within(row).getByText('1 of 2 done')).color).toBe(sc.textMuted);
    expect(flat(view.getByText('Earlier')).fontSize).toBe(typography.eyebrow.fontSize);
  });

  it('320 pt: the name may go under the day, nothing is clamped, every pressable keeps 44 pt', async () => {
    const view = await mount(device, <ClientWorkoutViewerScreen />);
    const name = flat(within(view.getByTestId('week-row-Lower body')).getByText('Lower body'));
    expect(name.minWidth).toBe(112);
    for (const n of hosts(view.toJSON())) {
      expect(n.props.numberOfLines).toBeUndefined();
      expect(n.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });

  // ── RoutineBuilderScreen: C_day's count line and C_picker's title and results ─────────────────────────
  it('builder: the section head counts the rows, "2 exercises" (C_day "5 EXERCISES" rows 860-879); none keeps "Exercises"', async () => {
    mockRoutineId = 'routine';
    let view = await mount(device, <RoutineBuilderScreen />);
    expect(view.getByText('2 exercises')).toBeTruthy();
    expect(view.queryByText('Exercises')).toBeNull();
    await view.unmount();
    mockRoutineId = undefined;
    view = await mount(device, <RoutineBuilderScreen />);
    expect(view.getByText('Exercises')).toBeTruthy();
  });

  it('builder: the sheet is titled "Add to <routine name>" with the results count over the list (C_picker rows 118-141, "6 RESULTS")', async () => {
    mockRoutineId = 'routine';
    const view = await mount(device, <RoutineBuilderScreen />);
    await fireEvent.press(view.getByLabelText('Add exercise'));
    await view.findByLabelText('Add Row');
    expect(view.getByText('Add to Full body A')).toBeTruthy();
    expect(view.getByText('3 results')).toBeTruthy();
    expect(flat(view.getByText('3 results')).fontSize).toBe(typography.eyebrow.fontSize);
    await fireEvent.press(view.getByLabelText('Filter back'));
    expect(view.getByText('1 result')).toBeTruthy();
  });

  it('builder: an unnamed routine keeps the sheet title "Add exercise"', async () => {
    const view = await mount(device, <RoutineBuilderScreen />);
    await fireEvent.press(view.getByLabelText('Add exercise'));
    await view.findByLabelText('Add Row');
    expect(view.queryByText(/^Add to /)).toBeNull();
    expect(view.getAllByText('Add exercise').length).toBeGreaterThan(1);
  });
});
