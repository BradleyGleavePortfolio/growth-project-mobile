/** K1-OVERVIEW (agent 150): the Style C client file behind coachTabsV2; every tap lands somewhere real; flag off, unchanged. */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import ClientDetailScreen from '../screens/coach/ClientDetailScreen';
import { useCoachStore } from '../store/coachStore';
import { coachApi } from '../services/api';
import { macrosApi } from '../api/macrosApi';
import { weekStart } from '../screens/coach/client-detail/thisWeek';
import type { Props } from '../screens/coach/client-detail/types';
import { HapticService } from '../ui/haptics/haptics.service';
import { getTodayString } from '../utils/date';
import { featureFlags } from '../config/featureFlags';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachTabsV2: true } }));
const mockFlags = featureFlags as Record<string, boolean>;
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), mediumImpact: jest.fn(), error: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, name) }));
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
  tokens: jest.requireActual('../theme/tokens').default,
  semanticColors: jest.requireActual('../theme/tokens').lightTokens,
}) }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-test' }) }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isLoading: false, flags: {} }) }));
jest.mock('../services/api', () => ({ coachApi: {
  getClientSummary: jest.fn(), getClientTimeline: jest.fn(), getClients: jest.fn(), archiveClient: jest.fn(), unarchiveClient: jest.fn(),
} }));
jest.mock('../api/macrosApi', () => ({ macrosApi: { currentForClient: jest.fn() } }));
// A function declaration is hoisted with its body, so the factories below can use it.
function mockMarker(id: string) {
  return () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, id);
}
jest.mock('../screens/coach/client-detail/SummaryTab', () => ({ SummaryTab: mockMarker('summary-body') }));
jest.mock('../screens/coach/client-detail/WorkoutsTab', () => ({ WorkoutsTab: mockMarker('workouts-body') }));
jest.mock('../screens/coach/client-detail/FoodLogReviewSection', () => ({ FoodLogReviewSection: mockMarker('logs-body') }));
jest.mock('../screens/coach/client-detail/TimelineTab', () => ({ TimelineTab: mockMarker('timeline-body') }));
jest.mock('../screens/coach/client-detail/ProgressTab', () => ({ ProgressTab: mockMarker('progress-body') }));
jest.mock('../screens/coach/client-detail/MealPlanTab', () => ({ MealPlanTab: () => null }));
jest.mock('../screens/coach/client-detail/HealthFitnessTab', () => ({ HealthFitnessTab: () => null }));
jest.mock('../screens/coach/client-detail/SleepRecoveryTab', () => ({ SleepRecoveryTab: () => null }));
jest.mock('../screens/coach/client-detail/PlanFormModal', () => ({ PlanFormModal: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));
jest.mock('../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: () => null }));

const DAY = 86_400_000;
const monday = weekStart(new Date()).getTime();
const done = { scheduled_for: new Date(monday + 3_600_000).toISOString(), completed_at: new Date(monday + 7_200_000).toISOString() };
const later = Array.from({ length: 20 }, (_, i) => ({ scheduled_for: new Date(monday + (8 + i) * DAY).toISOString(), completed_at: null }));
let summary: Record<string, unknown>;
let timeline: Record<string, unknown>;
const navigate = jest.fn();
const goBack = jest.fn();
const props = {
  navigation: { navigate, goBack } as unknown as Props['navigation'],
  route: { key: 'detail-test', name: 'ClientDetail', params: { clientId: 'client-test', clientName: 'Test client' } },
} as unknown as Props;
const read = coachApi.getClientSummary as jest.Mock;
const week = coachApi.getClientTimeline as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.coachTabsV2 = true;
  useCoachStore.getState().reset();
  const today = `${getTodayString()}T00:00:00.000Z`;
  summary = { client_name: 'Test client', profile: {}, today: {}, recent_assignments: [done], consent: { workouts: true } };
  timeline = {
    meals: [{ id: 'm1', date: today, quantity_multiplier: 1, food_item: { calories: 500 } }],
    checkIns: [{ date: today, reviewed_by_coach: false }], weights: [],
    consent: { workouts: true, food_macros: true, body_metrics: true, habits_progress: true },
  };
  read.mockReset().mockImplementation(async () => ({ data: summary }));
  week.mockReset().mockImplementation(async () => ({ data: timeline }));
  (macrosApi.currentForClient as jest.Mock).mockReset().mockResolvedValue({ data: { calories_kcal: 2100 } });
  (coachApi.getClients as jest.Mock).mockReset().mockResolvedValue({ data: [{ id: 'client-test', name: 'Test client', role: 'student', archived_at: null }] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('flag off: the file is unchanged (Summary first, the old header, no masthead)', async () => {
  mockFlags.coachTabsV2 = false;
  const view = await render(<ClientDetailScreen {...props} />);
  expect(await view.findByText('summary-body')).toBeTruthy();
  expect(view.getByLabelText('Summary').props.accessibilityState).toEqual({ selected: true });
  expect(view.queryByTestId('file-masthead')).toBeNull();
  expect(view.queryByText('This week')).toBeNull();
  expect(week).not.toHaveBeenCalled();
});

it('flag on: opens on This week with the name, the ring, the day strip and the four cards', async () => {
  const view = await render(<ClientDetailScreen {...props} />);
  expect(await view.findByText('Logged 1 of 7 days · Average 500 kcal · target 2,100')).toBeTruthy();
  expect(view.getByLabelText('This week').props.accessibilityState).toEqual({ selected: true });
  expect(view.getByRole('header').props.children).toBe('Test client');
  expect(view.getByLabelText('1 of 1 done')).toBeTruthy();
  expect(view.getAllByText('1 of 1 done').length).toBe(2); // headline and Workouts card
  expect(view.getByTestId('file-day-0').props.accessibilityLabel).toMatch(/^Mon \d+ done$/);
  expect(view.getByText('1 this week · 1 to review')).toBeTruthy();
  expect(view.getByText('Message Test')).toBeTruthy();
  expect(view.queryByText('Clients choose what they share with you. Anything not shared stays private.')).toBeNull();
});

it('the ring is left out when the 20 latest assignments may not hold this week', async () => {
  summary.recent_assignments = later;
  const view = await render(<ClientDetailScreen {...props} />);
  await view.findByText('1 this week · 1 to review');
  expect(view.queryByTestId('file-week')).toBeNull();
  expect(view.getByTestId('file-card-workouts')).toBeTruthy();
  expect(view.queryByText(/ of \d+ done/)).toBeNull();
});

// Tap map: every tap lands somewhere real.
it.each<[string, string, (v: Awaited<ReturnType<typeof render>>) => void]>([
  ['Workouts card', 'file-card-workouts', (v) => expect(v.getByText('workouts-body')).toBeTruthy()],
  ['Food card', 'file-card-food', (v) => expect(v.getByText('logs-body')).toBeTruthy()],
  ['Check-ins card', 'file-card-checkins', (v) => expect(v.getByText('timeline-body')).toBeTruthy()],
  ['Weigh-ins card', 'file-card-weighins', (v) => expect(v.getByText('progress-body')).toBeTruthy()],
  ['Summary tab', 'file-tab-summary', (v) => expect(v.getByText('summary-body')).toBeTruthy()],
  ['Message Test', 'file-message', () => expect(navigate).toHaveBeenCalledWith('ClientMessages', { clientId: 'client-test', clientName: 'Test client' })],
  ['Back', 'file-back', () => expect(goBack).toHaveBeenCalledTimes(1)],
  ['More', 'file-more', () => expect(jest.mocked(Alert.alert).mock.calls[0][2]?.map((b) => b.text)).toEqual(['Archive client', 'Cancel'])],
])('%s lands on its destination', async (_name, id, landed) => {
  const view = await render(<ClientDetailScreen {...props} />);
  await view.findByText('1 this week · 1 to review');
  await fireEvent.press(await view.findByTestId(id));
  landed(view);
});

it('a switch that is off reads Not shared by {first} with a lock, and is not a button', async () => {
  timeline.consent = { workouts: true, food_macros: false, body_metrics: false, habits_progress: true };
  const view = await render(<ClientDetailScreen {...props} />);
  expect(await view.findByText('Clients choose what they share with you. Anything not shared stays private.')).toBeTruthy();
  expect(view.getAllByText('Not shared by Test')).toHaveLength(2);
  for (const id of ['file-card-food', 'file-card-weighins']) expect(view.getByTestId(id).props.accessibilityRole).toBeUndefined();
  expect(view.getByTestId('file-card-checkins').props.accessibilityRole).toBe('button');
});

it('the file error names the client, keeps the masthead and Message, buzzes once, and Try again reloads', async () => {
  read.mockRejectedValueOnce(new Error('offline'));
  const view = await render(<ClientDetailScreen {...props} />);
  expect(await view.findByText("Test's file did not load. Check the connection and try again.")).toBeTruthy();
  expect(view.getByTestId('file-masthead')).toBeTruthy();
  expect(view.getByText('Message Test')).toBeTruthy();
  expect(HapticService.error).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('1 this week · 1 to review')).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(2);
});

it('This week loads with static placeholders, and a failed read offers Try again in place', async () => {
  read.mockImplementationOnce(() => new Promise(() => undefined));
  const loading = await render(<ClientDetailScreen {...props} />);
  expect(loading.getByLabelText("Loading Test's file")).toBeTruthy();
  expect(loading.getByText('Test client')).toBeTruthy();
  loading.unmount();
  week.mockClear();
  week.mockRejectedValueOnce(new Error('offline'));
  const view = await render(<ClientDetailScreen {...props} />);
  expect(await view.findByText("Test's file did not load. Check the connection and try again.")).toBeTruthy();
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('1 this week · 1 to review')).toBeTruthy();
  expect(week).toHaveBeenCalledTimes(2);
});
