/**
 * LS-946 review probe, outside the registry-only diff.
 * Keep the real gate and modal. Observe the normal closed UI separately
 * from callbacks already obtained while the modal was open.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ClientDetailScreen from '../ClientDetailScreen';
import { closedRefusals } from '../../../components/messaging/closedRefusal';
import { useCoachStore } from '../../../store/coachStore';

const ID = 'ls946-client';
const mockSendNudge = jest.fn();
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../services/api', () => ({ coachApi: {
  getClientSummary: jest.fn(async () => ({ data: { client_name: 'Test client', profile: {}, today: {}, consent: {} } })),
  getClientTimeline: jest.fn(async () => ({ data: { items: [] } })),
  getClientWeek: jest.fn(async () => ({ data: { week_start: '2026-11-02', today: '2026-11-05', assignments: [] } })),
  getClients: jest.fn(async () => ({ data: [{ id: 'ls946-client', name: 'Test client', role: 'student', archived_at: null }] })),
  archiveClient: jest.fn(),
  unarchiveClient: jest.fn(),
  getUnreadCounts: jest.fn(async () => ({ data: { total: 0, by_client: {}, closed_client_ids: [] } })),
  sendNudge: (...args: unknown[]) => mockSendNudge(...args),
} }));
jest.mock('../home-v11/blockList', () => ({
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: {
  selection: jest.fn(), mediumImpact: jest.fn(), error: jest.fn(), warning: jest.fn(),
} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../../client/wearables/recoveryTestColors').testColors,
  tokens: jest.requireActual('../../../theme/tokens').default,
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
}) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'ls946-coach' }) }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isLoading: false, flags: {} }) }));
jest.mock('../client-detail/ConsultationSummaryCard', () => ({ ConsultationSummaryCard: () => null }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForClient: () => ({ data: null }) }));
jest.mock('../../../hooks/useCoachRoleType', () => ({ useCoachTeamStatus: () => ({}) }));
jest.mock('../../../lib/money/headCoachRole', () => ({ useHeadCoachHandlesMoney: () => false }));
jest.mock('../../../components/coach/CoachAiSection', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/coach/ai-entry/AdjustForClient', () => ({ AdjustForClientEntry: () => null }));
jest.mock('../client-detail/FoodLogReviewSection', () => ({ FoodLogReviewSection: () => null }));
jest.mock('../client-detail/ProgressTab', () => ({ ProgressTab: () => null }));
jest.mock('../client-detail/HealthFitnessTab', () => ({ HealthFitnessTab: () => null }));
jest.mock('../client-detail/SleepRecoveryTab', () => ({ SleepRecoveryTab: () => null }));
jest.mock('../../../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));
jest.mock('../../../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: () => null }));

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ClientsStackParamList } from '../../../navigation/CoachNavigator';
const Stack = createNativeStackNavigator<ClientsStackParamList>();
const params = { clientId: ID, clientName: 'Test client', initialTab: 'summary' as const };
const file = () => (
  <NavigationContainer initialState={{ index: 1, routes: [{ name: 'ClientsList' }, { name: 'ClientDetail', params }] }}>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ClientsList">{() => null}</Stack.Screen>
      <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
    </Stack.Navigator>
  </NavigationContainer>
);

beforeEach(() => {
  useCoachStore.getState().reset();
  closedRefusals.clearAll();
  mockSendNudge.mockReset();
  // A generic failed request leaves no success-banner timer behind.
  mockSendNudge.mockRejectedValue(new Error('probe send failed'));
});
afterEach(cleanup);

async function openFilledModal() {
  const view = await render(file());
  await screen.findByLabelText('Send nudge notification');
  await fireEvent.press(screen.getByLabelText('Send nudge notification'));
  await fireEvent.changeText(screen.getByLabelText('Nudge title'), 'Training reminder');
  await fireEvent.changeText(screen.getByLabelText('Nudge message'), 'How was training?');
  const pressability = screen.getByLabelText('Send nudge').props
    .onStartShouldSetResponder.testOnly_pressabilityConfig();
  return { view, submit: pressability.onPress };
}

describe.each([['legacy', false], ['Style C', true]] as const)('%s', (_name, styleC) => {
beforeEach(() => { mockFlags.coachTabsV2 = styleC; });

it('normal UI removes the real open modal when the conversation closes', async () => {
  await openFilledModal();
  await act(async () => { closedRefusals.add(ID); });
  expect(screen.queryByLabelText('Nudge title')).toBeNull();
  expect(screen.queryByLabelText('Nudge message')).toBeNull();
  expect(screen.queryByLabelText('Send nudge notification')).toBeNull();
  expect(screen.getByTestId('client-file-nudge-closed')).toBeTruthy();
  expect(mockSendNudge).not.toHaveBeenCalled();
});

it('Cancel removes the form without sending and reopening retains this client draft', async () => {
  await openFilledModal();
  await fireEvent.press(screen.getByLabelText('Cancel'));
  expect(screen.queryByLabelText('Nudge title')).toBeNull();
  expect(mockSendNudge).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Send nudge notification'));
  expect(screen.getByLabelText('Nudge title').props.value).toBe('Training reminder');
  expect(screen.getByLabelText('Nudge message').props.value).toBe('How was training?');
});

it('a generic send failure keeps the actual editor and draft reachable', async () => {
  await openFilledModal();
  await fireEvent.press(screen.getByLabelText('Send nudge'));
  expect(mockSendNudge).toHaveBeenCalledTimes(1);
  expect(screen.getByText('probe send failed')).toBeTruthy();
  expect(screen.getByLabelText('Nudge title').props.value).toBe('Training reminder');
  expect(screen.getByLabelText('Nudge message').props.value).toBe('How was training?');
  expect(screen.getByLabelText('Send nudge')).not.toBeDisabled();
});

it('a blocked-send refusal removes the real editor and remembers closure', async () => {
  mockSendNudge.mockRejectedValue({
    response: { status: 403, data: { code: 'messaging.blocked' } },
  });
  await openFilledModal();
  await fireEvent.press(screen.getByLabelText('Send nudge'));
  expect(mockSendNudge).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Nudge title')).toBeNull();
  expect(screen.queryByLabelText('Send nudge notification')).toBeNull();
  expect(screen.getByTestId('client-file-nudge-closed')).toBeTruthy();
  expect(closedRefusals.has(ID)).toBe(true);
});

it('documents the inherited stale-callback edge without treating it as a live button', async () => {
  const { submit } = await openFilledModal();
  await act(async () => { closedRefusals.add(ID); });
  expect(screen.queryByLabelText('Nudge title')).toBeNull();
  await act(async () => { await submit(); });
  expect(mockSendNudge).toHaveBeenCalledTimes(1);
  expect(mockSendNudge).toHaveBeenCalledWith(ID, {
    title: 'Training reminder',
    body: 'How was training?',
  });
});

it('documents two already-queued callbacks before React commits sending state', async () => {
  const { submit } = await openFilledModal();
  await act(async () => { await Promise.all([submit(), submit()]); });
  expect(mockSendNudge).toHaveBeenCalledTimes(2);
});

it('normal rendered send button disables while the request is pending', async () => {
  let rejectSend!: (reason: Error) => void;
  mockSendNudge.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
  const { submit } = await openFilledModal();
  await act(async () => { void submit(); });
  await waitFor(() => expect(screen.getByLabelText('Send nudge')).toBeDisabled());
  await fireEvent.press(screen.getByLabelText('Send nudge'));
  expect(mockSendNudge).toHaveBeenCalledTimes(1);
  await act(async () => rejectSend(new Error('probe send failed')));
});
});
