import React from 'react';
import { Alert, RefreshControl } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientDetailScreen from '../screens/coach/ClientDetailScreen';
import { WorkoutsTab } from '../screens/coach/client-detail/WorkoutsTab';
import { makeStyles } from '../screens/coach/client-detail/styles';
import type { WorkoutSession } from '../screens/coach/client-detail/types';
import { testColors } from '../screens/client/wearables/recoveryTestColors';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
  semanticColors: jest.requireActual('../theme/tokens').lightTokens,
}) }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isLoading: false, flags: {} }) }));
jest.mock('../config/featureFlags', () => ({ featureFlags: { mwbAutosave: true } }));
jest.mock('../components/coach/ai-entry/useAiEntryStatus', () => ({ useAiEntryStatus: () => ({ visible: true }) }));
jest.mock('../components/coach/ai-builder/useAiBuilder', () => ({ fireAiHaptic: jest.fn() }));
jest.mock('../hooks/usePrograms', () => ({ useSavedWorkouts: () => ({
  data: { pages: [{ items: [{ id: 'saved-1', name: 'Push day', exercise_count: 1 }] }] },
}) }));
jest.mock('../api/workoutBuilderApi', () => ({ workoutBuilderApi: {
  getPlan: jest.fn(async () => ({ data: { name: 'Push day', type: 'strength', exercises: [] } })),
  createPlan: jest.fn(async () => ({ data: { id: 'copy-1' } })),
  setExercises: jest.fn(async () => undefined),
} }));
const mockArchive = jest.fn(async () => undefined);
jest.mock('../services/api', () => ({ coachApi: { archiveClient: (...a: unknown[]) => mockArchive(...a) } }));
const mockDetail = {
  profile: {}, totals: {}, foodShared: true, workoutSessions: [], weightLogs: [], timeline: [], weekSummaries: [],
  isLoading: false, refreshing: false, isArchived: false, serverMealPlans: [],
  loadData: jest.fn(async () => undefined), loadTimeline: jest.fn(), loadWeeklySummaries: jest.fn(),
  loadServerMealPlans: jest.fn(), setIsArchived: jest.fn(), setRefreshing: jest.fn(),
};
jest.mock('../screens/coach/client-detail/useClientDetailData', () => ({ useClientDetailData: () => mockDetail }));
jest.mock('../screens/coach/client-detail/SummaryTab', () => ({ SummaryTab: ({ openWorkoutRequest }: { openWorkoutRequest: boolean }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, openWorkoutRequest ? 'AI generator requested' : 'Summary content') }));
jest.mock('../screens/coach/client-detail/FoodLogReviewSection', () => ({ FoodLogReviewSection: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Logs content') }));
jest.mock('../screens/coach/client-detail/MealPlanTab', () => ({ MealPlanTab: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Plan content') }));
jest.mock('../screens/coach/client-detail/ProgressTab', () => ({ ProgressTab: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Progress content') }));
jest.mock('../screens/coach/client-detail/HealthFitnessTab', () => ({ HealthFitnessTab: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Fitness content') }));
jest.mock('../screens/coach/client-detail/SleepRecoveryTab', () => ({ SleepRecoveryTab: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Recovery content') }));
jest.mock('../screens/coach/client-detail/TimelineTab', () => ({ TimelineTab: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Timeline content') }));
jest.mock('../screens/coach/client-detail/WeeklySummaryTab', () => ({ WeeklySummaryTab: () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'Weekly content') }));
jest.mock('../screens/coach/client-detail/DateRangeSelector', () => ({ DateRangeSelector: () => null }));
jest.mock('../screens/coach/client-detail/PlanFormModal', () => ({ PlanFormModal: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: () => null }));
jest.mock('../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));

const session = (id: string, weight = 135): WorkoutSession => ({
  id, routineName: 'Push day', startTime: new Date().toISOString(), completed: true, durationMinutes: 45,
  notes: 'Felt strong', exercises: JSON.stringify([{
    exerciseId: 'bench', exerciseName: 'Bench press', notes: 'Shoulder fine', rpe: 8,
    sets: [{ weight, reps: 8, completed: true }],
  }]),
});
const tabProps = { colors: testColors, styles: makeStyles(testColors), clientName: 'Sam Lee' };
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

it('uses the honest weekly fallback, hairline rows, and preserves all recorded details', async () => {
  const old = { ...session('old'), startTime: '2025-01-01T12:00:00Z' };
  const s = await render(<WorkoutsTab {...tabProps} workoutSessions={[session('a'), old]} />);
  expect(s.getByText('1 workout this week')).toBeTruthy();
  expect(s.queryByText(/\d+ of \d+ workouts/)).toBeNull();
  expect(s.getAllByText('Done')).toHaveLength(2);
  expect(s.getByTestId('coach-session-a')).toHaveStyle({ backgroundColor: testColors.background, borderBottomWidth: 0.5 });
  for (const text of ['Exercises', 'Sets', 'Volume (lbs)', 'Bench press', '1 set · 135 lb x 8', 'Client note: Shoulder fine', 'Workout note: Felt strong', 'RPE 8']) {
    expect(s.getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(s.getAllByText(/· 45 min$/)).toHaveLength(2);
});

it('keeps empty and unfinished states honest without invented duration, schedule or trajectory', async () => {
  const s = await render(<WorkoutsTab {...tabProps} workoutSessions={[]} />);
  expect(s.getByText('0 workouts this week')).toBeTruthy();
  expect(s.getByText('No workout sessions yet')).toBeTruthy();
  expect(s.queryByTestId('coach-strength-trajectory')).toBeNull();
  await s.rerender(<WorkoutsTab {...tabProps} workoutSessions={[{ ...session('a'), completed: false, durationMinutes: null }]} />);
  expect(s.getByText('In progress')).toBeTruthy();
  expect(s.queryByText(/0 min|Missed|Upcoming|On track/)).toBeNull();
  expect(s.queryByTestId('coach-strength-trajectory')).toBeNull();
});

it('shows only real same-exercise strength points, and only with at least two', async () => {
  const s = await render(<WorkoutsTab {...tabProps} workoutSessions={[session('a')]} />);
  expect(s.queryByTestId('coach-strength-trajectory')).toBeNull();
  await s.rerender(<WorkoutsTab {...tabProps} workoutSessions={[session('a'), session('b', 145)]} />);
  expect(s.getByTestId('coach-strength-trajectory')).toBeTruthy();
  expect(s.getByText('Bench press · top recorded load (lb)')).toBeTruthy();
});

it('preserves all nine tab destinations and both AI actions, including client-copy navigation', async () => {
  const navigate = jest.fn(); const goBack = jest.fn();
  const props = { navigation: { navigate, goBack }, route: { params: { clientId: 'client-1', clientName: 'Sam Lee' } } } as React.ComponentProps<typeof ClientDetailScreen>;
  const s = await render(<ClientDetailScreen {...props} />);
  for (const label of ['Summary', 'Logs', 'Plan', 'Progress', 'Fitness', 'Recovery', 'Timeline', 'Weekly']) {
    await fireEvent.press(s.getByText(label));
    expect(s.getByText(`${label} content`)).toBeTruthy();
  }
  expect(mockDetail.loadTimeline).toHaveBeenCalledWith(90);
  expect(mockDetail.loadWeeklySummaries).toHaveBeenCalledWith(90);
  expect(mockDetail.loadServerMealPlans).toHaveBeenCalled();
  await fireEvent.press(s.getByText('Workouts'));
  expect(s.getByRole('tab', { name: 'Workouts' }).props.accessibilityState).toEqual({ selected: true });
  expect(s.getByRole('tab', { name: 'Workouts' })).toHaveStyle({ borderBottomWidth: 2, borderRadius: 0, backgroundColor: testColors.background });
  await fireEvent.press(s.getByTestId('workouts-build-with-ai'));
  expect(s.getByText('AI generator requested')).toBeTruthy();
  await fireEvent.press(s.getByText('Workouts'));
  await fireEvent.press(s.getByLabelText('Adjust a saved workout for Sam'));
  await fireEvent.press(s.getByLabelText('Close'));
  expect(s.queryByTestId('adjust-for-client-sheet')).toBeNull();
  await fireEvent.press(s.getByLabelText('Adjust a saved workout for Sam'));
  await fireEvent.press(s.getByLabelText('Adjust Push day for Sam'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('CoachWorkoutBuilder', {
    planId: 'copy-1', openAi: true, clientId: 'client-1', clientName: 'Sam Lee',
  }));
});

it('preserves the surrounding header actions and refresh handler', async () => {
  const navigate = jest.fn(); const goBack = jest.fn();
  const props = { navigation: { navigate, goBack }, route: { params: { clientId: 'client-1', clientName: 'Sam Lee' } } } as React.ComponentProps<typeof ClientDetailScreen>;
  const s = await render(<ClientDetailScreen {...props} />);
  // Existing unnamed header buttons are located by their unchanged handler-bearing order.
  const buttons = s.UNSAFE_getAllByType(jest.requireActual('react-native').TouchableOpacity);
  await fireEvent.press(buttons[0]); expect(goBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(buttons[1]); expect(navigate).toHaveBeenCalledWith('ClientMessages', { clientId: 'client-1', clientName: 'Sam Lee' });
  await fireEvent.press(s.getByLabelText('Archive client')); expect(mockArchive).toHaveBeenCalledWith('client-1');
  await fireEvent(s.UNSAFE_getByType(RefreshControl), 'refresh');
  expect(mockDetail.setRefreshing).toHaveBeenCalledWith(true);
  expect(mockDetail.setRefreshing).toHaveBeenCalledWith(false);
  expect(mockDetail.loadData).toHaveBeenCalledTimes(2);
});
