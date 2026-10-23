/**
 * CHAT-DISCARD (owner 10-21, op 1) on the community DM, at screen level (Opus C3, m#841): the real
 * CommunityDmThreadScreen and ComposerInput keep half-typed text with that DM on the device. It is back after leaving
 * and opening the DM again and after the app closed (device copy, memory empty); another DM stays empty; a failed send
 * puts the text back; a sent message and a sign-out leave the box empty.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined, // the AsyncStorage fallback in release builds: no synchronous read
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
const mockSend = jest.fn();
let mockWorkspace: string | null = 'ws-1';
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: mockWorkspace ? { workspace_id: mockWorkspace } : undefined, isLoading: false, isError: false, isSuccess: true }),
  useDmMessages: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, isFetchedAfterMount: true, isStale: false }),
  usePosts: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, isFetchedAfterMount: true, isStale: false }),
  useSendDm: () => ({ mutateAsync: mockSend, isPending: false }),
}));

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const { authEvents } = require('../../../utils/authEvents');
const { CHAT_DRAFT_KEY_PREFIX } = require('../../../lib/chatDrafts');

const FIELD = 'community-dmthread-composer-field';
const open = async (recipientId: string) => {
  mockParams.current = { recipientId, participantLabel: 'Jordan Lee' };
  return render(<CommunityDmThreadScreen />);
};
const boxOf = (r: Awaited<ReturnType<typeof render>>): string => r.getByTestId(FIELD).props.value;

beforeEach(async () => {
  mockWorkspace = 'ws-1';
  mockSend.mockReset().mockResolvedValue({ id: 'dm-1' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => jest.restoreAllMocks());

it('keeps half-typed text with that DM: back after leaving, never in another DM', async () => {
  const a = await open('coach-1');
  await fireEvent.changeText(a.getByTestId(FIELD), 'Hey, loved th');
  await a.unmount();
  const other = await open('member-2');
  expect(boxOf(other)).toBe('');
  await other.unmount();
  const back = await open('coach-1');
  expect(boxOf(back)).toBe('Hey, loved th');
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}me-1:dm:ws-1:coach-1`)).toContain('Hey, loved th'));
});

it('after the app closed (memory empty), the device copy fills the box', async () => {
  mockDisk.set(`${CHAT_DRAFT_KEY_PREFIX}me-1:dm:ws-1:coach-7`, JSON.stringify({ text: 'See you at the 6am cl' }));
  const r = await open('coach-7');
  await waitFor(() => expect(boxOf(r)).toBe('See you at the 6am cl'));
});

it('text typed before the community workspace loads stays with the DM (Opus C4)', async () => {
  mockWorkspace = null;
  const r = await open('coach-1');
  await fireEvent.changeText(r.getByTestId(FIELD), 'Quick q');
  mockWorkspace = 'ws-1';
  await r.rerender(<CommunityDmThreadScreen />);
  expect(boxOf(r)).toBe('Quick q');
  await r.unmount();
  expect(boxOf(await open('coach-1'))).toBe('Quick q');
});

it('a failed send puts the text back and it is still there after leaving; a sent message leaves the box empty', async () => {
  mockSend.mockRejectedValueOnce(new Error('Network Error'));
  const a = await open('coach-1');
  await fireEvent.changeText(a.getByTestId(FIELD), 'Hey, loved the new plan');
  await act(async () => { fireEvent.press(a.getByTestId('community-dmthread-composer-send')); });
  await waitFor(() => expect(boxOf(a)).toBe('Hey, loved the new plan'));
  await a.unmount();
  const b = await open('coach-1');
  expect(boxOf(b)).toBe('Hey, loved the new plan');
  await act(async () => { fireEvent.press(b.getByTestId('community-dmthread-composer-send')); });
  expect(mockSend).toHaveBeenLastCalledWith('Hey, loved the new plan');
  expect(boxOf(b)).toBe('');
  await b.unmount();
  expect(boxOf(await open('coach-1'))).toBe('');
});

it('a sign-out removes the kept DM text from memory and the device', async () => {
  const a = await open('coach-1');
  await fireEvent.changeText(a.getByTestId(FIELD), 'Hey, loved th');
  await a.unmount();
  await waitFor(() => expect([...mockDisk.keys()]).toHaveLength(1));
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
  expect(boxOf(await open('coach-1'))).toBe('');
});
