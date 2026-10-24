/**
 * FR-880R2 (Sol B1 on m#880, LO-872R4 C2): the community DM read waits for /community/me (the real query is off until
 * the space is known). A slow, failed or offline me read must not leave a header-only page: the thread shows
 * "Loading messages…" while it waits and "Messages did not load. Check your connection, then try again." with Try again
 * when it fails, and Try again reads it again. Real react-query hooks and the app's query client (its retry policy).
 */
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
    getAllKeys: async () => [],
  },
}));
jest.mock('../../../components/community/SafetyMenu', () => () => null);
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { recipientId: 'member-2', participantLabel: 'Jordan' } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', coach_id: 'coach-7' }) }));
jest.mock('../../../api/communityRealtime', () => ({ subscribeToCommunityUser: () => () => undefined }));
const mockGetMe = jest.fn();
const mockList = jest.fn();
jest.mock('../../../api/communityApi', () => ({
  ...jest.requireActual('../../../api/communityApi'),
  communityApi: {
    getMe: () => mockGetMe(),
    listDmMessages: (ws: string, to: string) => mockList(ws, to),
    sendDm: jest.fn(),
  },
}));

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const { queryClient } = require('../../../services/queryClient');

const ME = { feature_flag_state: 'enabled', workspace_id: 'ws-1', membership: null };
const OFFLINE = Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const LOADING = 'Loading messages…';
const FAILED = 'Messages did not load. Check your connection, then try again.';
const show = () => render(
  <QueryClientProvider client={queryClient}>
    <CommunityDmThreadScreen />
  </QueryClientProvider>,
);

beforeEach(() => {
  queryClient.clear();
  mockGetMe.mockReset();
  mockList.mockReset().mockResolvedValue([]);
});
afterEach(() => queryClient.clear());

describe('community DM while the community read is out', () => {
  it('a slow community read shows "Loading messages…", never a page with only the header', async () => {
    mockGetMe.mockReturnValue(new Promise(() => undefined));
    const u = await show();
    expect(u.getByTestId('community-dmthread-header')).toBeTruthy();
    expect(u.getByText(LOADING)).toBeTruthy();
    expect(u.getByTestId('community-dmthread-state').props.accessibilityState).toEqual({ busy: true });
    expect(u.queryByLabelText('Try again')).toBeNull();
    expect(u.queryByTestId('community-dmthread-composer')).toBeNull();
    expect(u.queryByTestId('community-dmthread-empty')).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('opened cold while offline: "Loading messages…" through the retries, then the failure line and Try again', async () => {
    mockGetMe.mockRejectedValue(OFFLINE);
    const u = await show();
    expect(u.getByText(LOADING)).toBeTruthy(); // the app retries twice (1 s, then 2 s) before it says it failed
    expect(await u.findByText(FAILED, {}, { timeout: 8000 })).toBeTruthy();
    expect(mockGetMe).toHaveBeenCalledTimes(3);
    expect(u.getByTestId('community-dmthread-state').props.accessibilityState).toEqual({ busy: false });
    expect(u.getByLabelText('Try again')).toBeTruthy();
    expect(u.queryByTestId('community-dmthread-composer')).toBeNull();
    expect(u.queryByTestId('community-dmthread-closed')).toBeNull();
  }, 15000);

  it('Try again reads the community again; once it answers, the thread reads and opens', async () => {
    mockGetMe.mockRejectedValue(OFFLINE);
    const u = await show();
    expect(await u.findByText(FAILED, {}, { timeout: 8000 })).toBeTruthy();
    mockGetMe.mockResolvedValue(ME);
    await act(async () => { await fireEvent.press(u.getByLabelText('Try again')); });
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('ws-1', 'member-2'));
    expect(await u.findByTestId('community-dmthread-empty')).toBeTruthy();
    expect(u.getByTestId('community-dmthread-composer')).toBeTruthy();
    expect(u.queryByText(FAILED)).toBeNull();
  }, 15000);

  it('a community answer with no space is still closed (no box), never the failure line', async () => {
    mockGetMe.mockResolvedValue({ ...ME, workspace_id: null });
    const u = await show();
    expect(await u.findByTestId('community-dmthread-closed')).toBeTruthy();
    expect(u.queryByText(FAILED)).toBeNull();
    expect(u.queryByText(LOADING)).toBeNull();
    expect(u.queryByTestId('community-dmthread-composer')).toBeNull();
  });
});
