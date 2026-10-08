import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import ClientDetailScreen from '../screens/coach/ClientDetailScreen';
import { useClientDetailData } from '../screens/coach/client-detail/useClientDetailData';
import { useCoachStore } from '../store/coachStore';
import { coachApi } from '../services/api';
import type { Props } from '../screens/coach/client-detail/types';
import { testColors } from '../screens/client/wearables/recoveryTestColors';

jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, name) }));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(actual),
    RefreshControl: { enumerable: true, value: ({ onRefresh }: { onRefresh: () => void }) =>
      jest.requireActual('react').createElement(actual.View, { accessible: true, accessibilityLabel: 'Refresh client', onRefresh }) },
  });
});
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
  tokens: jest.requireActual('../theme/tokens').default,
  semanticColors: jest.requireActual('../theme/tokens').lightTokens,
}) }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-test' }) }));
let mockPaymentsOn = false;
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({
  isLoading: false, flags: { coach_payment_actions: mockPaymentsOn },
}) }));
jest.mock('../config/featureFlags', () => ({ featureFlags: {} }));
jest.mock('../services/api', () => ({ coachApi: {
  getClientSummary: jest.fn(), getClients: jest.fn(), archiveClient: jest.fn(), unarchiveClient: jest.fn(),
} }));
jest.mock('../screens/coach/client-detail/SummaryTab', () => ({ SummaryTab: () => null }));
jest.mock('../screens/coach/client-detail/FoodLogReviewSection', () => ({ FoodLogReviewSection: () => null }));
jest.mock('../screens/coach/client-detail/WorkoutsTab', () => ({ WorkoutsTab: () => null }));
jest.mock('../screens/coach/client-detail/MealPlanTab', () => ({ MealPlanTab: () => null }));
jest.mock('../screens/coach/client-detail/ProgressTab', () => ({ ProgressTab: () => null }));
jest.mock('../screens/coach/client-detail/HealthFitnessTab', () => ({ HealthFitnessTab: () => null }));
jest.mock('../screens/coach/client-detail/SleepRecoveryTab', () => ({ SleepRecoveryTab: () => null }));
jest.mock('../screens/coach/client-detail/PlanFormModal', () => ({ PlanFormModal: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));
jest.mock('../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: () => null }));

const summary = { client_name: 'Test client', profile: { primaryGoal: 'Build strength' }, today: {}, consent: {} };
let archived = false;
const row = () => ({
  id: 'client-test', name: 'Test client', role: 'student',
  archived_at: archived ? '2026-10-08T09:00:00Z' : null,
});
const navigate: Props['navigation']['navigate'] = jest.fn();
const goBack: Props['navigation']['goBack'] = jest.fn();
const props: Props = {
  navigation: { navigate, goBack } as Props['navigation'],
  route: { key: 'detail-test', name: 'ClientDetail', params: { clientId: 'client-test', clientName: 'Test client' } },
};
const archive = coachApi.archiveClient as jest.Mock;
const unarchive = coachApi.unarchiveClient as jest.Mock;
const clients = coachApi.getClients as jest.Mock;
const confirm = () => {
  const call = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Archive this client?');
  expect(call).toBeDefined();
  return call!;
};

beforeEach(() => {
  jest.clearAllMocks();
  archived = false;
  mockPaymentsOn = false;
  useCoachStore.getState().reset();
  (coachApi.getClientSummary as jest.Mock).mockReset().mockResolvedValue({ data: summary });
  clients.mockReset().mockImplementation(async () => ({ data: [row()] }));
  archive.mockReset().mockImplementation(async () => { archived = true; return { data: row() }; });
  unarchive.mockReset().mockImplementation(async () => { archived = false; return { data: row() }; });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('uses the roster archive status when the current summary has no client object', async () => {
  archived = true;
  await useCoachStore.getState().loadClients('coach-test', 'archived');
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors, 'coach-test'));
  await act(async () => { await result.current.loadData(); });
  expect(summary).not.toHaveProperty('client');
  expect(result.current.isArchived).toBe(true);
  expect(clients).toHaveBeenCalledTimes(1);
});

it('reads the existing authorized roster when a client opens without a cached row', async () => {
  archived = true;
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors, 'coach-test'));
  await waitFor(() => expect(result.current.isArchived).toBe(true));
  expect(clients).toHaveBeenCalledWith('all', undefined, 50);
});

