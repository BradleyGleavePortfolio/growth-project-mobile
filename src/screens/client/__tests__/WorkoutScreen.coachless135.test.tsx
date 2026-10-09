/**
 * B-COACHLESS-135 (B22/B29, CLIENT-POLISH-134 proposed item 7). Coach
 * guidelines are package-only on the server (GET /coach/my-guidelines), so a
 * client with no coach who tapped the Train header icon only met a coach gate.
 * The icon now follows the coachless check the entitlement gate already uses
 * (useCoachlessClient: the user cache mirror first, then the signed-in user),
 * so a client who just joined a coach with a code sees it straight away.
 */
import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CurrentUser } from '../../../hooks/useCurrentUser';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { romanChat: false, clientTutorial: false } }));

let mockUser: CurrentUser = { id: 'c1', email: 'c1@example.test', role: 'client' };
let mockCached: CurrentUser | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({
  ...jest.requireActual('../../../lib/userCache'),
  readUserCacheSync: () => mockCached,
}));

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: jest.fn(), getParent: () => ({ navigate: mockNavigate }) };
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => mockNavigation,
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
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: jest.fn(async () => ({ data: [] })),
    getAll: jest.fn(async () => ({ data: [] })),
    getVolume: jest.fn(async () => ({ data: [] })),
    deleteWorkout: jest.fn(async () => ({})),
  },
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: [], refetch: async () => ({}) }),
}));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: jest.fn(async () => null) }));
jest.mock('../../../offline', () => ({
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: async () => undefined,
  workoutSyncEvents: { on: () => undefined, off: () => undefined },
}));
jest.mock('../../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);

import WorkoutScreen from '../WorkoutScreen';

const SOLO: CurrentUser = { id: 'c1', email: 'c1@example.test', role: 'client' };
const COACHED: CurrentUser = { ...SOLO, coach_id: 'coach-1' };

async function mount() {
  const view = await render(<WorkoutScreen />);
  await waitFor(() => expect(view.getByText('Quick workout')).toBeTruthy());
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockUser = SOLO;
  mockCached = null;
});

describe('Train header: Coach guidelines only with a coach (B22/B29)', () => {
  it('a client with no coach sees no Coach guidelines button; Exercise library and Quick workout stay', async () => {
    const view = await mount();
    expect(view.queryByLabelText('Coach guidelines')).toBeNull();
    expect(view.queryByTestId('workout-coach-guidelines')).toBeNull();
    await fireEvent.press(view.getByLabelText('Exercise library'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ExerciseLibrary');
    await fireEvent.press(view.getByLabelText('Quick workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' });
    expect(mockNavigate).not.toHaveBeenCalledWith('CoachGuidelines');
  });

  it('a client with a coach keeps Coach guidelines, and it opens the guidelines', async () => {
    mockUser = COACHED;
    const view = await mount();
    await fireEvent.press(view.getByLabelText('Coach guidelines'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CoachGuidelines');
  });

  it('a client who just joined a coach with a code (cache mirror patched) sees it at once', async () => {
    mockCached = COACHED;
    const view = await mount();
    expect(view.getByTestId('workout-coach-guidelines')).toBeTruthy();
  });

  it('follows the cache mirror the same way when it says there is no coach', async () => {
    mockUser = COACHED;
    mockCached = SOLO;
    const view = await mount();
    expect(view.queryByLabelText('Coach guidelines')).toBeNull();
  });
});
