/**
 * BLOCK-ALL-M (owner 10-22 "hide ALL messaging entirely, dont even let the banned person type!"; #168-4 op 1) on the
 * community DM and the New message / New post composer: a block either way or a ban takes the box away and shows
 * "This conversation is closed"; a refused send keeps the typed text on the device; an unblock opens it again.
 */
import React from 'react';
import { Alert } from 'react-native';
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
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana' }) }));
const mockSendAsync = jest.fn();
const mockSendMutate = jest.fn();
const mockPostMutate = jest.fn();
let mockReadError: unknown = null;
let mockMessages: unknown[] = [];
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1' }, isLoading: false, isError: false }),
  useDmMessages: () => ({ data: mockMessages, isLoading: false, isError: !!mockReadError, error: mockReadError }),
  useSendDm: () => ({ mutateAsync: mockSendAsync, mutate: mockSendMutate, isPending: false, error: null }),
  useCreatePost: () => ({ mutate: mockPostMutate, isPending: false, error: null }),
  isOptimisticId: () => false,
}));

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const CommunityComposerScreen = require('../CommunityComposerScreen').default;
const { useBlockedUsersStore } = require('../../../store/blockedUsersStore');
const { authEvents } = require('../../../utils/authEvents');

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
