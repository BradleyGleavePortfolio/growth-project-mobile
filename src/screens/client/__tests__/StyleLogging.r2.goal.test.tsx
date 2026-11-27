/**
 * REFINE-987 (m#987 round 2): the client's "Your workouts" toward C1 Style C v2 C2_history
 * (planning/MOCKUP3/C1/style-c-v2/C2_history_ios390_100.png, context a290b8ec; 780 px for 390 pt) and the routine
 * builder's count line and Add exercise sheet toward K3 Style C C_day / C_picker. Each drawn number names its pixel rows.
 *
 * REFINE-987R3: the week cases moved with the week card to Your weeks (StyleLogging.r3.weeks.test.tsx, owner #203-E80:
 * two screens); the three that stated round 2's choices (EARLIER rows open nothing, one pressable on one page, this
 * week off main's lists) gave way to its cases D and F. The builder's cases stay here as they were.
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
// One array for every render, as React Query's cached data is: a new array each render re-runs the builder's load
// effect (RoutineBuilderScreen.tsx:128-137) without end.
const mockRoutineData = [mockRoutine];
jest.mock('../../../hooks/useApi', () => ({
  useRoutines: () => ({ data: mockRoutineData }),
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

describe.each(DEVICES)('the drawn numbers at $name', (device) => {
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
