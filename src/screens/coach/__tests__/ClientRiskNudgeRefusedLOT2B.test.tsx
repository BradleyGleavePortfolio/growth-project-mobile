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
  user: { id: 'client-ngm', name: 'Jordan Reyes', email: '' },
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
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), mediumImpact: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

import ClientRiskDetailScreen from '../ClientRiskDetailScreen';
import { closedRefusals } from '../../../components/messaging/closedRefusal';
import { BLOCKED_BY_ME_LINE, blockedYouLine } from '../../../components/messaging/ConversationClosed';

const ID = 'client-ngm';
const blockedRefusal = () => Object.assign(new Error('Request failed with status code 403'), {
  response: { status: 403, data: { statusCode: 403, error: 'messaging.blocked', code: 'messaging.blocked',
    message: 'This conversation is blocked, so messages cannot be sent, edited or pinned. Unblock in Settings to continue.' } },
});

beforeEach(() => {
  closedRefusals.clearAll();
  mockUnread.mockReset();
  mockSendNudge.mockReset();
  mockBlockedIds = [];
  mockBlockKnown = true;
});

it('LO-T2B B1: a check-in nudge refused because the client blocked the coach takes the nudge away and draws the closed line', async () => {
  mockUnread.mockImplementation(() => Promise.resolve({ data: { total: 0, by_client: {}, closed_client_ids: [] } }));
  mockSendNudge.mockImplementation(() => Promise.reject(blockedRefusal()));
  await render(<ClientRiskDetailScreen />);
  await screen.findByLabelText('Send check-in nudge');
  await act(async () => { await fireEvent.press(screen.getByLabelText('Send check-in nudge')); });
  await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  expect(mockSendNudge).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Send check-in nudge')).toBeNull();
  expect(screen.getByTestId('risk-nudge-closed')).toBeTruthy();
  expect(closedRefusals.has(ID)).toBe(true);
});
