/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { ClientWorkoutAssignmentWithPlan } from '../api/workoutBuilderApi';
import PlanExplanationCard from '../components/tutorial/PlanExplanationCard';
import { featuredWorkout } from '../screens/client/train/TrainToday';
let mockRows: ClientWorkoutAssignmentWithPlan[] = [];
const mockNavigate = jest.fn();
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientTutorial: true } }));
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockRows, isLoading: false }),
}));
jest.mock('../tutorial/tutorialStore', () => ({
  useTutorialStore: (select: (state: unknown) => unknown) => select({
    payload: { program: { name: 'Strength base', weeks: 8, days_per_week: 3, why: [] },
      coach: { display_name: 'Sam' } },
  }),
}));
jest.mock('../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../components/tutorial/TutorialTarget', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ getParent: () => ({ navigate: mockNavigate }) }),
}));
const row = (id: string, day: string, skipped = false) => ({
  id, scheduled_for: day, completed_at: null,
  ...(skipped ? { skipped_at: `${day}T12:00:00Z` } : {}),
  workout_plan: { name: id, exercises: [] },
}) as unknown as ClientWorkoutAssignmentWithPlan;
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  jest.setSystemTime(new Date('2026-10-30T19:00:00Z'));
});
afterEach(() => jest.useRealTimers());
it.each([
  ['control: two future rows', [row('next', '2026-11-02'), row('later', '2026-11-04')]],
  ['an overdue workout beside the next one', [row('missed', '2026-10-26'), row('next', '2026-11-02')]],
  ['a skipped workout beside the next one', [row('skipped', '2026-10-30', true), row('next', '2026-11-02')]],
  ['two overdue workouts', [row('older', '2026-10-26'), row('latest', '2026-10-28')]],
] as const)('LS-917R3 B5: Next opens TrainToday first for %s', async (_name, rows) => {
  mockRows = [...rows];
  const expected = featuredWorkout(mockRows, '2026-10-30');
  expect(expected).not.toBeNull();
  const view = await render(<PlanExplanationCard />);
  await fireEvent.press(view.getByTestId('plan-next-day'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', {
    screen: 'WorkoutAssignmentDetail', params: { assignmentId: expected!.id }, initial: false,
  });
});
