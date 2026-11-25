/**
 * SEND-ONCE-PHONE (182-S10, the phone half of b#1228), write 2 of 5: a post. Publish again (Post again with the same
 * title and body) after no answer, a timeout, offline or a 5xx sends the same Idempotency-Key, so the server answers
 * with the first post; a changed title or body, a success, or a 400 / 409 answer make a new key. The draft and its key
 * live in the composer screen, so leaving ends both.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
    getAllKeys: async () => [],
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { mode: 'post' } }),
  useFocusEffect: () => undefined,
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', coach_id: 'coach-7' }) }));
const mockPostMutate = jest.fn();
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1' }, isLoading: false, isError: false, isSuccess: true }),
  useDmMessages: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, isFetchedAfterMount: true, isStale: false, error: null }),
  usePosts: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, isFetchedAfterMount: true, isStale: false, error: null }),
  useSendDm: () => ({ mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false, error: null }),
  useCreatePost: () => ({ mutate: mockPostMutate, isPending: false, error: null }),
  isOptimisticId: () => false,
  useMyCoachName: () => ({ name: null, settled: true }),
}));

const CommunityComposerScreen = require('../CommunityComposerScreen').default;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const axiosErr = (status: number, data: Record<string, unknown> = {}) => ({ isAxiosError: true, response: { status, data } });
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' };
const TIMEOUT = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };
const SERVER_DOWN = axiosErr(502, { error: 'bad_gateway' });
const REFUSED_400 = axiosErr(400, { error: 'bad_request', code: 'IDEMPOTENCY_KEY_INVALID' });
const REUSED_409 = axiosErr(409, { error: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED' });

/** Post `n`: its title, body and key (a key must be a v4 uuid, never missing). */
const posted = (n: number): { title: string; body: string; key: string } => {
  const vars = mockPostMutate.mock.calls[n][0] as { title: string; body: string; idempotencyKey: string };
  expect(vars).toEqual({ title: expect.any(String), body: expect.any(String), idempotencyKey: expect.stringMatching(UUID) });
  return { title: vars.title, body: vars.body, key: vars.idempotencyKey };
};
const answer = (outcome: { err?: unknown }) => (_vars: unknown, opts: { onSuccess?: () => void; onError?: (e: unknown) => void }) =>
  ('err' in outcome ? opts.onError?.(outcome.err) : opts.onSuccess?.());

const open = async () => render(<CommunityComposerScreen />);
const write = async (r: Awaited<ReturnType<typeof open>>, title: string, body: string) => {
  await fireEvent.changeText(r.getByTestId('community-composer-title'), title);
  await fireEvent.changeText(r.getByTestId('community-composer-body'), body);
};
const post = async (r: Awaited<ReturnType<typeof open>>) => {
  await act(async () => { fireEvent.press(r.getByTestId('community-composer-submit')); });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockPostMutate.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each([
  ['no answer', NO_ANSWER],
  ['a timeout', TIMEOUT],
  ['a 5xx', SERVER_DOWN],
])('Publish again after %s sends the same title, body and key', async (_label, err) => {
  mockPostMutate.mockImplementation(answer({ err }));
  const r = await open();
  await write(r, 'Week 3 done', 'Felt strong on the long run.');
  await post(r);
  await post(r);
  expect(mockPostMutate).toHaveBeenCalledTimes(2);
  expect(posted(1)).toEqual(posted(0));
  expect(posted(0)).toMatchObject({ title: 'Week 3 done', body: 'Felt strong on the long run.' });
});

it('a changed title or a changed body after a failed post is a new key', async () => {
  mockPostMutate.mockImplementation(answer({ err: NO_ANSWER }));
  const r = await open();
  await write(r, 'Week 3 done', 'Felt strong.');
  await post(r);
  await write(r, 'Week 3 done!', 'Felt strong.');
  await post(r);
  await write(r, 'Week 3 done!', 'Felt strong today.');
  await post(r);
  const keys = [0, 1, 2].map((n) => posted(n).key);
  expect(new Set(keys).size).toBe(3);
});

it.each([
  ['a 400', REFUSED_400],
  ['a 409', REUSED_409],
])('after %s answer the next post of the same words is a new key', async (_label, err) => {
  mockPostMutate.mockImplementationOnce(answer({ err }));
  const r = await open();
  await write(r, 'Week 3 done', 'Felt strong.');
  await post(r);
  await post(r);
  expect(posted(1).key).not.toBe(posted(0).key);
});

it('after a success the same words posted again are a new key', async () => {
  mockPostMutate.mockImplementation(answer({}));
  const r = await open();
  await write(r, 'ok', 'ok');
  await post(r);
  await post(r);
  expect(posted(1).key).not.toBe(posted(0).key);
});

it('leaving after a failed post ends the draft and its key', async () => {
  mockPostMutate.mockImplementation(answer({ err: NO_ANSWER }));
  const a = await open();
  await write(a, 'Week 3 done', 'Felt strong.');
  await post(a);
  await a.unmount();
  const b = await open();
  await write(b, 'Week 3 done', 'Felt strong.');
  await post(b);
  expect(posted(1).key).not.toBe(posted(0).key);
});
