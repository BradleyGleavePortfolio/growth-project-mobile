// REDO-LIVE-133: the live workout rendered at 360 x 800 (Android,
// edge-to-edge insets) and 390 x 844 (iPhone with a notch). Reference: design-targets/mobile/
// clientfile-workouts. Checks the look the owner asked for (rounded tokens, serif titles that never
// clip, one filled forest action, insets from safe-area-context) and that every action is still wired.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Alert, AppState, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachBrief: true, romanChat: false } }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', role: 'client' }) }));
const mockNavigation = {
  navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), dispatch: jest.fn(),
  addListener: jest.fn(() => () => undefined),
};
let mockRouteParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock('../hooks/useApi', () => ({ useCreateWorkout: () => ({ mutate: jest.fn() }) }));
const mockLoadSession = jest.fn();
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../services/api', () => ({ workoutApi: { getAll: jest.fn(async () => ({ data: [] })) } }));
const mockGetAllExercises = jest.fn();
jest.mock('../db/workoutDb', () => ({ getAllExercises: (...a: unknown[]) => mockGetAllExercises(...a) }));
jest.mock('../api/workoutBuilderApi', () => ({ workoutBuilderApi: { completeMyAssignment: jest.fn(async () => undefined) } }));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(async () => ({ id: 'q1', alreadySynced: false, serverId: null })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(async () => undefined),
  triggerSync: jest.fn(async () => undefined),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'rest-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  setNotificationHandler: jest.fn(), setNotificationChannelAsync: jest.fn(async () => undefined),
}));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), warning: jest.fn(), error: jest.fn(),
    heavyImpact: jest.fn(), success: jest.fn(),
  },
}));
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import { lightTokens as sc, radius, layout } from '../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 24, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
] as const;

const session = (done: boolean[]) => ({
  isStale: false,
  session: {
    version: 1, startedAtMs: Date.now() - 20 * 60_000, updatedAtMs: Date.now(), routineName: 'Upper Body A', exercisesJson: '[]',
    idempotencyKey: '0b6f2a3e-4b1c-4d2e-9f00-1a2b3c4d5e6f',
    sessionExercises: [
      { exerciseId: 'ex-1', exerciseName: 'Bench Press', restSec: 90, coachNote: 'Pause at the chest', sets: done.map((c) => ({ weight: 95, reps: 8, completed: c })) },
      { exerciseId: 'ex-2', exerciseName: 'Seated Row', restSec: 60, sets: [{ weight: 80, reps: 10, completed: false }] },
    ],
  },
});

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let spies: jest.SpyInstance[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { routineName: 'Upper Body A', exercises: '[]', resume: true };
  mockLoadSession.mockResolvedValue(session([false, false]));
  mockGetAllExercises.mockResolvedValue([
    { id: 'e1', name: 'Incline Press', muscle: 'chest', equipment: 'Dumbbell', imageUrl: null },
  ]);
  spies = [
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => undefined })),
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined),
  ];
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

function inDevice(device: (typeof DEVICES)[number], node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>{node}</SafeAreaProvider>;
}

type Node = { type?: string; props: { style?: unknown; testID?: string }; children?: Array<Node | string> };
/** Every host element whose own style fills it with the forest accent. */
function forestFills(node: Node | string | null | undefined, out: Node[] = []): Node[] {
  if (!node || typeof node === 'string') return out;
  if (node.type && flat(node).backgroundColor === sc.accent) out.push(node);
  for (const child of node.children ?? []) forestFills(child, out);
  return out;
}

