/**
 * BLOCK-ALL-M (owner 10-22 "hide ALL messaging entirely, dont even let the banned person type!"; #168-4 op 1) on the
 * community DM and the New message / New post composer: a block either way or a ban takes the box away and shows
 * "This conversation is closed"; a refused send keeps the typed text on the device; an unblock opens it again.
 */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
jest.mock('../../../components/community/SafetyMenu', () => () => null);
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams.current }),
  useFocusEffect: (cb: () => void | (() => void)) => require('react').useEffect(() => cb(), [cb]), // focused while mounted
}));
jest.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) =>
  require('react').createElement(require('react-native').Text, null, `icons-${style}`) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', coach_id: 'coach-7' }) }));
const mockSendAsync = jest.fn();
const mockSendMutate = jest.fn();
const mockPostMutate = jest.fn();
let mockReadError: unknown = null;
let mockMessages: unknown[] = [];
let mockReadPending = false;
let mockMe: { workspace_id: string | null } = { workspace_id: 'ws-1' };
const mockDmTo = jest.fn();
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: mockMe, isLoading: false, isError: false, isSuccess: true }),
  useDmMessages: (ws: string, to: string) => {
    mockDmTo(to);
    return mockReadPending || !ws // no space: the real query is disabled, so it is pending
      ? { data: undefined, isLoading: true, isPending: true, isError: false, isSuccess: false, isFetchedAfterMount: false, isStale: true, error: null }
      : { data: mockMessages, isLoading: false, isError: !!mockReadError, error: mockReadError, isSuccess: !mockReadError, isFetchedAfterMount: true, isStale: false };
  },
  usePosts: (ws: string | null) => (ws
    ? { data: [], isLoading: false, isError: !!mockReadError, error: mockReadError, isSuccess: !mockReadError, isFetchedAfterMount: true, isStale: false }
    : { data: undefined, isLoading: false, isPending: true, isError: false, isSuccess: false, isFetchedAfterMount: false, isStale: true, error: null }),
  useSendDm: () => ({ mutateAsync: mockSendAsync, mutate: mockSendMutate, isPending: false, error: null }),
  useCreatePost: () => ({ mutate: mockPostMutate, isPending: false, error: null }),
  isOptimisticId: () => false,
}));

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const CommunityComposerScreen = require('../CommunityComposerScreen').default;
const { useBlockedUsersStore } = require('../../../store/blockedUsersStore');
const { authEvents } = require('../../../utils/authEvents');
const { StatusBarBand, STATUS_BAR_BONE } = require('../../../components/StatusBarBand');
const { forestPop } = require('../../../theme/tokens');

const axiosErr = (status: number, data: Record<string, unknown>) => ({ isAxiosError: true, response: { status, data } });
const BLOCKED_BY_YOU = axiosErr(403, { error: 'forbidden', code: 'community.dm.blocked_by_you', message: 'You blocked this member.' });
const NOT_FOUND = axiosErr(404, { error: 'not_found', code: 'community.dm.not_found', message: 'This conversation is not available.' });
const BLOCKED_BY_THEM = axiosErr(403, { error: 'forbidden', code: 'community.dm.blocked_by_them' });
const FIELD = 'community-dmthread-composer-field';
const block = (id: string) => useBlockedUsersStore.setState({ blocked: [{ id, displayName: 'Jordan', blockedAt: '2026-10-22T00:00:00Z' }] });