it('an archived client shows the real state and Unarchive, retaining the goal and message route', async () => {
  archived = true;
  const view = await render(<ClientDetailScreen {...props} />);
  await view.findByLabelText('Unarchive client');
  expect(view.getByText('Archived client · Build strength')).toBeTruthy();
  expect(view.queryByLabelText('Archive client')).toBeNull();
  await fireEvent.press(view.getByText('chatbubble-outline'));
  expect(props.navigation.navigate).toHaveBeenCalledWith('ClientMessages', props.route.params);
  await fireEvent.press(view.getByLabelText('Unarchive client'));
  expect(unarchive).toHaveBeenCalledWith('client-test');
  expect(archive).not.toHaveBeenCalled();
  expect(view.getByLabelText('Archive client')).toBeTruthy();
});

it('warns before archiving with payments off, keeps Cancel safe, and refreshes the verified archive state', async () => {
  const view = await render(<ClientDetailScreen {...props} />);
  await view.findByLabelText('Archive client');
  await fireEvent.press(view.getByLabelText('Archive client'));
  expect(archive).not.toHaveBeenCalled();
  const [, body, buttons] = confirm();
  expect(body).toContain('It does not stop recurring payments.');
  expect(body).toContain('payments continue');
  expect(body).toContain('End my plan in Your plans');
  expect(body).not.toContain('Manage billing in Payments');
  await act(async () => { buttons?.find((button) => button.style === 'cancel')?.onPress?.(); });
  expect(archive).not.toHaveBeenCalled();
  await act(async () => { await buttons?.find((button) => button.text === 'Archive client')?.onPress?.(); });
  expect(archive).toHaveBeenCalledWith('client-test');
  expect(view.getByLabelText('Unarchive client')).toBeTruthy();
  await fireEvent(view.getByLabelText('Refresh client'), 'refresh');
  expect(view.getByLabelText('Unarchive client')).toBeTruthy();
  expect(view.getByText('Archived client · Build strength')).toBeTruthy();
});

it('mentions the separate coach Payments controls only when their server flag is on', async () => {
  mockPaymentsOn = true;
  const view = await render(<ClientDetailScreen {...props} />);
  await view.findByLabelText('Archive client');
  await fireEvent.press(view.getByLabelText('Archive client'));
  expect(confirm()[1]).toContain('Manage billing in Payments');
  expect(archive).not.toHaveBeenCalled();
});

it('does not label an unknown archive status active and recovers through the existing refresh action', async () => {
  clients.mockRejectedValueOnce(new Error('Network Error'));
  const view = await render(<ClientDetailScreen {...props} />);
  await view.findByText('Client archive status could not load. Pull down to try again.');
  expect(view.queryByLabelText('Archive client')).toBeNull();
  expect(view.queryByText(/Active client/)).toBeNull();
  expect(view.getByText('Build strength')).toBeTruthy();
  await fireEvent(view.getByLabelText('Refresh client'), 'refresh');
  await view.findByLabelText('Archive client');
});

it('a failed confirmed archive retains the active state and never reports success', async () => {
  archive.mockRejectedValueOnce(new Error('Network Error'));
  const view = await render(<ClientDetailScreen {...props} />);
  await view.findByLabelText('Archive client');
  await fireEvent.press(view.getByLabelText('Archive client'));
  await act(async () => { await confirm()[2]?.find((button) => button.text === 'Archive client')?.onPress?.(); });
  expect(view.getByLabelText('Archive client')).toBeTruthy();
  expect(view.queryByLabelText('Unarchive client')).toBeNull();
  expect(Alert.alert).not.toHaveBeenCalledWith('Archived', expect.any(String));
});
