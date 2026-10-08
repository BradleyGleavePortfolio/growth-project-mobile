import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetAll = jest.fn();
const mockListAssignments = jest.fn();
const mockLoadSession = jest.fn();
const mockNavigate = jest.fn();
const mockTabNavigate = jest.fn();
let mockOnFocus: (() => void) | undefined;
const mockNavigation = {
  navigate: mockNavigate,
  getParent: () => ({ navigate: mockTabNavigate }),
  addListener: jest.fn((_event: string, callback: () => void) => {
    mockOnFocus = callback;
    return jest.fn();
  }),
};
const mockUser = { id: 'client-entry-127', profile: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { assignmentId: 'assignment-127' } }),
  useFocusEffect: (callback: () => void) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(callback, [callback]);
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../store/clientStore', () => ({
  useClientStore: () => ({
    foodLogs: [], dailyTotals: {}, waterOz: 0, isLoading: false, loadError: null,
    loadDayData: jest.fn(), loadProfile: jest.fn(),
  }),
}));
jest.mock('../services/api', () => ({
  workoutApi: { getAll: (...args: unknown[]) => mockGetAll(...args) },
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { listMyAssignments: () => mockListAssignments() },
}));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...args: unknown[]) => mockLoadSession(...args),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/profileCompletion', () => ({
  getProfileCompletion: () => ({ isComplete: true, missing: [], percentComplete: 100 }),
  summarizeMissing: () => '',
}));
jest.mock('../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../components/PendingInviteBanner', () => () => null);
jest.mock('../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../components/home/HomeHeaderActions', () => () => null);
jest.mock('../components/home/PushPermissionCard', () => () => null);
jest.mock('../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../components/coachless/CoachlessHomeSlot', () => () => null);
jest.mock('../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../components/home/FullMacrosIntroCard', () => () => null);

const PLAN = {
  id: 'assignment-127', completed_at: null as string | null, post_rpe: null,
  workout_plan: {
    id: 'plan-127', name: 'Upper A', type: 'strength', duration_estimate_minutes: 45,
    exercises: [{
      id: 'exercise-row-127', exercise_external_id: 'bench', order: 1,
      sets: 3, reps_or_duration_seconds: 8, weight_lbs: 95, rest_seconds: 60, notes: null,
    }],
  },
};
let mockAssignment = PLAN;
let mockNamesLoading = false;
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignment: () => ({
    data: mockAssignment, isLoading: false, isError: false,
    refetch: jest.fn(), isRefetching: false,
  }),
}));
jest.mock('../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { bench: 'Bench Press' }, loading: mockNamesLoading }),
}));

import HomeScreen from '../screens/client/HomeScreen';
import WorkoutAssignmentDetailScreen from '../screens/client/WorkoutAssignmentDetailScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAll.mockResolvedValue({ data: [] });
  mockListAssignments.mockResolvedValue([]);
  mockLoadSession.mockResolvedValue(null);
  mockAssignment = PLAN;
  mockNamesLoading = false;
  mockOnFocus = undefined;
});

