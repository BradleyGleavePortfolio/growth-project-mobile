/**
 * NUDGE-GATE-M (FIX-933R2 "Found, not fixed", comment 6665087764): the risk screen's "Send check-in nudge" takes m#933's
 * peek gate. The same pair states as ClientPeekPairGateFIX933R2: the nudge only for an open pair; a block either way
 * draws the chat's closed line (BAM-2a / BAM-2b) in its place; unknown or a failed read draws neither.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockUnread = jest.fn();
const mockSendNudge = jest.fn();
let mockBlockedIds: string[] = [];
let mockBlockKnown = true;
jest.mock('../../../services/api', () => ({ coachApi: {
  getUnreadCounts: () => mockUnread(),
  sendNudge: (...args: unknown[]) => mockSendNudge(...args),
} }));
jest.mock('../../../services/ptmApi', () => ({ ptmApi: { getClientPtm: jest.fn(async () => ({ data: {
  user: { id: 'client-ngm', name: 'Jordan Reyes', email: 'client@example.test' },
  current: { id: 'ptm-ngm', computed_at: '2026-11-05T10:00:00Z', risk_score: 0.7, success_score: 0.3, factors: [] },
  history: [],
} })) } }));
jest.mock('../home-v11/blockList', () => ({
  useCoachBlockList: () => ({ known: mockBlockKnown, blockedIds: mockBlockedIds }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ params: { userId: 'client-ngm', clientName: 'Jordan Reyes' } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-ngm', role: 'coach' }) }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isLoading: false, flags: {} }) }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../../client/wearables/recoveryTestColors').testColors,
  tokens: jest.requireActual('../../../theme/tokens').default,
  semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
}) }));
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../components/RiskDot', () => () => null);
jest.mock('../../../components/FactorRow', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), mediumImpact: jest.fn(), error: jest.fn() } }));

import ClientRiskDetailScreen from '../ClientRiskDetailScreen';
import { closedRefusals } from '../../../components/messaging/closedRefusal';
import { BLOCKED_BY_ME_LINE, blockedYouLine } from '../../../components/messaging/ConversationClosed';

const ID = 'client-ngm';
type Unread = 'open' | 'older' | 'closed' | 'failed' | 'pending';
const answer = (unread: Unread) => {
  if (unread === 'failed') return Promise.reject(new Error('offline'));
  if (unread === 'pending') return new Promise(() => undefined);
  return Promise.resolve({ data: { total: 0, by_client: {}, ...(unread === 'older' ? {} : { closed_client_ids: unread === 'closed' ? [ID] : [] }) } });
};

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
  closedRefusals.clear();
  mockUnread.mockReset();
  mockSendNudge.mockReset().mockResolvedValue({ data: { ok: true } });
});

it.each(CASES)('$name: nudge $nudge, closed line $line', async ({ blocked, known, unread, refused, nudge, line }) => {
  mockBlockedIds = blocked;
  mockBlockKnown = known ?? true;
  if (refused) closedRefusals.add(ID);
  mockUnread.mockImplementation(() => answer(unread));
  await render(<ClientRiskDetailScreen />);
  await screen.findByText('Risk detail');
  // Let every read answer (or not) before asserting what the screen draws.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  if (nudge) {
    await screen.findByLabelText('Send check-in nudge');
    await fireEvent.press(screen.getByLabelText('Send check-in nudge'));
    expect(mockSendNudge).toHaveBeenCalledWith(ID, expect.anything());
  } else {
    expect(screen.queryByLabelText('Send check-in nudge')).toBeNull();
    expect(screen.queryByText('Send check-in nudge')).toBeNull();
  }
  if (line) {
    const bar = await screen.findByTestId('risk-nudge-closed');
    expect(bar.props.accessibilityLabel).toBe(line);
  } else {
    expect(screen.queryByTestId('risk-nudge-closed')).toBeNull();
  }
});
