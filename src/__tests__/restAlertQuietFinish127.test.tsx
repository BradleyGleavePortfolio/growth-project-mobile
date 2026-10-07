// DES-R-127: rest alert in the background (granted permission only, never asks; cancelled on return,
// Skip, +30s, Finish, leaving), the quiet finish summary, and parity of every finish/rest action.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Alert, Animated, AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { render, act, waitFor, fireEvent, within } from '@testing-library/react-native';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachBrief: true, romanChat: false } }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', role: 'client' }) }));
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
let mockRouteParams: Record<string, unknown> = { routineName: 'Push Day', exercises: '[]', resume: true };
let mockBeforeRemove: ((e: { preventDefault: () => void; data: { action: unknown } }) => void) | null = null;
const mockNavigation = {
  navigate: jest.fn(), goBack: mockGoBack, setParams: jest.fn(), dispatch: mockDispatch,
  addListener: (type: string, cb: NonNullable<typeof mockBeforeRemove>) => {
    if (type === 'beforeRemove') mockBeforeRemove = cb;
    return () => undefined;
  },
};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
}));
let mutateOptions: { onSuccess?: (data: unknown) => void } | null = null;
const mockMutate = jest.fn((_vars: unknown, options: typeof mutateOptions) => { mutateOptions = options; });
jest.mock('../hooks/useApi', () => ({ useCreateWorkout: () => ({ mutate: mockMutate }) }));
const mockLoadSession = jest.fn();
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
const mockGetAll = jest.fn();
jest.mock('../services/api', () => ({ workoutApi: { getAll: (...a: unknown[]) => mockGetAll(...a) } }));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
jest.mock('../api/workoutBuilderApi', () => ({ workoutBuilderApi: { completeMyAssignment: jest.fn(async () => undefined) } }));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(async () => ({ id: 'q1', alreadySynced: false, serverId: null })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(async () => undefined),
  triggerSync: jest.fn(async () => undefined),
}));
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSchedule = jest.fn();
const mockCancel = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
  scheduleNotificationAsync: (...a: unknown[]) => mockSchedule(...a),
  cancelScheduledNotificationAsync: (...a: unknown[]) => mockCancel(...a),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  setNotificationHandler: jest.fn(), setNotificationChannelAsync: jest.fn(async () => undefined),
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
}));
const mockSuccess = jest.fn();
const mockHeavy = jest.fn();
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), warning: jest.fn(), error: jest.fn(),
    heavyImpact: (...a: unknown[]) => mockHeavy(...a),
    success: (...a: unknown[]) => mockSuccess(...a),
  },
}));
// Set rows belong to DES-W / DES-X; a stand-in card gives one tick per set.
jest.mock('../screens/client/active-workout/ExerciseCard', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    ExerciseCard: ({ exercise, exIdx, onToggleSetComplete }: {
      exercise: { exerciseName: string; sets: unknown[] }; exIdx: number; onToggleSetComplete: (e: number, s: number) => void;
    }) => R.createElement(RN.View, null, R.createElement(RN.Text, null, exercise.exerciseName),
      ...exercise.sets.map((_s, s) => R.createElement(RN.Pressable, { key: String(s), testID: `tick-${exIdx}-${s}`, onPress: () => onToggleSetComplete(exIdx, s) }))),
  };
});

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

const STARTED_AT = Date.now() - 40 * 60 * 1000;
const set = (weight: number, reps: number) => (completed: boolean) => ({ weight, reps, completed });
const stored = (bench: boolean[], row: boolean[]) => ({
  isStale: false,
  session: {
    version: 1, startedAtMs: STARTED_AT, updatedAtMs: STARTED_AT, routineName: 'Push Day', exercisesJson: '[]',
    idempotencyKey: '0b6f2a3e-4b1c-4d2e-9f00-1a2b3c4d5e6f',
    sessionExercises: [
      { exerciseId: 'ex-1', exerciseName: 'Bench Press', restSec: 90, sets: bench.map(set(135, 8)) },
      { exerciseId: 'ex-2', exerciseName: 'Seated Row', restSec: 60, sets: row.map(set(100, 10)) },
    ],
  },
});

