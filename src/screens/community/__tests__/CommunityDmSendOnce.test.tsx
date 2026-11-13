/**
 * SEND-ONCE-PHONE (182-S10, the phone half of b#1228), write 1 of 5: the one-to-one message. One Idempotency-Key per
 * draft: Send again after no answer, a timeout, offline or a 5xx sends the same key (the server answers the first
 * row); new words, a success, or a 400 / 409 answer make a new key. In the DM thread the draft is kept on the device,
 * so the key comes back with it after leaving; in the New message composer both live in the screen.
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
  useFocusEffect: () => undefined,
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', coach_id: 'coach-7' }) }));
const mockSendAsync = jest.fn();
const mockSendMutate = jest.fn();
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1' }, isLoading: false, isError: false, isSuccess: true }),
  useDmMessages: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, isFetchedAfterMount: true, isStale: false, error: null }),
  usePosts: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, isFetchedAfterMount: true, isStale: false, error: null }),
  useSendDm: () => ({ mutateAsync: mockSendAsync, mutate: mockSendMutate, isPending: false, error: null }),
  useCreatePost: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  isOptimisticId: () => false,
  useMyCoachName: () => ({ name: null, settled: true }),
}));

const CommunityDmThreadScreen = require('../CommunityDmThreadScreen').default;
const CommunityComposerScreen = require('../CommunityComposerScreen').default;
const { authEvents } = require('../../../utils/authEvents');
const { CHAT_DRAFT_KEY_PREFIX } = require('../../../lib/chatDrafts');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const axiosErr = (status: number, data: Record<string, unknown> = {}) => ({ isAxiosError: true, response: { status, data } });
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' }; // no response: offline or the answer was lost
const TIMEOUT = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };
const SERVER_DOWN = axiosErr(503, { error: 'service_unavailable' });
const REFUSED_400 = axiosErr(400, { error: 'bad_request', code: 'IDEMPOTENCY_KEY_INVALID' });
const REUSED_409 = axiosErr(409, { error: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED' });

/** The send of call `n`: its words and its key (a key must be a v4 uuid, never missing). */
const sent = (mock: jest.Mock, n: number): { body: string; key: string } => {
  const vars = mock.mock.calls[n][0] as { body: string; idempotencyKey: string };
  expect(vars).toEqual({ body: expect.any(String), idempotencyKey: expect.stringMatching(UUID) });
  return { body: vars.body, key: vars.idempotencyKey };
};

const FIELD = 'community-dmthread-composer-field';
const SEND = 'community-dmthread-composer-send';
const openThread = async () => {
  mockParams.current = { recipientId: 'coach-7', participantLabel: 'Sam Rivera' };
  return render(<CommunityDmThreadScreen />);
};
const boxOf = (r: Awaited<ReturnType<typeof render>>): string => r.getByTestId(FIELD).props.value;
const sendFrom = async (r: Awaited<ReturnType<typeof render>>) => {
  await act(async () => { fireEvent.press(r.getByTestId(SEND)); });
};

beforeEach(async () => {
  mockSendAsync.mockReset().mockResolvedValue({ id: 'dm-1' });
  mockSendMutate.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  authEvents.emit('logout');
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
});
afterEach(() => jest.restoreAllMocks());

