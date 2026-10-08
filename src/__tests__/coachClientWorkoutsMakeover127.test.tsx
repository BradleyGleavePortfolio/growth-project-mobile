import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientDetailScreen from '../screens/coach/ClientDetailScreen';
import { WorkoutsTab } from '../screens/coach/client-detail/WorkoutsTab';
import { makeStyles } from '../screens/coach/client-detail/styles';
import type { Props, WorkoutSession } from '../screens/coach/client-detail/types';
import { testColors } from '../screens/client/wearables/recoveryTestColors';

jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, name) }));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  // Preserve lazy native getters instead of evaluating unrelated native modules.
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(actual),
    RefreshControl: { enumerable: true, value: ({ onRefresh, children }: { onRefresh: () => void; children?: React.ReactNode }) =>
      jest.requireActual('react').createElement(actual.View, { accessible: true, accessibilityLabel: 'Refresh client', onRefresh }, children) },
    Modal: { enumerable: true, value: ({ onRequestClose, children }: { onRequestClose: () => void; children?: React.ReactNode }) =>
      jest.requireActual('react').createElement(actual.View, { accessible: true, accessibilityLabel: 'Native picker back', onRequestClose }, children) },
  });
});
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
const mockArchive = jest.fn(async (..._args: unknown[]) => undefined);
const mockUnarchive = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('../services/api', () => ({ coachApi: {
  archiveClient: (...a: unknown[]) => mockArchive(...a), unarchiveClient: (...a: unknown[]) => mockUnarchive(...a),
} }));
const mockDetail = {
  profile: {}, totals: {}, foodShared: true, workoutSessions: [], weightLogs: [], timeline: [], weekSummaries: [],
  timelineLoading: false, timelineError: null as string | null, weeklyLoading: false, weeklyError: null as string | null,
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
const mockTimelineTab = jest.fn((_props: { days: number; loading?: boolean; error?: string | null; onLoad: () => void }) =>
  React.createElement(require('react-native').Text, null, 'Timeline content'));
const mockWeeklyTab = jest.fn((_props: { days: number; loading?: boolean; error?: string | null; onRetry: () => void }) =>
  React.createElement(require('react-native').Text, null, 'Weekly content'));
jest.mock('../screens/coach/client-detail/TimelineTab', () => ({ TimelineTab: (props: Parameters<typeof mockTimelineTab>[0]) => mockTimelineTab(props) }));
jest.mock('../screens/coach/client-detail/WeeklySummaryTab', () => ({ WeeklySummaryTab: (props: Parameters<typeof mockWeeklyTab>[0]) => mockWeeklyTab(props) }));
jest.mock('../screens/coach/client-detail/DateRangeSelector', () => ({ DateRangeSelector: () => null }));
jest.mock('../screens/coach/client-detail/PlanFormModal', () => ({ PlanFormModal: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: () => null }));
jest.mock('../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));

const session = (id: string, weight = 135, rpe: number | null = 8): WorkoutSession => ({
  id, routineName: 'Push day', startTime: new Date().toISOString(), completed: true, durationMinutes: 45,
  notes: 'Felt strong', exercises: JSON.stringify([{
    exerciseId: 'bench', exerciseName: 'Bench press', notes: 'Shoulder fine', rpe,
    sets: [{ weight, reps: 8, completed: true }],
  }]),
});
const tabProps = { colors: testColors, styles: makeStyles(testColors), clientName: 'Sam Lee' };
const screenProps = (navigate: Props['navigation']['navigate'], goBack: Props['navigation']['goBack']): Props => ({
  navigation: { navigate, goBack } as Props['navigation'],
  route: { key: 'client-detail', name: 'ClientDetail', params: { clientId: 'client-1', clientName: 'Sam Lee' } },
});
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

it('honors the meal-plan destination on mount and on return to the same client', async () => {
  const props = screenProps(jest.fn(), jest.fn());
  const mealProps: Props = { ...props, route: { ...props.route,
    params: { ...props.route.params, initialTab: 'mealplan' } } };
  const s = await render(<ClientDetailScreen {...mealProps} />);
  expect(s.getByText('Plan content')).toBeTruthy();
  expect(mockDetail.loadServerMealPlans).toHaveBeenCalled();
  await s.rerender(<ClientDetailScreen {...props} />);
  expect(s.getByText('Summary content')).toBeTruthy();
  await s.rerender(<ClientDetailScreen {...mealProps} />);
  expect(s.getByText('Plan content')).toBeTruthy();
});

it('uses the honest weekly fallback, hairline rows, and preserves all recorded details', async () => {
  const old = { ...session('old'), startTime: '2025-01-01T12:00:00Z' };
  const s = await render(<WorkoutsTab {...tabProps} workoutSessions={[session('a'), old]} />);
  expect(s.getByText('1 shared workout this week')).toBeTruthy();
  expect(s.queryByText(/\d+ of \d+ workouts/)).toBeNull();
  expect(s.getAllByText('Done')).toHaveLength(2);
  expect(s.getByTestId('coach-session-a')).toHaveStyle({ backgroundColor: testColors.background, borderBottomWidth: StyleSheet.hairlineWidth });
  for (const text of ['Exercises', 'Sets', 'Volume (lb)', 'Bench press', '1 set · 135 lb x 8', 'Client note: Shoulder fine', 'Workout note: Felt strong', 'RPE 8']) {
    expect(s.getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(s.getAllByText(/· 45 min$/)).toHaveLength(2);
});

it('keeps empty and unfinished states honest without invented duration, schedule or trajectory', async () => {
  const s = await render(<WorkoutsTab {...tabProps} workoutSessions={[]} />);
  expect(s.getByText('0 shared workouts this week')).toBeTruthy();
  expect(s.getByText('No shared workout sessions to show')).toBeTruthy();
  expect(s.queryByTestId('workouts-build-with-ai')).toBeNull();
  expect(s.queryByTestId('workouts-adjust-with-ai')).toBeNull();
  expect(s.queryByTestId('coach-strength-trajectory')).toBeNull();
  await s.rerender(<WorkoutsTab {...tabProps} workoutSessions={[{ ...session('a', 135, null), completed: false, durationMinutes: null }]} />);
  expect(s.getByText('In progress')).toBeTruthy();
  expect(s.queryByText(/0 min|Missed|Upcoming|On track/)).toBeNull();
  expect(s.queryByText(/RPE/)).toBeNull();
  expect(s.queryByTestId('coach-strength-trajectory')).toBeNull();
});

it('does not call withheld workout history a zero total and keeps the build action', async () => {
  // The existing backend returns an empty visible list when sharing is off.
  const build = jest.fn();
  const s = await render(<WorkoutsTab {...tabProps} workoutSessions={[]} onBuildWithAi={build} />);
  expect(s.getByText('0 shared workouts this week')).toBeTruthy();
  expect(s.getByText('No shared workout sessions to show')).toBeTruthy();
  expect(s.queryByText('0 workouts this week')).toBeNull();
  await fireEvent.press(s.getByTestId('workouts-build-with-ai'));
  expect(build).toHaveBeenCalledTimes(1);
});

it('shows only real same-exercise strength points, and only with at least two', async () => {
  const s = await render(<WorkoutsTab {...tabProps} workoutSessions={[session('a')]} />);
  expect(s.queryByTestId('coach-strength-trajectory')).toBeNull();
  await s.rerender(<WorkoutsTab {...tabProps} workoutSessions={[session('a'), {
    ...session('b'), exercises: JSON.stringify([{ exerciseId: 'row', exerciseName: 'Row', sets: [{ weight: 95, reps: 8, completed: true }] }]),
  }]} />);
  expect(s.queryByTestId('coach-strength-trajectory')).toBeNull();
  await s.rerender(<WorkoutsTab {...tabProps} workoutSessions={[session('a'), session('b', 145)]} />);
  expect(s.getByTestId('coach-strength-trajectory')).toBeTruthy();
  expect(s.getByText('Bench press · top recorded load (lb)')).toBeTruthy();
});

it('preserves all nine tab destinations and both AI actions, including client-copy navigation', async () => {
  const navigate = jest.fn(); const goBack = jest.fn();
  const props = screenProps(navigate, goBack);
  const s = await render(<ClientDetailScreen {...props} />);
  for (const label of ['Summary', 'Logs', 'Plan', 'Progress', 'Fitness', 'Recovery', 'Timeline', 'Weekly']) {
    await fireEvent.press(s.getByText(label));
    expect(s.getByText(`${label} content`)).toBeTruthy();
    expect(s.getByRole('tab', { name: label })).toHaveStyle({ minWidth: 44, minHeight: 48 });
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
  await fireEvent(s.getByLabelText('Native picker back'), 'requestClose');
  expect(s.queryByTestId('adjust-for-client-sheet')).toBeNull();
  await fireEvent.press(s.getByLabelText('Adjust a saved workout for Sam'));
  await fireEvent.press(s.getByLabelText('Adjust Push day for Sam'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('CoachWorkoutBuilder', {
    planId: 'copy-1', openAi: true, clientId: 'client-1', clientName: 'Sam Lee',
  }));
});

it('wires independent Timeline and Weekly load states and retries the selected period (agent 132)', async () => {
  const props = screenProps(jest.fn(), jest.fn());
  const s = await render(<ClientDetailScreen {...props} />);
  mockDetail.timelineError = 'Timeline could not load.';
  mockDetail.weeklyError = 'Weekly summary could not load.';
  mockDetail.weeklyLoading = true;
  await fireEvent.press(s.getByText('Timeline'));
  const timeline = mockTimelineTab.mock.calls.at(-1)![0];
  expect(timeline).toMatchObject({ days: 90, error: mockDetail.timelineError, loading: false });
  timeline.onLoad();
  expect(mockDetail.loadTimeline).toHaveBeenLastCalledWith(90);
  await fireEvent.press(s.getByText('Weekly'));
  const weekly = mockWeeklyTab.mock.calls.at(-1)![0];
  expect(weekly).toMatchObject({ days: 90, error: mockDetail.weeklyError, loading: true });
  weekly.onRetry();
  expect(mockDetail.loadWeeklySummaries).toHaveBeenLastCalledWith(90);
  mockDetail.timelineError = null;
  mockDetail.weeklyError = null;
  mockDetail.weeklyLoading = false;
});

it('preserves the surrounding header actions and refresh handler', async () => {
  const navigate = jest.fn(); const goBack = jest.fn();
  const props = screenProps(navigate, goBack);
  const s = await render(<ClientDetailScreen {...props} />);
  await fireEvent.press(s.getByText('arrow-back')); expect(goBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(s.getByText('chatbubble-outline')); expect(navigate).toHaveBeenCalledWith('ClientMessages', { clientId: 'client-1', clientName: 'Sam Lee' });
  await fireEvent.press(s.getByLabelText('Archive client')); expect(mockArchive).toHaveBeenCalledWith('client-1');
  mockDetail.isArchived = true;
  await s.rerender(<ClientDetailScreen {...props} />);
  await fireEvent.press(s.getByLabelText('Unarchive client')); expect(mockUnarchive).toHaveBeenCalledWith('client-1');
  mockDetail.isArchived = false;
  await fireEvent(s.getByLabelText('Refresh client'), 'refresh');
  expect(mockDetail.setRefreshing).toHaveBeenCalledWith(true);
  expect(mockDetail.setRefreshing).toHaveBeenCalledWith(false);
  expect(mockDetail.loadData).toHaveBeenCalledTimes(2);
});
