/**
 * FU-WORKLOG-126 (agent 126): client workout logging on the 10-07 build.
 *
 *   - The Workouts tab refetches coach-assigned workouts on pull-to-refresh,
 *     on return to the tab and when the app comes back to the foreground. It
 *     used to keep the first list for the life of the app, so a workout the
 *     coach assigned later never showed up until a full restart.
 *   - "This Week" counts every workout in the last 7 days, not just the 5
 *     most recent ones.
 *   - The coach's note on an assigned exercise is shown during the live
 *     workout (it used to show only on the screen before Start).
 */
import React from 'react';
import { AppState } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: false, clientTutorial: false },
}));

// A stable user object, as the real hook returns (a new object per render
// would re-run the screen's load effect on every render).
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

const mockRefetch = jest.fn(async () => ({ data: [] }));
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: [], isLoading: false, refetch: mockRefetch }),
}));

jest.mock('../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../components/tutorial/PlanExplanationCard', () => () => null);

import WorkoutScreen from '../screens/client/WorkoutScreen';
import { ExerciseCard } from '../screens/client/active-workout/ExerciseCard';
import { makeStyles } from '../screens/client/active-workout/styles';
import { testColors } from '../screens/client/wearables/recoveryTestColors';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

function session(id: string, daysAgo: number) {
  return {
    id,
    date: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    workout_name: `W ${id}`,
    duration_minutes: 30,
    notes: '',
    exercises: [],
  };
}

let appStateListeners: Array<(s: string) => void> = [];

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateListeners.push(handler as (s: string) => void);
    return { remove: jest.fn() };
  });
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => session(id, i % 6));
  mockGetAll.mockImplementation(async (limit: number) => ({ data: six.slice(0, limit) }));
});

describe('FU-WORKLOG-126 Workouts tab', () => {
  it('refetches coach-assigned workouts on pull-to-refresh', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Workouts')).toBeTruthy());
    expect(mockRefetch).not.toHaveBeenCalled();
    await act(async () => {
      await view.getByTestId('workout-scroll').props.refreshControl.props.onRefresh();
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('refetches coach-assigned workouts when the app returns to the foreground', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Workouts')).toBeTruthy());
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(appStateListeners.length).toBeGreaterThan(0);
    await act(async () => {
      appStateListeners.forEach((l) => l('active'));
    });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('counts every workout in the last 7 days, not only the 5 most recent', async () => {
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByTestId('workout-week-count').props.children).toBe(6));
  });
});

describe('FU-WORKLOG-126 coach note in the live workout', () => {
  const planRow = (notes: string | null) => ({
    id: 'row-1',
    workout_plan_id: 'p1',
    exercise_external_id: 'seed:bench-press',
    order: 1,
    sets: 3,
    reps_or_duration_seconds: 8,
    weight_lbs: null,
    rest_seconds: 90,
    superset_group_id: null,
    notes,
  });

  it('carries the coach note into the session seed', () => {
    expect(buildActiveWorkoutExercises({ exercises: [planRow('  Pause at the bottom ')] })[0].coachNote)
      .toBe('Pause at the bottom');
    expect(buildActiveWorkoutExercises({ exercises: [planRow(null)] })[0].coachNote).toBeUndefined();
  });

  it('shows the coach note on the exercise card', async () => {
    const styles = makeStyles(testColors);
    const exercise = {
      exerciseId: 'seed:bench-press',
      exerciseName: 'Bench Press',
      restSec: 90,
      coachNote: 'Pause at the bottom',
      sets: [{ reps: 8, weight: 135, completed: false }],
    };
    const view = await render(
      <ExerciseCard
        exercise={exercise}
        exIdx={0}
        onUpdateSet={jest.fn()}
        onToggleSetComplete={jest.fn()}
        onAddSet={jest.fn()}
        onRemoveExercise={jest.fn()}
        onOpenExerciseDetail={jest.fn()}
        colors={testColors}
        styles={styles}
      />,
    );
    expect(view.getByTestId('coach-note-0')).toBeTruthy();
    expect(view.getByText('Coach note: Pause at the bottom')).toBeTruthy();
  });
});
