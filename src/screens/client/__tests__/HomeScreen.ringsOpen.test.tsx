/**
 * Refresh on open, Home's own reads (rings Home): today and the workouts re-read on a refocus and on a
 * return to the foreground, quietly, keeping the verified Train dial and button meanwhile. Flag off,
 * today's Home is unchanged.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { getTodayString } from '../../../utils/date';

let mockRings = true;
let mockFocused = true;
const mockVisits = new Set<() => void>();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  // Focus as React Navigation runs it: the effect runs while focused and cleans up on blur.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const R = require('react');
    const [visit, setVisit] = R.useState(0);
    R.useEffect(() => {
      const bump = () => setVisit((n: number) => n + 1);
      mockVisits.add(bump);
      return () => { mockVisits.delete(bump); };
    }, []);
    R.useEffect(() => (mockFocused ? cb() : undefined), [cb, visit]);
  },
}));
const appState = new Set<(s: AppStateStatus) => void>();
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
  appState.add(handler as (s: AppStateStatus) => void);
  return { remove: () => appState.delete(handler as (s: AppStateStatus) => void) } as ReturnType<typeof AppState.addEventListener>;
});
jest.mock('../../../config/featureFlags', () => {
  const flags = { ...jest.requireActual('../../../config/featureFlags').featureFlags };
  Object.defineProperty(flags, 'clientHomeRings', { get: () => mockRings });
  return { featureFlags: flags };
});
const mockUser = { id: 'u1', coach_id: 'c1', profile: { workout_days_per_week: 3 } };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 1850, protein: 150, carbs: 200, fat: 60 }) }));
const mockDay = {
  foodLogs: [], dailyTotals: { calories: 1030, protein: 73, carbs: 100, fat: 38 }, waterOz: 48, selectedDate: getTodayString(),
  hasLoadedDay: true, loadDayData: jest.fn(async () => undefined), loadProfile: jest.fn(async () => undefined), isLoading: false, loadError: null,
};
jest.mock('../../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockDay, { getState: () => mockDay }) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
const mockAssignments = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() }, workoutApi: { getAll: async () => ({ data: [] }) } }));
jest.mock('../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: () => mockAssignments() } }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
// The layouts themselves: the rings layout records what Home hands it; today's Home renders nothing here.
const mockRingsProps = jest.fn();
jest.mock('../home/RingsHomeScreen', () => (p: unknown) => { mockRingsProps(p); return null; });
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ entitlementActive: true, confirmedActive: true, status: 'active' }) }));
jest.mock('../../../components/home/HomeHeaderActions', () => () => null);
jest.mock('../../../components/coachless/CoachlessHomeSlot', () => () => null);
jest.mock('../../../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../../../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../../../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../../../components/PendingInviteBanner', () => () => null);
jest.mock('../../../components/join/FinishJoining', () => () => null);
jest.mock('../../../components/home/ProfileNudge', () => () => null);
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../../../components/home/FullMacrosIntroCard', () => () => null);

import HomeScreen from '../HomeScreen';

const focus = (on: boolean) => act(() => { mockFocused = on; mockVisits.forEach((bump) => bump()); });
const foreground = () => act(() => { appState.forEach((h) => h('active')); });
const lastWorkout = () => (mockRingsProps.mock.calls[mockRingsProps.mock.calls.length - 1]?.[0] as { workout: { exists: unknown; hasCoachPlan: boolean } }).workout;

beforeEach(() => {
  jest.clearAllMocks();
  mockRings = true; mockFocused = true;
  mockAssignments.mockResolvedValue([{ id: 'a2', scheduled_for: getTodayString(), completed_at: null, workout_plan: { name: 'Full Body A' } }]);
});

it('a refocus and a return to the foreground re-read today and the workouts, keeping the Train dial and button meanwhile', async () => {
  await render(<HomeScreen />);
  await waitFor(() => expect(lastWorkout().exists).toBe(true));
  expect(lastWorkout().hasCoachPlan).toBe(true);
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(1); // the mount's read
  expect(mockAssignments).toHaveBeenCalledTimes(1);
  mockRingsProps.mockClear();

  await focus(false);
  await focus(true);
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(2);
  expect(mockDay.loadDayData).toHaveBeenLastCalledWith('u1', getTodayString());
  await waitFor(() => expect(mockAssignments).toHaveBeenCalledTimes(2));

  await foreground();
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(3);
  await waitFor(() => expect(mockAssignments).toHaveBeenCalledTimes(3));
  // Quiet: no pull spinner, and never back to loading while the reads run.
  expect(mockRingsProps.mock.calls.every(([p]) => (p as { refreshing: boolean }).refreshing === false)).toBe(true);
  expect(mockRingsProps.mock.calls.every(([p]) => (p as { workout: { exists: unknown } }).workout.exists === true)).toBe(true);
  expect(mockDay.loadProfile).toHaveBeenCalledTimes(1);
});

it("flag off: today's Home does not re-read on a return to the foreground", async () => {
  mockRings = false;
  await render(<HomeScreen />);
  await waitFor(() => expect(mockAssignments).toHaveBeenCalledTimes(1));
  await foreground();
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(1);
  expect(mockAssignments).toHaveBeenCalledTimes(1);
  expect(mockRingsProps).not.toHaveBeenCalled();
});
