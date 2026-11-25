/**
 * FIX-933R2 (LS-933R2 B1, class-first): the real lookup -> peek -> nudge path for every pair state. The peek offers
 * Send nudge only once the server has answered that the pair is open; a block either way draws the chat's own closed
 * line (BAM-2a / BAM-2b, ConversationClosed.tsx) in its place, as plain text; Message stays (owner O03).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGetClients = jest.fn();
const mockSendNudge = jest.fn();
const mockCache = new Map<string, string>();
const mockUnread = jest.fn();
let mockBlockedIds = ['blocked-c1'];
jest.mock('../../../services/api', () => ({
  coachApi: {
    getClients: (...args: unknown[]) => mockGetClients(...args),
    getUnreadCounts: () => mockUnread(),
    getClientSummary: async () => ({ data: {} }),
    getClientCheckIns: async () => ({ data: [] }),
    getClientWeek: async () => ({ data: { days: [] } }),
    sendNudge: (...args: unknown[]) => mockSendNudge(...args),
  },
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getStringAsync: async (key: string) => mockCache.get(key),
    set: async (key: string, value: string) => void mockCache.set(key, value),
  },
  prefsStorage: { getString: () => undefined },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-r2', role: 'coach' }),
}));
jest.mock('../../../hooks/useMacros', () => ({
  useMacros: () => ({ formatWeight: (value: number) => `${value} lb` }),
  useCurrentMacrosForClient: () => ({ isSuccess: true, data: null }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: mockBlockedIds }),
}));
jest.mock('../home-v11/DraftSheets', () => ({ HomeSheet: () => null }));
jest.mock('../../../theme/ThemeProvider', () => {
  const flat = new Proxy({}, { get: () => '#000000' });
  const anyColor = new Proxy({}, { get: (_t, key) => key === 'surface' || key === 'data' ? flat : '#000000' });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));
jest.mock('../../../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../ui/states/QuietStates', () => ({
  QuietLoading: () => null, QuietError: () => null,
}));
jest.mock('../../../ui/empty-states', () => ({ EmptyStateNoResults: () => null }));
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../navigation/coachLanding', () => ({ coachLandingTab: () => 'ClientsStack' }));

import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';
import { closedRefusals } from '../../../components/messaging/closedRefusal';
import { BLOCKED_BY_ME_LINE, blockedYouLine } from '../../../components/messaging/ConversationClosed';

const ID = 'pair-c1';
const navigate = jest.fn();
const nav = {
  navigate, setParams: jest.fn(), isFocused: () => true,
  addListener: () => () => undefined,
  getParent: () => ({ navigate, addListener: () => () => undefined }),
} as never;

type Case = {
  name: string;
  blocked: string[];
  unread: 'none' | 'closed' | 'older' | 'failed';
  refused?: boolean;
  nudge: boolean;
  line: string | null;
};
const CASES: Case[] = [
  { name: 'open pair', blocked: [], unread: 'none', nudge: true, line: null },
  { name: 'older server (no closed_client_ids)', blocked: [], unread: 'older', nudge: true, line: null },
  { name: 'the coach blocked them', blocked: [ID], unread: 'none', nudge: false, line: BLOCKED_BY_ME_LINE },
  { name: 'they blocked the coach (closed_client_ids)', blocked: [], unread: 'closed', nudge: false, line: blockedYouLine('Jordan Reyes') },
  { name: 'both, the coach first', blocked: [ID], unread: 'closed', nudge: false, line: BLOCKED_BY_ME_LINE },
  // As in the chat (ConversationClosed.tsx:116-118): the server's newer answer that the pair is open clears a remembered refusal.
  { name: 'a refusal remembered, then the server answers open', blocked: [], unread: 'none', refused: true, nudge: true, line: null },
  { name: 'a refusal remembered, and the server answers closed', blocked: [], unread: 'closed', refused: true, nudge: false, line: blockedYouLine('Jordan Reyes') },
  { name: 'the server has not answered (unread read failed)', blocked: [], unread: 'failed', nudge: false, line: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  closedRefusals.clear(ID);
  useCoachStore.getState().reset();
  mockGetClients.mockResolvedValue({
    data: [{
      id: ID, name: 'Jordan Reyes', role: 'student', created_at: '2025-01-01T12:00:00Z',
      activity: { shared: true, last_active_on: null, check_ins_to_review: 0, last_workout_on: null },
    }],
  });
});

it.each(CASES)('$name: Send nudge offered $nudge, closed line $line', async ({ blocked, unread, refused, nudge, line }) => {
  mockBlockedIds = blocked;
  if (refused) closedRefusals.add(ID);
  if (unread === 'failed') mockUnread.mockRejectedValue(new Error('offline'));
  else mockUnread.mockResolvedValue({ data: { total: 0, by_client: {}, ...(unread === 'older' ? {} : { closed_client_ids: unread === 'closed' ? [ID] : [] }) } });
  await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(screen.getByTestId(`lookup-row-${ID}`)).toBeTruthy());
  await fireEvent.press(screen.getByTestId(`lookup-row-${ID}`));
  await waitFor(() => expect(screen.getByTestId('peek-sheet')).toBeTruthy());
  await act(async () => {});
  // Message stays in every state: the chat it opens draws the same closed line.
  expect(screen.getByTestId('peek-message')).toBeTruthy();
  if (nudge) {
    expect(screen.queryByTestId('peek-closed')).toBeNull();
    await fireEvent.press(screen.getByTestId('peek-nudge'));
    expect(screen.getByLabelText('Nudge message')).toBeTruthy();
    expect(closedRefusals.has(ID)).toBe(false);
    return;
  }
  expect(screen.queryByTestId('peek-nudge')).toBeNull();
  expect(screen.queryByLabelText('Nudge message')).toBeNull();
  if (line == null) {
    expect(screen.queryByTestId('peek-closed')).toBeNull();
    return;
  }
  const bar = screen.getByTestId('peek-closed');
  expect(bar.props.accessibilityLabel).toBe(line);
  // Plain text, never the Settings link: the sheet stays up over any screen the link would open.
  expect(bar.props.accessibilityRole).toBe('text');
  expect(screen.getByText(line)).toBeTruthy();
});
