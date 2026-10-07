/**
 * FU-WORKLOG2-126 (agent 126): workout logging, second pass.
 *
 *   - The coach's Workouts tab on a client shows the weight and reps of every
 *     set and the notes the client wrote. It used to show only counts and a
 *     list of names, and "0 min" when no duration was recorded.
 *   - The coach Timeline says what was done ("4 exercises · 52 min"), not
 *     "Logged" on every workout.
 *   - Resume on the "Resume workout?" prompt carries the saved workout's own
 *     name and coach assignment, so a coach workout resumed from Quick
 *     Workout still completes the coach's assignment.
 *   - Recent Workouts can show older workouts (it stopped at the 5 newest)
 *     and shows the note written at Finish.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { AppState } from 'react-native';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: false, clientTutorial: false },
}));

const mockUser = { id: 'c1', email: 'm@x.io', role: 'client', firstName: 'Marcus' };
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUser,
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const ReactLib = jest.requireActual('react');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setParams: jest.fn(),
      getParent: () => ({ navigate: mockNavigate }),
      addListener: () => () => undefined,
    }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

const mockGetAll = jest.fn();
jest.mock('../services/api', () => ({
  workoutApi: {
    getRoutines: jest.fn(async () => ({ data: [] })),
    getAll: (...a: unknown[]) => mockGetAll(...a),
    getVolume: jest.fn(async () => ({ data: [] })),
    deleteWorkout: jest.fn(),
  },
}));

jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: [], isLoading: false, refetch: jest.fn(async () => ({ data: [] })) }),
}));

jest.mock('../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../components/tutorial/PlanExplanationCard', () => () => null);

import WorkoutScreen from '../screens/client/WorkoutScreen';
import { WorkoutsTab } from '../screens/coach/client-detail/WorkoutsTab';
import { makeStyles } from '../screens/coach/client-detail/styles';
import { testColors } from '../screens/client/wearables/recoveryTestColors';
import {
  formatCoachSessionSets,
  mapCoachWorkoutSessions,
  resumedSessionRouteParams,
  workoutTimelineSubtitle,
} from '../utils/workout/workoutLogging';

const ROOT = path.resolve(__dirname, '..', '..');

describe('coach view of a finished client workout', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'w1',
    workout_name: 'Push A',
    date: '2026-10-06T00:00:00.000Z',
    created_at: '2026-10-06T17:45:00.000Z',
    duration_minutes: 45,
    notes: ' Felt strong today ',
    exercises: [
      {
        exercise_name: 'Barbell Bench Press',
        sets_completed: 2,
        weight_per_set: [135, 145],
        reps_per_set: [8, 6],
        notes: 'Shoulder fine',
      },
    ],
    ...overrides,
  });

  it('keeps the client notes and the recorded duration', () => {
    const [s] = mapCoachWorkoutSessions([row()]);
    expect(s.notes).toBe('Felt strong today');
    expect(s.durationMinutes).toBe(45);
    expect(JSON.parse(s.exercises)[0].notes).toBe('Shoulder fine');
    const [none] = mapCoachWorkoutSessions([row({ duration_minutes: null, notes: null })]);
    expect(none.durationMinutes).toBeNull();
    expect(none.notes).toBe('');
  });

  it('formats every completed set with weight and reps', () => {
    expect(formatCoachSessionSets([
      { weight: 135, reps: 8, completed: true },
      { weight: 145, reps: 6, completed: true },
      { weight: 155, reps: 4, completed: false },
    ])).toBe('2 sets · 135 lb x 8, 145 lb x 6');
    expect(formatCoachSessionSets([{ weight: 0, reps: 12, completed: true }])).toBe('1 set · 12 reps');
  });

  it('renders sets, weights, notes and duration on the coach card', async () => {
    const styles = makeStyles(testColors);
    const view = await render(
      <WorkoutsTab
        workoutSessions={mapCoachWorkoutSessions([row()])}
        colors={testColors}
        styles={styles}
      />,
    );
    expect(view.getByText('Barbell Bench Press')).toBeTruthy();
    expect(view.getByText('2 sets · 135 lb x 8, 145 lb x 6')).toBeTruthy();
    expect(view.getByText('Client note: Shoulder fine')).toBeTruthy();
    expect(view.getByText('Workout note: Felt strong today')).toBeTruthy();
    expect(view.getByText(/· 45 min$/)).toBeTruthy();
  });

  it('does not show "0 min" when the duration was not recorded', async () => {
    const styles = makeStyles(testColors);
    const view = await render(
      <WorkoutsTab
        workoutSessions={mapCoachWorkoutSessions([row({ duration_minutes: null })])}
        colors={testColors}
        styles={styles}
      />,
    );
    expect(view.queryByText(/0 min/)).toBeNull();
  });

  it('says what was done on the coach Timeline', () => {
    expect(workoutTimelineSubtitle({ exercises: [{}, {}, {}, {}], duration_minutes: 52 })).toBe('4 exercises · 52 min');
    expect(workoutTimelineSubtitle({ exercises: [{}], duration_minutes: null })).toBe('1 exercise');
    expect(workoutTimelineSubtitle({ exercises: [], duration_minutes: 0 })).toBe('Workout logged');
    const hook = fs.readFileSync(
      path.join(ROOT, 'src', 'screens', 'coach', 'client-detail', 'useClientDetailData.ts'),
      'utf8',
    );
    expect(hook).toContain('subtitle: workoutTimelineSubtitle(s)');
  });
});

describe('Resume carries the saved workout name and coach assignment', () => {
  const stored = { routineName: 'Push A', exercisesJson: '[{"exerciseName":"Bench"}]', assignmentId: 'asg-1' };

  it('adopts the saved coach workout when resumed from Quick Workout', () => {
    expect(resumedSessionRouteParams(stored, { routineName: 'Quick Workout', exercises: '[]' })).toEqual({
      routineName: 'Push A',
      exercises: '[{"exerciseName":"Bench"}]',
      assignmentId: 'asg-1',
    });
  });

  it('drops a different coach assignment when the saved workout was a Quick Workout', () => {
    expect(
      resumedSessionRouteParams(
        { routineName: 'Quick Workout', exercisesJson: '[]' },
        { routineName: 'Legs B', exercises: '[]', assignmentId: 'asg-2' },
      ),
    ).toEqual({ routineName: 'Quick Workout', exercises: '[]', assignmentId: undefined });
  });

  it('changes nothing when the same workout is opened again', () => {
    expect(resumedSessionRouteParams(stored, { routineName: 'Push A', exercises: '[]', assignmentId: 'asg-1' })).toBeNull();
  });

  it('is applied on the Resume button of the prompt', () => {
    const screen = fs.readFileSync(path.join(ROOT, 'src', 'screens', 'client', 'ActiveWorkoutScreen.tsx'), 'utf8');
    const resumeIdx = screen.indexOf("text: 'Resume',");
    expect(resumeIdx).toBeGreaterThan(-1);
    const block = screen.slice(resumeIdx, resumeIdx + 1200);
    expect(block).toContain('resumedSessionRouteParams(session');
    expect(block).toContain('navigation.setParams(carried)');
  });
});

describe('Recent Workouts history', () => {
  function session(id: string, daysAgo: number, notes = '') {
    return {
      id,
      date: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      workout_name: `W ${id}`,
      duration_minutes: 30,
      notes,
      exercises: [],
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => session(id, i * 3, id === 'a' ? 'Short on time' : ''));
    mockGetAll.mockImplementation(async (limit: number) => ({ data: seven.slice(0, limit) }));
  });

  it('shows older workouts on request, not only the 5 newest', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByTestId('workout-history-toggle')).toBeTruthy());
    expect(view.queryByText('W g')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('workout-history-toggle'));
    });
    expect(view.getByText('W g')).toBeTruthy();
    expect(view.getByText('Show recent workouts only')).toBeTruthy();
  });

  it('shows the note written at Finish on the history card', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByTestId('workout-note-a')).toBeTruthy());
    expect(view.getByText('Note: Short on time')).toBeTruthy();
  });
});