describe('DM thread: the key lives with the draft on the device', () => {
  it.each([
    ['no answer', NO_ANSWER],
    ['a timeout', TIMEOUT],
    ['a 5xx', SERVER_DOWN],
  ])('Send again after %s sends the same words with the same key', async (_label, err) => {
    mockSendAsync.mockRejectedValueOnce(err);
    const r = await openThread();
    await fireEvent.changeText(r.getByTestId(FIELD), 'See you at the 6am class');
    await sendFrom(r);
    await waitFor(() => expect(boxOf(r)).toBe('See you at the 6am class'));
    await sendFrom(r);
    expect(mockSendAsync).toHaveBeenCalledTimes(2);
    const first = sent(mockSendAsync, 0);
    expect(sent(mockSendAsync, 1)).toEqual(first);
    expect(first.body).toBe('See you at the 6am class');
  });

  it('new words after a failed send are a new key', async () => {
    mockSendAsync.mockRejectedValueOnce(NO_ANSWER);
    const r = await openThread();
    await fireEvent.changeText(r.getByTestId(FIELD), 'See you at 6');
    await sendFrom(r);
    await waitFor(() => expect(boxOf(r)).toBe('See you at 6'));
    await fireEvent.changeText(r.getByTestId(FIELD), 'See you at 7');
    await sendFrom(r);
    expect(sent(mockSendAsync, 1).key).not.toBe(sent(mockSendAsync, 0).key);
  });

  it('two separate sends of the same words ("ok" twice) get two keys', async () => {
    const r = await openThread();
    await fireEvent.changeText(r.getByTestId(FIELD), 'ok');
    await sendFrom(r);
    await waitFor(() => expect(boxOf(r)).toBe(''));
    await fireEvent.changeText(r.getByTestId(FIELD), 'ok');
    await sendFrom(r);
    expect(sent(mockSendAsync, 1).key).not.toBe(sent(mockSendAsync, 0).key);
  });

  it.each([
    ['a 400', REFUSED_400],
    ['a 409', REUSED_409],
  ])('after %s answer the next send of the same words is a new key', async (_label, err) => {
    mockSendAsync.mockRejectedValueOnce(err);
    const r = await openThread();
    await fireEvent.changeText(r.getByTestId(FIELD), 'See you at the 6am class');
    await sendFrom(r);
    await waitFor(() => expect(boxOf(r)).toBe('See you at the 6am class'));
    await sendFrom(r);
    expect(sent(mockSendAsync, 1).key).not.toBe(sent(mockSendAsync, 0).key);
  });

  it('leaving after a failed send and coming back keeps the words and the key', async () => {
    mockSendAsync.mockRejectedValueOnce(NO_ANSWER);
    const a = await openThread();
    await fireEvent.changeText(a.getByTestId(FIELD), 'Hey, loved the new plan');
    await sendFrom(a);
    await waitFor(() => expect(boxOf(a)).toBe('Hey, loved the new plan'));
    const { key } = sent(mockSendAsync, 0);
    await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}me-1:dm:ws-1:coach-7`)).toContain(key));
    await a.unmount();
    const b = await openThread();
    expect(boxOf(b)).toBe('Hey, loved the new plan');
    await sendFrom(b);
    expect(sent(mockSendAsync, 1)).toEqual({ body: 'Hey, loved the new plan', key });
    // Sent: the box is empty and the key went with it.
    expect(boxOf(b)).toBe('');
    await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}me-1:dm:ws-1:coach-7`)).toBeUndefined());
  });
});

describe('New message composer: the key lives with the draft in the screen', () => {
  const openComposer = async () => {
    mockParams.current = { mode: 'dm', recipientId: 'coach-7' };
    return render(<CommunityComposerScreen />);
  };
  const failWith = (err: unknown) => (_vars: unknown, opts: { onError?: (e: unknown) => void }) => opts.onError?.(err);

  it.each([
    ['no answer', NO_ANSWER],
    ['a 5xx', SERVER_DOWN],
  ])('Send again after %s sends the same key; new words a new key', async (_label, err) => {
    mockSendMutate.mockImplementation(failWith(err));
    const r = await openComposer();
    await fireEvent.changeText(r.getByTestId('community-composer-body'), 'Can we move Friday?');
    await act(async () => { fireEvent.press(r.getByTestId('community-composer-submit')); });
    await act(async () => { fireEvent.press(r.getByTestId('community-composer-submit')); });
    expect(sent(mockSendMutate, 1)).toEqual(sent(mockSendMutate, 0));
    await fireEvent.changeText(r.getByTestId('community-composer-body'), 'Can we move Saturday?');
    await act(async () => { fireEvent.press(r.getByTestId('community-composer-submit')); });
    expect(sent(mockSendMutate, 2).key).not.toBe(sent(mockSendMutate, 0).key);
  });

  it('a 409 answer ends the key; leaving ends the draft and its key', async () => {
    mockSendMutate.mockImplementation(failWith(REUSED_409));
    const a = await openComposer();
    await fireEvent.changeText(a.getByTestId('community-composer-body'), 'Can we move Friday?');
    await act(async () => { fireEvent.press(a.getByTestId('community-composer-submit')); });
    await act(async () => { fireEvent.press(a.getByTestId('community-composer-submit')); });
    expect(sent(mockSendMutate, 1).key).not.toBe(sent(mockSendMutate, 0).key);
    mockSendMutate.mockImplementation(failWith(NO_ANSWER));
    await act(async () => { fireEvent.press(a.getByTestId('community-composer-submit')); });
    const kept = sent(mockSendMutate, 2).key;
    await a.unmount();
    const b = await openComposer();
    await fireEvent.changeText(b.getByTestId('community-composer-body'), 'Can we move Friday?');
    await act(async () => { fireEvent.press(b.getByTestId('community-composer-submit')); });
    expect(sent(mockSendMutate, 3).key).not.toBe(kept);
  });

  it('after a success the same words again are a new key', async () => {
    mockSendMutate.mockImplementation((_vars: unknown, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    const r = await openComposer();
    await fireEvent.changeText(r.getByTestId('community-composer-body'), 'ok');
    await act(async () => { fireEvent.press(r.getByTestId('community-composer-submit')); });
    await act(async () => { fireEvent.press(r.getByTestId('community-composer-submit')); });
    expect(sent(mockSendMutate, 1).key).not.toBe(sent(mockSendMutate, 0).key);
  });
});
