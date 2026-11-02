/** FR-917R3 own tests (F2/F3, LS-917R3 B2, LO-917R3 B1/B2/C3): a 4-block day in
 * the C1 v2 logger (one done, one open, two not started) and the set row's
 * fit at 320 and 360 pt with 100% and 130% text. Harness copied from
 * fr917r2LiveBlocks.screen.test.tsx. */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
const mockUser = { id: 'member-zero-load', role: 'student', coach_id: 'coach-fixture' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let mockParams = { routineName: 'Assigned pull ups', assignmentId: 'assigned-pull-ups', exercises: '[]' };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => null),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../components/tutorial/TutorialTarget', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../components/HapticPressable', () => ({
  __esModule: true, default: jest.requireActual('react-native').Pressable,
}));
jest.mock('../components/share/ShareSheet', () => ({
  __esModule: true, default: () => null, ShareLink: () => null,
}));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
const mockCreate = jest.fn();
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({
    isPending: false,
    mutate: async (payload: unknown, options: { onSuccess: (value: unknown) => void }) =>
      options.onSuccess(await mockCreate(payload)),
  }),
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: jest.fn(async () => ({})) },
}));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(async () => ({ id: 'queued-zero-load', alreadySynced: false })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(),
  triggerSync: jest.fn(async () => undefined),
}));
const mockHistory = [{
  id: 'previous-weighted-pull-up',
  exercises: [{
    exercise_name: 'Pull Up', muscle_group: 'back', sets_completed: 1,
    weight_per_set: [20], reps_per_set: [8],
  }],
}];
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: [] })) },
  workoutApi: { getAll: jest.fn(async () => ({ data: mockHistory })) },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'saved-zero-load' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

const plan = (sets: number, weight: number | null, reps = 8) => ({
  exercise_external_id: 'seed:x', order: 0, sets, reps_or_duration_seconds: reps, weight_lbs: weight,
  rest_seconds: 0, superset_group_id: null, notes: null,
});
async function start(rows: Array<[name: string, sets: number, weight: number | null]>) {
  const exercises = rows.flatMap(([name, sets, weight]) =>
    buildActiveWorkoutExercises({ exercises: [plan(sets, weight)] }).map((e) => ({ ...e, exerciseName: name })));
  mockParams = { ...mockParams, exercises: JSON.stringify(exercises) };
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByLabelText('Use previous set 1: 20 pounds, 8 reps')).toBeTruthy());
  return view;
}

it('a 4-block day: A done and folded, B open with one filled "As planned", C and D one line each', async () => {
  const view = await start([['Pull Up', 1, 15], ['Bench press', 2, 95], ['Barbell row', 2, 80], ['Curl', 2, 25]]);
  expect(view.getByText('Block A of D')).toBeTruthy();
  expect(view.getByText('0 / 7 sets')).toBeTruthy();
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  await fireEvent.press(view.getByTestId('set-done-1-0'));
  expect(view.getByText('Block B of D')).toBeTruthy();
  expect(view.getByText('2 / 7 sets')).toBeTruthy();
  expect(view.getByLabelText('2 of 7 sets done')).toBeTruthy();
  // A: folded, its header says what a tap does.
  expect(view.getByTestId('exercise-folded-0').props.accessibilityLabel).toBe('Show sets for Pull Up, 1 of 1 set complete');
  // B: open, the next set (2) is the only filled pill, and its name says "As planned".
  expect(view.getByTestId('exercise-active-1')).toBeTruthy();
  expect(view.getByRole('checkbox', { name: 'As planned, mark set 2 done' })).toBeTruthy();
  expect(view.getByTestId('set-value-1-0')).toHaveTextContent('95 lb × 8');
  expect(view.getAllByText('As planned')).toHaveLength(1);
  // C and D: one line with the plan; no set rows until opened.
  for (const [i, name, plan] of [[2, 'Barbell row', '2 × 8 · 80 lb'], [3, 'Curl', '2 × 8 · 25 lb']] as const) {
    expect(view.getByTestId(`exercise-waiting-${i}`).props.accessibilityLabel).toBe(`Show sets for ${name}, ${plan}`);
    expect(view.queryByTestId(`set-row-${i}-0`)).toBeNull();
  }
  await fireEvent.press(view.getByTestId('exercise-waiting-3'));
  expect(view.getByTestId('set-row-3-0')).toBeTruthy();
  // Opening D does not move the block in progress.
  expect(view.getByText('Block B of D')).toBeTruthy();
  // A opens again from its folded header.
  await fireEvent.press(view.getByTestId('exercise-folded-0'));
  expect(view.getByTestId('set-value-0-0')).toHaveTextContent('15 lb × 8');
});

it('a set row is never cut at 320 or 360 pt with 100% or 130% text: one line at 360/100%, else the pill wraps under the numbers', async () => {
  const view = await start([['Pull Up', 3, 155]]);
  const f = (id: string) => StyleSheet.flatten(view.getByTestId(id).props.style);
  const card = f('exercise-active-0');
  const row = f('set-row-0-0');
  const pill = f('set-done-0-0');
  const weight = f('set-weight-0-0');
  const reps = f('set-reps-0-0');
  const label = StyleSheet.flatten(view.getAllByText('Set 1')[0].props.style);
  const unit = StyleSheet.flatten(view.getAllByText('lb ×')[0].props.style);
  const pillText = StyleSheet.flatten(view.getAllByText('As planned')[0].props.style);
  // Nothing has a fixed width that text at 130% could overflow; the row wraps.
  expect(row.flexWrap).toBe('wrap');
  for (const s of [label, weight, reps, pill]) expect(s.width).toBeUndefined();
  const n = (v: unknown) => Number(v ?? 0);
  // Half an em per character is a floor for Inter; real text is wider.
  const em = (size: unknown, text: string, scale: number) => 0.5 * n(size) * scale * text.length;
  for (const [width, scale] of [[320, 1], [320, 1.3], [360, 1], [360, 1.3]] as const) {
    const inside = width - 2 * n(card.marginHorizontal) - 2 * n(card.paddingHorizontal)
      - 2 * n(row.marginHorizontal) - n(row.paddingLeft) - n(row.paddingRight) - n(row.borderLeftWidth);
    const numbers = Math.max(n(label.minWidth), em(label.fontSize, 'Set 1', scale)) + 4
      + Math.max(n(weight.minWidth), em(weight.fontSize, '155', scale))
      + em(unit.fontSize, 'lb ×', scale) + 2 * n(unit.marginHorizontal)
      + Math.max(n(reps.minWidth), em(reps.fontSize, '6', scale));
    const pillWidth = 2 * n(pill.paddingHorizontal) + n(pill.gap) + 16 + em(pillText.fontSize, 'As planned', scale);
    // Each line fits on its own.
    expect(numbers).toBeLessThanOrEqual(inside);
    expect(pillWidth).toBeLessThanOrEqual(inside);
    // The common phone (360, 100%) keeps it on one line, as in the mock.
    if (width === 360 && scale === 1) expect(numbers + n(row.columnGap) + pillWidth).toBeLessThanOrEqual(inside);
  }
});