describe.each(DEVICES)('live workout at $name', (device) => {
  async function open() {
    const view = await render(inDevice(device, <ActiveWorkoutScreen />));
    await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
    return view;
  }

  it('takes its top from the safe-area insets plus breathing room, never a fixed 56', async () => {
    const view = await open();
    expect(flat(view.getByTestId('active-workout')).paddingTop).toBe(device.insets.top + layout.statusBarGap);
    expect(view.getByLabelText('Leave workout')).toBeTruthy();
    expect(view.getByText(/^\d+:\d{2}$/)).toBeTruthy(); // the workout clock stays in the top bar
  });

  it('Finish is the one rounded forest PrimaryButton, pinned in the footer', async () => {
    const view = await open();
    const footer = within(view.getByTestId('active-workout-footer'));
    const finish = footer.getByTestId('finish-workout');
    expect(footer.getByText('Finish workout')).toBeTruthy();
    expect(flat(finish).borderRadius).toBe(radius.button);
    expect(flat(finish).minHeight).toBe(layout.buttonHeight);
    // One filled forest element on the page (nothing logged yet, so no ticked set marks).
    const fills = forestFills(view.container as unknown as Node).filter((n) => n.props.testID !== 'live-progress-fill');
    expect(fills.map((n) => n.props.testID)).toEqual(['finish-workout']);
  });

  it('sets serif titles with a line height that never clips descenders', async () => {
    const view = await open();
    for (const text of ['Upper Body A', 'Bench Press', 'Seated Row']) {
      const style = flat(view.getByText(text));
      expect(style.fontFamily).toMatch(/^CormorantGaramond/);
      expect(style.lineHeight!).toBeGreaterThanOrEqual(1.2 * style.fontSize!);
    }
    expect(view.getByText('0 of 3 sets completed')).toBeTruthy();
  });

  it('keeps every exercise and set action wired, in sentence case', async () => {
    const view = await open();
    for (const label of ['Watch video for Bench Press', 'Remove Bench Press', 'Move Bench Press down', 'Swap Bench Press',
      'Set rest for Bench Press to 60 seconds', 'Notes for Bench Press', 'Workout notes']) {
      expect(view.getByLabelText(label)).toBeTruthy();
    }
    expect(view.getAllByText('Add set')).toHaveLength(2);
    expect(view.getByText('Coach note: Pause at the chest')).toBeTruthy();
    expect(view.queryByText('Add Set')).toBeNull();
    await act(async () => { fireEvent.changeText(view.getByTestId('set-weight-0-0'), '100'); await flush(); });
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('100');
    const input = flat(view.getByTestId('set-weight-0-0'));
    expect(input.borderRadius).toBe(radius.input);
    expect(input.fontVariant).toEqual(['tabular-nums']);
    expect(flat(view.getByTestId('set-done-0-0')).borderRadius).toBe(radius.chip);
  });

  it('a ticked set starts the rest row inside the footer, above Finish, with +30s and Skip', async () => {
    const view = await open();
    await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); await flush(); });
    const footer = within(view.getByTestId('active-workout-footer'));
    expect(footer.getByTestId('rest-timer')).toBeTruthy();
    expect(footer.getByLabelText('Add 30 seconds to rest timer')).toBeTruthy();
    expect(flat(footer.getByTestId('rest-timer')).borderRadius).toBe(radius.card);
    await act(async () => { fireEvent.press(footer.getByLabelText('Skip rest timer')); await flush(); });
    expect(view.queryByTestId('rest-timer')).toBeNull();
    expect(view.getByText('1 of 3 sets completed')).toBeTruthy();
    expect(view.getByTestId('workout-finish-summary')).toBeTruthy();
  });

  it('Add exercise opens the sheet with a serif title, pill filters and a muted muscle line', async () => {
    const view = await open();
    await act(async () => { fireEvent.press(view.getByText('Add exercise')); await flush(); });
    await waitFor(() => expect(view.getByText('Incline Press')).toBeTruthy());
    expect(flat(view.getAllByText('Add exercise').slice(-1)[0]).fontFamily).toMatch(/^CormorantGaramond/);
    expect(view.getByText('Chest · Dumbbell')).toBeTruthy();
    expect(view.getByLabelText('Close')).toBeTruthy();
  });
});

describe('live workout empty state', () => {
  it('says what to do when the workout has no exercises yet', async () => {
    mockLoadSession.mockResolvedValue(null);
    mockRouteParams = { routineName: 'Quick workout', exercises: '[]' };
    const view = await render(inDevice(DEVICES[0], <ActiveWorkoutScreen />));
    await waitFor(() => expect(view.getByTestId('active-workout-empty')).toBeTruthy());
    expect(view.getByText('No exercises yet. Add the first one below.')).toBeTruthy();
    expect(view.getByText('Add exercise')).toBeTruthy();
  });
});

describe('shared live-workout styles use the semantic radius tokens', () => {
  it('chips are pills, the chosen chip is outlined (not a second forest fill), inputs and rest row are rounded', () => {
    const { makeStyles } = jest.requireActual('../screens/client/active-workout/styles');
    const styles = makeStyles({ background: sc.bgPrimary, surface: sc.bgSurface, primary: sc.accent, primaryPale: '#E8EDE9',
      textPrimary: sc.textPrimary, textSecondary: sc.textMuted, textMuted: sc.textMuted, textOnPrimary: sc.textOnAccent });
    expect(styles.muscleChip.borderRadius).toBe(radius.chip);
    expect(styles.muscleChipActive.backgroundColor).toBeUndefined();
    expect(styles.searchBar.borderRadius).toBe(radius.input);
    expect(styles.notesInput.borderRadius).toBe(radius.input);
    expect(styles.restOverlay.borderRadius).toBe(radius.card);
    expect(styles.restOverlay.position).toBeUndefined();
    expect(styles.exerciseCard.marginHorizontal).toBe(layout.gutter);
    expect(styles.addExerciseBtn.borderStyle).toBeUndefined();
  });
});

describe('source rules for the redone files (Q10b, Q5)', () => {
  const files = [
    'screens/client/ActiveWorkoutScreen.tsx',
    'screens/client/active-workout/styles.ts',
    'screens/client/active-workout/ExerciseCard.tsx',
    'screens/client/active-workout/WorkoutFinishSummary.tsx',
  ].map((f) => [f, fs.readFileSync(path.join(__dirname, '..', f), 'utf8')] as const);

  it.each(files)('%s: no literal radius, no SafeAreaView from react-native, no Title Case actions', (_f, src) => {
    expect(src).not.toMatch(/borderRadius:\s*\d/);
    expect(src).not.toMatch(/SafeAreaView[^;]*from 'react-native'/);
    expect(src).not.toMatch(/'Add Exercise'|>Add Set<|>Add Exercise<|'Finish Workout\?'/);
    expect(src).not.toMatch(/paddingTop: 56,\n\s*paddingBottom: 12,\n\s*backgroundColor: colors\.surface/);
  });
});
