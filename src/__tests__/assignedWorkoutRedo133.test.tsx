// REDO-LIVE-133 (part 2): the assigned-workout screen (WorkoutAssignmentDetailScreen) rendered at
// 360 x 800 (Android, edge-to-edge insets) and 390 x 844 (iPhone with a notch). Reference:
// design-targets/mobile/clientfile-workouts (serif title, numbered hairline rows, one forest action).
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockTabNavigate = jest.fn();
const mockNavigation = {
  navigate: jest.fn(), getParent: () => ({ navigate: mockTabNavigate }), addListener: jest.fn(() => () => undefined),
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { assignmentId: 'assignment-133' } }),
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', role: 'client' }) }));
const mockLoadSession = jest.fn();
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a),
}));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn() },
}));
const PLAN = {
  id: 'assignment-133', completed_at: null as string | null, post_rpe: null as number | null,
  workout_plan: {
    id: 'plan-133', name: 'Upper Body A', type: 'strength', duration_estimate_minutes: 45,
    exercises: [
      { id: 'r1', exercise_external_id: 'bench', order: 1, sets: 3, reps_or_duration_seconds: 8, weight_lbs: 95, rest_seconds: 90, notes: 'Pause at the chest' },
      { id: 'r2', exercise_external_id: 'row', order: 2, sets: 3, reps_or_duration_seconds: 10, weight_lbs: null, rest_seconds: null, notes: null },
    ],
  },
};
let mockAssignment: typeof PLAN | undefined = PLAN;
let mockAssignmentError = false;
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({
    data: mockAssignment, isLoading: false, isError: mockAssignmentError, refetch: jest.fn(), isRefetching: false,
  }),
}));
jest.mock('../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { bench: 'Bench Press', row: 'Seated Row' }, loading: false }),
}));

import WorkoutAssignmentDetailScreen from '../screens/client/WorkoutAssignmentDetailScreen';
import { lightTokens as sc, radius, layout } from '../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 24, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
] as const;
function inDevice(device: (typeof DEVICES)[number], node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>{node}</SafeAreaProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAssignment = PLAN;
  mockAssignmentError = false;
  mockLoadSession.mockResolvedValue(null);
});

describe.each(DEVICES)('assigned workout at $name', (device) => {
  it('serif title, numbered hairline rows without card fills, Start pinned as the PrimaryButton', async () => {
    const view = await render(inDevice(device, <WorkoutAssignmentDetailScreen />));
    expect(await view.findByText('Bench Press')).toBeTruthy();
    expect(flat(view.getByText('Upper Body A')).fontFamily).toMatch(/^CormorantGaramond/);
    expect(view.getByText('Strength')).toBeTruthy();
    expect(view.getByText(/^About 45 min · 2 exercises$/)).toBeTruthy();
    expect(view.getByText(/^3 sets × 8 reps · 95 lb · 90s rest$/)).toBeTruthy();
    expect(view.getByText('Pause at the chest')).toBeTruthy();
    for (const n of ['1', '2']) expect(flat(view.getByText(n)).fontFamily).toMatch(/^CormorantGaramond/);
    expect(flat(view.getByTestId('assignment-row-1')).backgroundColor).toBeUndefined();
    expect(flat(view.getByTestId('assignment-row-1')).borderBottomColor).toBe(sc.border);
    expect(flat(view.getByTestId('assignment-detail')).paddingTop).toBe(device.insets.top + layout.statusBarGap);
    const footer = within(view.getByTestId('assignment-detail-footer'));
    expect(footer.getByText('Start workout')).toBeTruthy();
    expect(flat(view.getByTestId('assignment-start')).borderRadius).toBe(radius.button);
    await act(async () => { fireEvent.press(view.getByText('Start workout')); await flush(); });
    expect(mockTabNavigate).toHaveBeenCalledWith('WorkoutTab', expect.objectContaining({ screen: 'ActiveWorkout', initial: false }));
  });

  it('completed: no Start, a quiet Completed line', async () => {
    mockAssignment = { ...PLAN, completed_at: 'done', post_rpe: 7 };
    const view = await render(inDevice(device, <WorkoutAssignmentDetailScreen />));
    expect(await view.findByText('Completed · RPE 7')).toBeTruthy();
    expect(view.queryByTestId('assignment-start')).toBeNull();
  });

  it('load error: serif sentence and a quiet Try again, no boxed button', async () => {
    mockAssignment = undefined;
    mockAssignmentError = true;
    const view = await render(inDevice(device, <WorkoutAssignmentDetailScreen />));
    expect(view.getByText('This workout did not load.')).toBeTruthy();
    expect(view.getByText('Check the connection, then try again.')).toBeTruthy();
    expect(flat(view.getByTestId('assignment-retry')).borderWidth).toBeUndefined();
  });
});

it('WorkoutAssignmentDetailScreen: no literal radius, no boxed or uppercase Start label', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/client/WorkoutAssignmentDetailScreen.tsx'), 'utf8');
  expect(src).not.toMatch(/borderRadius:\s*\d/);
  expect(src).not.toMatch(/textTransform: 'uppercase'/);
  expect(src).not.toMatch(/SafeAreaView[^;]*from 'react-native'/);
});