let listeners: Array<(state: AppStateStatus) => void> = [];
let alerts: Array<{ title: string; buttons: string[] }> = [];
let alertChoice = 'Finish';
let spies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { routineName: 'Push Day', exercises: '[]', resume: true };
  mockBeforeRemove = null;
  listeners = [];
  alerts = [];
  alertChoice = 'Finish';
  mockLoadSession.mockResolvedValue(stored([false, false, false], [false]));
  mockGetAll.mockResolvedValue({ data: [] });
  mockGetPermissions.mockResolvedValue({ status: 'granted' });
  mockSchedule.mockResolvedValue('rest-alert-1');
  mockCancel.mockResolvedValue(undefined);
  spies = [
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: () => { listeners = listeners.filter((l) => l !== listener); } };
    }),
    jest.spyOn(Alert, 'alert').mockImplementation((title, _body, buttons) => {
      alerts.push({ title: String(title), buttons: (buttons ?? []).map((b) => String(b.text)) });
      (buttons ?? []).find((b) => b.text === alertChoice)?.onPress?.();
    }),
  ];
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const moveApp = (state: AppStateStatus) => act(async () => { [...listeners].forEach((l) => l(state)); await flush(); });
const press = (el: Parameters<typeof fireEvent.press>[0]) => act(async () => { await fireEvent.press(el); await flush(); });
const saved = (id: string) => act(async () => { mutateOptions!.onSuccess!({ id }); await flush(); });

async function openScreen() {
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
  return view;
}

async function restInBackground(tick = 'tick-0-0') {
  const view = await openScreen();
  await press(view.getByTestId(tick));
  expect(view.getByText('Skip')).toBeTruthy();
  await moveApp('background');
  return view;
}

