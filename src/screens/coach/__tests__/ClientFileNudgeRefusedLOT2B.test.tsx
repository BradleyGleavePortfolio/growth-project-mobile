/**
 * NUDGE-GATE-M (FIX-933R2 "Found, not fixed", comment 6665087764): the client file's Summary Send Nudge takes m#933's
 * peek gate. Table-driven over the pair states the peek's ClientPeekPairGateFIX933R2 covers: Send Nudge only for an
 * open pair; a block either way draws the chat's closed line (BAM-2a / BAM-2b) in its place; unknown or a failed read
 * draws neither. Run on both files (flag off: the legacy file; coachTabsV2 on: Style C) with the real SummaryTab.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockUnread = jest.fn();
const mockSendNudge = jest.fn();
let mockBlockedIds: string[] = [];
let mockBlockKnown = true;
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../services/api', () => ({ coachApi: {
  getClientSummary: jest.fn(async () => ({ data: { client_name: 'Jordan Reyes', profile: {}, today: {}, consent: {} } })),
  getClientTimeline: jest.fn(async () => ({ data: { items: [] } })),
  getClientWeek: jest.fn(async () => ({ data: { week_start: '2026-11-02', today: '2026-11-05', assignments: [] } })),
  getClients: jest.fn(async () => ({ data: [{ id: 'client-ngm', name: 'Jordan Reyes', role: 'student', archived_at: null }] })),
  archiveClient: jest.fn(), unarchiveClient: jest.fn(),
  getUnreadCounts: () => mockUnread(),
  sendNudge: (...args: unknown[]) => mockSendNudge(...args),
} }));
jest.mock('../home-v11/blockList', () => ({
  useCoachBlockList: () => ({ known: mockBlockKnown, blockedIds: mockBlockedIds }),
}));
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), mediumImpact: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(actual),
    RefreshControl: { enumerable: true, value: ({ onRefresh }: { onRefresh: () => void }) =>
      jest.requireActual('react').createElement(actual.View, { testID: 'refresh-ngm', onRefresh }) },
  });
});
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../../client/wearables/recoveryTestColors').testColors,
  tokens: jest.requireActual('../../../theme/tokens').default,
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
}) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-ngm' }) }));
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
jest.mock('../client-detail/NudgeModal', () => ({ NudgeModal: ({ visible, onSend, nudgeError, setNudgeTitle, setNudgeBody }: {
  visible: boolean; onSend: () => void; nudgeError: string; setNudgeTitle: (s: string) => void; setNudgeBody: (s: string) => void;
}) => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  R.useEffect(() => { if (visible) { setNudgeTitle('Checking in'); setNudgeBody('How was the week?'); } }, [visible]);
  return visible ? R.createElement(RN.View, null,
    R.createElement(RN.Text, null, 'nudge-modal-open'),
    R.createElement(RN.Pressable, { testID: 'nudge-send-ngm', onPress: onSend }),
    nudgeError ? R.createElement(RN.Text, null, nudgeError) : null) : null;
} }));
jest.mock('../../../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));
jest.mock('../../../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: () => null }));

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ClientDetailScreen from '../ClientDetailScreen';
import type { ClientsStackParamList } from '../../../navigation/CoachNavigator';
import { useCoachStore } from '../../../store/coachStore';
import { closedRefusals } from '../../../components/messaging/closedRefusal';
import { BLOCKED_BY_ME_LINE, blockedYouLine } from '../../../components/messaging/ConversationClosed';

const ID = 'client-ngm';
const Stack = createNativeStackNavigator<ClientsStackParamList>();
const params = { clientId: ID, clientName: 'Jordan Reyes', initialTab: 'summary' as const };
const file = () => (
  <NavigationContainer initialState={{ index: 1, routes: [{ name: 'ClientsList' }, { name: 'ClientDetail', params }] }}>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ClientsList">{() => null}</Stack.Screen>
      <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
    </Stack.Navigator>
  </NavigationContainer>
);
// The backend's own answer to a nudge across a block either way (nudges.service createForClient -> assertPairOpen ->
// messagingError(403, MESSAGING_ERRORS.BLOCKED)), as axios hands it to the phone.
const blockedRefusal = () => Object.assign(new Error('Request failed with status code 403'), {
  response: { status: 403, data: { statusCode: 403, error: 'messaging.blocked', code: 'messaging.blocked',
    message: 'This conversation is blocked, so messages cannot be sent, edited or pinned. Unblock in Settings to continue.' } },
});

beforeEach(() => {
  useCoachStore.getState().reset();
  closedRefusals.clearAll();
  mockUnread.mockReset();
  mockSendNudge.mockReset();
  mockBlockedIds = [];
  mockBlockKnown = true;
});

describe.each([['the legacy file', false], ['the Style C file', true]] as const)('LO-T2B B1, %s', (_file, styleC) => {
  beforeEach(() => { mockFlags.coachTabsV2 = styleC; });

  it('a nudge refused because the client blocked the coach after the file opened closes the editor and the pair', async () => {
    // The file opened while the pair was open; the client blocks the coach while the coach writes the nudge.
    mockUnread.mockImplementation(() => Promise.resolve({ data: { total: 0, by_client: {}, closed_client_ids: [] } }));
    mockSendNudge.mockImplementation(() => Promise.reject(blockedRefusal()));
    await render(file());
    await screen.findByLabelText('Send nudge notification');
    await fireEvent.press(screen.getByLabelText('Send nudge notification'));
    expect(screen.getByText('nudge-modal-open')).toBeTruthy();
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
    await act(async () => { await fireEvent.press(screen.getByTestId('nudge-send-ngm')); });
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
    expect(mockSendNudge).toHaveBeenCalledTimes(1);
    // The server said closed: the session remembers it, the editor goes, Send Nudge goes, the chat's line takes its place.
    expect(screen.queryByText('nudge-modal-open')).toBeNull();
    expect(screen.queryByLabelText('Send nudge notification')).toBeNull();
    expect(screen.getByTestId('client-file-nudge-closed')).toBeTruthy();
    expect(closedRefusals.has(ID)).toBe(true);
  });
});
