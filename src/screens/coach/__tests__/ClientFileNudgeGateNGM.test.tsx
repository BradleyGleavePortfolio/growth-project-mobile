/**
 * NUDGE-GATE-M (FIX-933R2 "Found, not fixed", comment 6665087764): the client file's Summary Send Nudge takes m#933's
 * peek gate. Table-driven over the pair states the peek's ClientPeekPairGateFIX933R2 covers: Send Nudge only for an
 * open pair; a block either way draws the chat's closed line (BAM-2a / BAM-2b) in its place; unknown or a failed read
 * draws neither. Run on both files (flag off: the legacy file; coachTabsV2 on: Style C) with the real SummaryTab.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockUnread = jest.fn();
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
} }));
jest.mock('../home-v11/blockList', () => ({
  useCoachBlockList: () => ({ known: mockBlockKnown, blockedIds: mockBlockedIds }),
}));
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), mediumImpact: jest.fn(), error: jest.fn() } }));
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
jest.mock('../client-detail/NudgeModal', () => ({ NudgeModal: ({ visible }: { visible: boolean }) => visible
  ? jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, 'nudge-modal-open') : null }));
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
type Unread = 'open' | 'older' | 'closed' | 'failed' | 'pending';
// The app's real stack, so the Style C file's focus hooks run as on the phone.
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
const answer = (unread: Unread) => {
  if (unread === 'failed') return Promise.reject(new Error('offline'));
  if (unread === 'pending') return new Promise(() => undefined);
  return Promise.resolve({ data: { total: 0, by_client: {}, ...(unread === 'older' ? {} : { closed_client_ids: unread === 'closed' ? [ID] : [] }) } });
};

// The same pair states as the peek's gate (ClientPeekPairGateFIX933R2), on the client file.
const CASES: { name: string; blocked: string[]; known?: boolean; unread: Unread; refused?: boolean; nudge: boolean; line: string | null }[] = [
  { name: 'an open pair', blocked: [], unread: 'open', nudge: true, line: null },
  { name: 'an older server (no closed_client_ids)', blocked: [], unread: 'older', nudge: true, line: null },
  { name: 'the coach blocked the client', blocked: [ID], unread: 'open', nudge: false, line: BLOCKED_BY_ME_LINE },
  { name: 'the client blocked the coach (closed_client_ids)', blocked: [], unread: 'closed', nudge: false, line: blockedYouLine('Jordan Reyes') },
  { name: 'both blocked', blocked: [ID], unread: 'closed', nudge: false, line: BLOCKED_BY_ME_LINE },
  { name: 'a refusal remembered, then the server answers open', blocked: [], unread: 'open', refused: true, nudge: true, line: null },
  { name: 'a refusal remembered, and the server answers closed', blocked: [], unread: 'closed', refused: true, nudge: false, line: blockedYouLine('Jordan Reyes') },
  { name: 'the unread read failed', blocked: [], unread: 'failed', nudge: false, line: null },
  { name: 'the server has not answered', blocked: [], unread: 'pending', nudge: false, line: null },
  { name: 'the block list is not known yet', blocked: [], known: false, unread: 'open', nudge: false, line: null },
];

beforeEach(() => {
  useCoachStore.getState().reset();
  closedRefusals.clear();
  mockUnread.mockReset();
  mockBlockKnown = true;
});

describe.each([['the legacy file', false], ['the Style C file', true]] as const)('%s', (_file, styleC) => {
  beforeEach(() => { mockFlags.coachTabsV2 = styleC; });

  it.each(CASES)('$name: Send Nudge $nudge, closed line $line', async ({ blocked, known, unread, refused, nudge, line }) => {
    mockBlockedIds = blocked;
    mockBlockKnown = known ?? true;
    if (refused) closedRefusals.add(ID);
    mockUnread.mockImplementation(() => answer(unread));
    await render(file());
    await screen.findAllByLabelText('Open messages');
    if (unread !== 'pending') await waitFor(() => expect(mockUnread).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    if (nudge) {
      await screen.findByLabelText('Send nudge notification');
      await fireEvent.press(screen.getByLabelText('Send nudge notification'));
      expect(screen.getByText('nudge-modal-open')).toBeTruthy();
    } else {
      expect(screen.queryByLabelText('Send nudge notification')).toBeNull();
      expect(screen.queryByText('Send Nudge')).toBeNull();
    }
    if (line) {
      const bar = await screen.findByTestId('client-file-nudge-closed');
      expect(bar.props.accessibilityLabel).toBe(line);
    } else {
      expect(screen.queryByTestId('client-file-nudge-closed')).toBeNull();
    }
    // The Message pill stays: the chat says its own line (O03).
    expect(screen.getAllByLabelText('Open messages').length).toBeGreaterThan(0);
  });

  it('a pull to refresh reads the pair again: an unblock on the server brings Send Nudge back', async () => {
    mockBlockedIds = [];
    mockUnread.mockImplementation(() => answer('closed'));
    await render(file());
    await screen.findByTestId('client-file-nudge-closed');
    expect(screen.queryByLabelText('Send nudge notification')).toBeNull();
    mockUnread.mockImplementation(() => answer('open'));
    await act(async () => { await screen.getByTestId('refresh-ngm').props.onRefresh(); });
    await screen.findByLabelText('Send nudge notification');
    expect(screen.queryByTestId('client-file-nudge-closed')).toBeNull();
  });
});