let alertSpy: jest.SpyInstance;
beforeEach(async () => {
  mockReadError = null;
  mockMessages = [];
  mockReadPending = false;
  mockMe = { workspace_id: 'ws-1' };
  mockDmTo.mockReset();
  mockSendAsync.mockReset().mockResolvedValue({ id: 'dm-1' });
  mockSendMutate.mockReset();
  mockPostMutate.mockReset();
  useBlockedUsersStore.setState({ blocked: [] });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => jest.restoreAllMocks());

describe('community DM', () => {
  const open = () => {
    mockParams.current = { recipientId: 'member-2', participantLabel: 'Jordan Lee' };
    return render(<CommunityDmThreadScreen />);
  };

  it('FR-872 (Opus C2): a DM read that is out or failed says so, with Try again on a failure; no box either way', async () => {
    mockReadPending = true;
    expect((await open()).getByText('Loading messages…')).toBeTruthy();
    mockReadPending = false;
    mockReadError = new Error('Network Error');
    const view = await open();
    expect(view.getByTestId('community-dmthread-retry')).toBeTruthy();
    expect(view.queryByTestId(FIELD)).toBeNull();
  });

  // FR-880R4 (Opus B2, #172-10 frame 05b): the app's status band (App.tsx, drawn over every screen) takes the DM's deep
  // forest with light icons while the DM is in front, closed or open, and is bone again once it has gone.
  it.each([true, false])('the status band above the DM is deep forest with light icons, bone after (closed %s)', async (closed) => {
    if (closed) block('member-2');
    mockParams.current = { recipientId: 'member-2', participantLabel: 'Jordan Lee' };
    const phone = (dm: boolean) => (
      <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
        {dm ? <CommunityDmThreadScreen /> : null}
        <StatusBarBand />
      </SafeAreaInsetsContext.Provider>
    );
    const view = await render(phone(true));
    const band = () => StyleSheet.flatten(view.getByTestId('status-bar-band').props.style).backgroundColor;
    expect(!!view.queryByTestId('community-dmthread-closed')).toBe(closed);
    expect(band()).toBe(forestPop.deep);
    expect(view.getByText('icons-light')).toBeTruthy();
    await view.rerender(phone(false));
    expect(band()).toBe(STATUS_BAR_BONE);
    expect(view.queryByText('icons-light')).toBeNull();
  });

  it('open: the message box is there and the closed line is not', async () => {
    const view = await open();
    expect(view.getByTestId(FIELD)).toBeTruthy();
    expect(view.getByText('Start the conversation')).toBeTruthy();
    expect(view.queryByTestId('community-dmthread-closed')).toBeNull();
  });

  it('I blocked them: no message box, no "Start the conversation", only the closed line; an unblock opens it', async () => {
    block('member-2');
    const view = await open();
    expect(view.queryByTestId(FIELD)).toBeNull();
    expect(view.queryByText('Start the conversation')).toBeNull();
    expect(view.getByTestId('community-dmthread-closed')).toBeTruthy();
    // #169-5 BAM-2a: the blocker is told it is their block and where to undo it.
    expect(view.getByLabelText('You blocked them. Unblock in Settings')).toBeTruthy();
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(view.getByTestId(FIELD)).toBeTruthy();
  });

  it('they blocked me (#169-5, server 403 blocked_by_them): closed, and the line names them as the header does', async () => {
    mockReadError = BLOCKED_BY_THEM;
    const view = await open();
    expect(view.queryByTestId(FIELD)).toBeNull();
    expect(view.queryByText('Start the conversation')).toBeNull();
    expect(view.getByText('Jordan Lee has blocked you')).toBeTruthy();
    expect(view.queryByText(/Unblock/)).toBeNull();
  });

  it('a member who left or is banned (404): the plain closed line, naming nobody', async () => {
    mockReadError = NOT_FOUND;
    const view = await open();
    expect(view.queryByTestId(FIELD)).toBeNull();
    expect(view.getByText('This conversation is closed')).toBeTruthy();
    expect(view.queryByText(/blocked/i)).toBeNull();
  });

  it('a refused send closes at once with no error box, and the typed text is kept on the device', async () => {
    mockSendAsync.mockRejectedValueOnce(BLOCKED_BY_YOU);
    const view = await open();
    await fireEvent.changeText(view.getByTestId(FIELD), 'Hey, are you coming');
    await act(async () => { fireEvent.press(view.getByTestId('community-dmthread-composer-send')); });
    await waitFor(() => expect(view.getByTestId('community-dmthread-closed')).toBeTruthy());
    expect(view.queryByTestId(FIELD)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    await waitFor(() => expect([...mockDisk.values()].join()).toContain('Hey, are you coming'));
  });

  // FX-872: closed until the server says open.
  it('no message box and no "Start the conversation" while the DM read is out', async () => {
    mockReadPending = true;
    const view = await open();
    expect(view.queryByTestId(FIELD)).toBeNull();
    expect(view.queryByText('Start the conversation')).toBeNull();
  });

  it('signed in with no community membership (left or removed): closed, no box', async () => {
    mockMe = { workspace_id: null };
    const view = await open();
    expect(view.queryByTestId(FIELD)).toBeNull();
    expect(view.getByTestId('community-dmthread-closed')).toBeTruthy();
  });

  it('a send that fails for another reason keeps the box and says why', async () => {
    mockSendAsync.mockRejectedValueOnce(new Error('Network Error'));
    const view = await open();
    await fireEvent.changeText(view.getByTestId(FIELD), 'Hi');
    await act(async () => { fireEvent.press(view.getByTestId('community-dmthread-composer-send')); });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(view.getByTestId(FIELD)).toBeTruthy();
    expect(view.queryByTestId('community-dmthread-closed')).toBeNull();
  });
});

describe('New message / New post composer', () => {
  it('New message to someone I blocked: no fields and no Send, only the closed line', async () => {
    block('member-2');
    mockParams.current = { mode: 'dm', recipientId: 'member-2' };
    const view = await render(<CommunityComposerScreen />);
    expect(view.queryByTestId('community-composer-body')).toBeNull();
    expect(view.queryByTestId('community-composer-submit')).toBeNull();
    expect(view.getByTestId('community-composer-closed')).toBeTruthy();
    expect(view.getByLabelText('You blocked them. Unblock in Settings')).toBeTruthy();
  });

  it('New message to someone who blocked me (#169-5): the refused send closes it; no name shows here, so BAM-1', async () => {
    mockSendMutate.mockImplementation((_v: unknown, o: { onError: (e: unknown) => void }) => o.onError(BLOCKED_BY_THEM));
    mockParams.current = { mode: 'dm', recipientId: 'member-2' };
    const view = await render(<CommunityComposerScreen />);
    await fireEvent.changeText(view.getByTestId('community-composer-body'), 'hello');
    await act(async () => { fireEvent.press(view.getByTestId('community-composer-submit')); });
    expect(view.getByText('This conversation is closed')).toBeTruthy();
    expect(view.queryByTestId('community-composer-body')).toBeNull();
    expect(view.queryByText(/blocked/i)).toBeNull();
  });

  it('New post refused after a ban: the fields go, the closed line shows, no error box', async () => {
    mockParams.current = { mode: 'post' };
    mockPostMutate.mockImplementation((_v: unknown, o: { onError: (e: unknown) => void }) =>
      o.onError(axiosErr(404, { code: 'community.post.not_found' })));
    const view = await render(<CommunityComposerScreen />);
    expect(view.getByTestId('community-composer-body')).toBeTruthy();
    await fireEvent.changeText(view.getByTestId('community-composer-title'), 'Week 3');
    await fireEvent.changeText(view.getByTestId('community-composer-body'), 'Hit a PR');
    await act(async () => { fireEvent.press(view.getByTestId('community-composer-submit')); });
    expect(view.getByTestId('community-composer-closed')).toBeTruthy();
    expect(view.queryByTestId('community-composer-body')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('FX-872: no fields while the read for this place is out', async () => {
    mockReadPending = true;
    mockParams.current = { mode: 'dm', recipientId: 'member-2' };
    const view = await render(<CommunityComposerScreen />);
    expect(view.queryByTestId('community-composer-body')).toBeNull();
    expect(view.queryByTestId('community-composer-submit')).toBeNull();
  });

  it('FR-872 (Opus C2): New message with a failed read offers Try again, and no fields', async () => {
    mockParams.current = { mode: 'dm', recipientId: 'member-2' };
    mockReadError = new Error('Network Error');
    const view = await render(<CommunityComposerScreen />);
    expect(view.getByTestId('community-composer-retry')).toBeTruthy();
    expect(view.queryByTestId('community-composer-body')).toBeNull();
  });

  it.each(['post', 'dm'])('FR-872 (Sol B3): %s, the membership goes after the read answered: the fields go too', async (mode) => {
    mockParams.current = { mode, recipientId: 'member-2' };
    const view = await render(<CommunityComposerScreen />);
    expect(view.getByTestId('community-composer-body')).toBeTruthy();
    mockMe = { workspace_id: null };
    await view.rerender(<CommunityComposerScreen />);
    expect(view.queryByTestId('community-composer-body')).toBeNull();
    expect(view.queryByTestId('community-composer-submit')).toBeNull();
  });

  it('FX-872 (Sol B4): "Send your coach a message" opens with no recipient; the DM goes to my coach', async () => {
    mockParams.current = { mode: 'dm', recipientId: '' };
    const view = await render(<CommunityComposerScreen />);
    expect(mockDmTo).toHaveBeenCalledWith('coach-7');
    expect(mockDmTo).not.toHaveBeenCalledWith('');
    expect(view.getByTestId('community-composer-body')).toBeTruthy();
  });

  it('a content-filter refusal still keeps the fields and says why', async () => {
    mockParams.current = { mode: 'dm', recipientId: 'member-2' };
    mockSendMutate.mockImplementation((_v: unknown, o: { onError: (e: unknown) => void }) =>
      o.onError(axiosErr(422, { code: 'community.content.rejected' })));
    const view = await render(<CommunityComposerScreen />);
    await fireEvent.changeText(view.getByTestId('community-composer-body'), 'text');
    await act(async () => { fireEvent.press(view.getByTestId('community-composer-submit')); });
    expect(alertSpy).toHaveBeenCalled();
    expect(view.getByTestId('community-composer-body')).toBeTruthy();
  });
});