describe('U-V1-5: assigned workout entry from Home', () => {
  it('opens the first assigned workout from Home, without claiming completion', async () => {
    mockListAssignments.mockResolvedValue([PLAN]);
    const screen = await render(<HomeScreen />);
    const continueButton = await screen.findByTestId('home-continue-cta');
    expect(screen.queryByTestId('home-explore-cta')).toBeNull();
    expect(screen.queryByText(/Workout complete/)).toBeNull();
    await fireEvent.press(continueButton);
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', {
      screen: 'WorkoutAssignmentDetail', initial: false, params: { assignmentId: PLAN.id },
    });
    expect(mockListAssignments).toHaveBeenCalledTimes(1);
  });

  it('offers Explore only when both history and pending assignments are empty', async () => {
    const screen = await render(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId('home-explore-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Log');
  });

  it('does not count completed assignments as pending', async () => {
    mockListAssignments.mockResolvedValue([{ ...PLAN, completed_at: 'completed' }]);
    const screen = await render(<HomeScreen />);
    expect(await screen.findByTestId('home-explore-cta')).toBeTruthy();
  });

  it('finds a pending assignment after a completed assignment', async () => {
    mockListAssignments.mockResolvedValue([{ ...PLAN, completed_at: 'completed' }, PLAN]);
    const screen = await render(<HomeScreen />);
    expect(await screen.findByTestId('home-continue-cta')).toBeTruthy();
  });

  it('still offers Continue when there is workout history and no assignment', async () => {
    mockGetAll.mockResolvedValue({ data: [{ date: '2026-01-01' }] });
    const screen = await render(<HomeScreen />);
    expect(await screen.findByTestId('home-continue-cta')).toBeTruthy();
  });

  it('keeps the loading placeholder until the assignment query settles', async () => {
    let release: (value: typeof PLAN[]) => void = () => { throw new Error('Not started'); };
    mockListAssignments.mockImplementation(() => new Promise<typeof PLAN[]>((resolve) => {
      release = resolve;
    }));
    const screen = await render(<HomeScreen />);
    expect(screen.getByTestId('cta-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('home-explore-cta')).toBeNull();
    await act(async () => { release([PLAN]); });
    expect(await screen.findByTestId('home-continue-cta')).toBeTruthy();
  });

  it('keeps workouts reachable when the assignment query fails', async () => {
    mockListAssignments.mockRejectedValue(new Error('Connection unavailable'));
    const screen = await render(<HomeScreen />);
    expect(await screen.findByTestId('home-continue-cta')).toBeTruthy();
    expect(screen.queryByTestId('home-explore-cta')).toBeNull();
  });

  it('preserves the existing Continue fallback when history fails', async () => {
    mockGetAll.mockRejectedValue(new Error('Connection unavailable'));
    const screen = await render(<HomeScreen />);
    expect(await screen.findByTestId('home-continue-cta')).toBeTruthy();
  });
});

describe('U-V1-8: assigned workout Start and Resume labels', () => {
  it('uses Resume and matching accessibility text only for the saved assignment', async () => {
    mockLoadSession.mockResolvedValue({ session: { assignmentId: PLAN.id } });
    const screen = await render(<WorkoutAssignmentDetailScreen />);
    expect(await screen.findByText('Resume workout')).toBeTruthy();
    expect(screen.getByLabelText('Resume workout Upper A')).toBeTruthy();
    expect(mockLoadSession).toHaveBeenCalledWith(mockUser.id);
    await fireEvent.press(screen.getByTestId('assignment-start'));
    expect(mockTabNavigate).toHaveBeenCalledWith('WorkoutTab', {
      screen: 'ActiveWorkout',
      initial: false,
      params: expect.objectContaining({ assignmentId: PLAN.id, routineId: 'plan-127' }),
    });
    expect(JSON.parse(mockTabNavigate.mock.calls[0][1].params.exercises)[0].exerciseName)
      .toBe('Bench Press');
  });

  it.each([null, { session: { assignmentId: 'another-assignment' } }, { session: {} }])(
    'keeps Start when there is no matching saved assignment (%j)',
    async (saved) => {
      mockLoadSession.mockResolvedValue(saved);
      const screen = await render(<WorkoutAssignmentDetailScreen />);
      expect(await screen.findByText('Start workout')).toBeTruthy();
      expect(screen.getByLabelText('Start workout Upper A')).toBeTruthy();
      expect(screen.queryByText('Resume workout')).toBeNull();
    },
  );

  it('rereads the session on focus after the live workout is closed', async () => {
    mockLoadSession.mockResolvedValue({ session: { assignmentId: PLAN.id } });
    const screen = await render(<WorkoutAssignmentDetailScreen />);
    expect(await screen.findByText('Resume workout')).toBeTruthy();
    mockLoadSession.mockResolvedValue(null);
    await act(async () => { mockOnFocus?.(); });
    await waitFor(() => expect(mockLoadSession).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Start workout')).toBeTruthy();
    expect(screen.queryByText('Resume workout')).toBeNull();
  });

  it('keeps the existing exercise-name loading gate while a session matches', async () => {
    mockNamesLoading = true;
    mockLoadSession.mockResolvedValue({ session: { assignmentId: PLAN.id } });
    const screen = await render(<WorkoutAssignmentDetailScreen />);
    expect(screen.getByLabelText('Loading exercise names').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });
    await fireEvent.press(screen.getByTestId('assignment-start'));
    expect(mockTabNavigate).not.toHaveBeenCalled();
  });

  it('keeps completed assignments free of a Start or Resume action', async () => {
    mockAssignment = { ...PLAN, completed_at: 'completed' };
    mockLoadSession.mockResolvedValue({ session: { assignmentId: PLAN.id } });
    const screen = await render(<WorkoutAssignmentDetailScreen />);
    expect(screen.queryByTestId('assignment-start')).toBeNull();
    expect(screen.getByText('Completed')).toBeTruthy();
  });
});