describe('rest alert while the app is in the background', () => {
  it('schedules one alert for the rest end, naming the next set, when permission is already granted', async () => {
    await restInBackground();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const { content, trigger } = mockSchedule.mock.calls[0][0];
    expect(content.body).toBe('Rest over. Next: Bench Press, set 2.');
    expect(trigger.type).toBe('timeInterval');
    expect(trigger.seconds).toBeGreaterThanOrEqual(85);
    expect(trigger.seconds).toBeLessThanOrEqual(90);
    await moveApp('active');
    expect(mockCancel).toHaveBeenCalledWith('rest-alert-1');
  });

  it('names the next exercise after the last set of this one, and only "Rest over." when nothing is left', async () => {
    mockLoadSession.mockResolvedValue(stored([true, true, false], [false]));
    await (await restInBackground('tick-0-2')).unmount();
    expect(mockSchedule.mock.calls[0][0].content.body).toBe('Rest over. Next: Seated Row, set 1.');
    mockLoadSession.mockResolvedValue(stored([true, true, false], [true]));
    await restInBackground('tick-0-2');
    expect(mockSchedule.mock.calls[1][0].content.body).toBe('Rest over.');
  });

  it.each(['denied', 'undetermined'])('schedules nothing and never asks when permission is %s', async (status) => {
    mockGetPermissions.mockResolvedValue({ status });
    await restInBackground();
    expect(mockGetPermissions).toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('schedules nothing when no rest is running', async () => {
    await openScreen();
    await moveApp('background');
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it.each(['Skip', '+30s'])('%s cancels the scheduled alert', async (label) => {
    const view = await restInBackground();
    await press(view.getByText(label));
    expect(mockCancel).toHaveBeenCalledWith('rest-alert-1');
  });

  it('Finish cancels the alert, and none is set while the workout saves', async () => {
    const view = await restInBackground();
    await press(view.getByText('Finish'));
    expect(mockCancel).toHaveBeenCalledWith('rest-alert-1');
    await moveApp('background');
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('Finish and log from the leave question, and leaving the screen, cancel the alert', async () => {
    alertChoice = 'Finish and log';
    const view = await restInBackground();
    await press(view.getByLabelText('Leave workout'));
    expect(mockCancel).toHaveBeenCalledWith('rest-alert-1');
    await view.unmount();
    mockCancel.mockClear();
    await (await restInBackground()).unmount();
    expect(mockCancel).toHaveBeenCalledWith('rest-alert-1');
  });
});

describe('quiet finish summary', () => {
  it('shows time, sets and volume as serif tabular numerals', async () => {
    mockLoadSession.mockResolvedValue(stored([true, true, false], [false]));
    const summary = within((await openScreen()).getByTestId('workout-finish-summary'));
    expect(summary.getByTestId('finish-summary-time').props.children).toMatch(/^\d+:\d{2}$/);
    expect(summary.getByTestId('finish-summary-sets').props.children).toBe('2');
    expect(summary.getByTestId('finish-summary-volume').props.children).toBe('2,160 lb');
    for (const id of ['finish-summary-time', 'finish-summary-sets', 'finish-summary-volume']) {
      const style = StyleSheet.flatten(summary.getByTestId(id).props.style);
      expect(style.fontFamily).toMatch(/^CormorantGaramond/);
      expect(style.fontVariant).toContain('tabular-nums');
    }
    expect(summary.getByText('1 exercise')).toBeTruthy();
    expect(summary.queryAllByRole('button')).toHaveLength(0); // parity: no tappable element, before or after
  });

  it('states a record only when it beats every set in the last 50 saved workouts', async () => {
    const history = (weight: number) => ({
      data: [{ id: 'w1', exercises: [{ exercise_name: 'Bench Press', muscle_group: 'chest', sets_completed: 1, reps_per_set: [8], weight_per_set: [weight] }] }],
    });
    mockLoadSession.mockResolvedValue(stored([true, false, false], [false]));
    mockGetAll.mockResolvedValue(history(130));
    const view = await openScreen();
    await waitFor(() => expect(view.getByText('Bench Press at 135 lb is the heaviest in the last 50 saved workouts.')).toBeTruthy());
    await view.unmount();
    mockGetAll.mockResolvedValue(history(140));
    const none = await openScreen();
    await waitFor(() => expect(none.getByText('Recent bests compare the last 50 saved workouts.')).toBeTruthy());
    expect(none.queryByText(/is the heaviest/)).toBeNull();
  });

  it('fades in once within 300 ms, with no spring, scale or particles', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    spies.push(timing);
    mockLoadSession.mockResolvedValue(stored([true, false, false], [false]));
    await openScreen();
    expect(timing.mock.calls.some(([, c]) => c.toValue === 1 && typeof c.duration === 'number' && c.duration > 0 && c.duration <= 300)).toBe(true);
    const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'client', 'active-workout', 'WorkoutFinishSummary.tsx'), 'utf8');
    expect(src).not.toMatch(/ParticleBurst|Animated\.spring|transform|scale:/);
  });

  it('a saved workout gives one success haptic instead of the heavy impact', async () => {
    mockLoadSession.mockResolvedValue(stored([true, true, false], [false]));
    await press((await openScreen()).getByText('Finish'));
    await saved('srv-1');
    expect(mockSuccess).toHaveBeenCalledTimes(1);
    expect(mockHeavy).not.toHaveBeenCalled();
  });
});

describe('parity: every finish and rest action stays in place', () => {
  it('Finish asks with Cancel and Finish, then saves and closes', async () => {
    mockLoadSession.mockResolvedValue(stored([true, false, false], [false]));
    await press((await openScreen()).getByTestId('finish-workout'));
    expect(alerts[0]).toEqual({ title: 'Finish Workout?', buttons: ['Cancel', 'Finish'] });
    expect(mockMutate).toHaveBeenCalledTimes(1);
    await saved('srv-2');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('Leave with nothing logged closes the screen without a question', async () => {
    await press((await openScreen()).getByLabelText('Leave workout'));
    expect(alerts).toEqual([]);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('the rest bar keeps +30s (adds 30 seconds) and Skip (ends the rest)', async () => {
    const view = await openScreen();
    await press(view.getByTestId('tick-0-0'));
    expect(view.getByText(/^01:(29|30)$/)).toBeTruthy();
    await press(view.getByLabelText('Add 30 seconds to rest timer'));
    expect(view.getByText(/^(01:59|02:00)$/)).toBeTruthy();
    await press(view.getByLabelText('Skip rest timer'));
    expect(view.queryByText('Skip')).toBeNull();
  });
});

// TRAIN-GATE-128 (owner 15:03 10-07): autosave, reopen straight into the workout, never a delete choice,
// and leaving the screen or the tab asks to log it or keep training.
describe('leaving a live workout never deletes it', () => {
  const NO_DELETE = ['Start Fresh', 'Discard', 'Discard workout'];
  const allButtons = () => alerts.flatMap((a) => a.buttons);

  it('opening the workout screen with an unfinished session goes straight back in, no prompt', async () => {
    mockRouteParams = { routineName: 'Quick Workout', exercises: '[]' };
    mockLoadSession.mockResolvedValue(stored([true, false, false], [false]));
    const view = await openScreen();
    expect(alerts).toEqual([]);
    expect(view.getByText('1 of 4 sets completed')).toBeTruthy();
    expect(mockNavigation.setParams).toHaveBeenCalledWith(expect.objectContaining({ routineName: 'Push Day' }));
  });

  it('Leave with sets logged asks to log or keep training; Keep training keeps everything', async () => {
    alertChoice = 'Keep training';
    mockLoadSession.mockResolvedValue(stored([true, true, false], [false]));
    const view = await openScreen();
    await press(view.getByLabelText('Leave workout'));
    expect(alerts).toEqual([{ title: 'Log this workout?', buttons: ['Keep training', 'Finish and log'] }]);
    expect(allButtons().some((b) => NO_DELETE.includes(b))).toBe(false);
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(view.getByText('2 of 4 sets completed')).toBeTruthy();
  });

  it('Finish and log saves the workout through the normal finish path, then closes', async () => {
    alertChoice = 'Finish and log';
    mockLoadSession.mockResolvedValue(stored([true, true, false], [false]));
    const view = await openScreen();
    await press(view.getByLabelText('Leave workout'));
    expect(alerts.map((a) => a.title)).toEqual(['Log this workout?']);
    expect(mockMutate).toHaveBeenCalledTimes(1);
    await saved('srv-9');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('back gesture or back button (beforeRemove) is held and asks the same question', async () => {
    alertChoice = 'Keep training';
    mockLoadSession.mockResolvedValue(stored([true, false, false], [false]));
    await openScreen();
    const preventDefault = jest.fn();
    await act(async () => { mockBeforeRemove!({ preventDefault, data: { action: { type: 'GO_BACK' } } }); await flush(); });
    expect(preventDefault).toHaveBeenCalled();
    expect(alerts[0].title).toBe('Log this workout?');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('a press on another tab asks while the workout is open; nothing logged lets the tab open', async () => {
    const { workoutLeaveGuard } = jest.requireActual('../screens/client/active-workout/leaveGuard');
    alertChoice = 'Keep training';
    mockLoadSession.mockResolvedValue(stored([true, false, false], [false]));
    const view = await openScreen();
    const leave = jest.fn();
    await act(async () => { workoutLeaveGuard()!(leave); await flush(); });
    expect(alerts[0]).toEqual({ title: 'Log this workout?', buttons: ['Keep training', 'Finish and log'] });
    expect(leave).not.toHaveBeenCalled();
    await view.unmount();
    expect(workoutLeaveGuard()).toBeNull();
  });
});
