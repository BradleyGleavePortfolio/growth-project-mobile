/**
 * SEND-ONCE-PHONE (182-S10, the phone half of b#1228), write 3 of 5: a post comment. Send again after no answer, a
 * timeout, offline or a 5xx sends the same Idempotency-Key, so the server answers with the first comment; new words,
 * a success, or a 400 / 409 answer make a new key. The reply box keeps its draft (and key) only while the post is
 * open. Real React Query and the real useAddComment; only the wire (communityApi) is stubbed.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  useRoute: () => ({ params: { postId: '33333333-3333-3333-3333-333333333333' } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: '22222222-2222-2222-2222-222222222222', coach_id: '99999999-9999-9999-9999-999999999999' }),
}));
const mockApi = {
  getMe: jest.fn(),
  getPost: jest.fn(),
  listComments: jest.fn(),
  addComment: jest.fn(),
};
jest.mock('../../../api/communityApi', () => ({
  ...jest.requireActual('../../../api/communityApi'),
  communityApi: {
    getMe: (...a: unknown[]) => mockApi.getMe(...a),
    getPost: (...a: unknown[]) => mockApi.getPost(...a),
    listComments: (...a: unknown[]) => mockApi.listComments(...a),
    addComment: (...a: unknown[]) => mockApi.addComment(...a),
  },
}));
jest.mock('../../../api/communityRemovedRows', () => ({
  ...jest.requireActual('../../../api/communityRemovedRows'),
  removedRowsApi: {
    getPost: (...a: unknown[]) => mockApi.getPost(...a),
    listComments: (...a: unknown[]) => mockApi.listComments(...a),
  },
}));

import CommunityThreadScreen from '../CommunityThreadScreen';

const WS = '11111111-1111-1111-1111-111111111111';
const POST = '33333333-3333-3333-3333-333333333333';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const axiosErr = (status: number, data: Record<string, unknown> = {}) => ({ isAxiosError: true, response: { status, data } });
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' };
const TIMEOUT = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };
const SERVER_DOWN = axiosErr(500, { error: 'internal' });
const REFUSED_400 = axiosErr(400, { error: 'bad_request', code: 'IDEMPOTENCY_KEY_INVALID' });
const REUSED_409 = axiosErr(409, { error: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED' });
const comment = (body: string) => ({ id: 'c-new', post_id: POST, author_user_id: 'me', body, created_at: new Date().toISOString() });

/** Comment `n`: its post, words and key (a key must be a v4 uuid, never missing). */
const sent = (n: number): { body: string; key: string } => {
  const [postId, body, key] = mockApi.addComment.mock.calls[n] as [string, string, string | undefined];
  expect(postId).toBe(POST);
  expect(key).toEqual(expect.stringMatching(UUID));
  return { body, key: key as string };
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getMe.mockResolvedValue({ workspace_id: WS, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } });
  mockApi.getPost.mockResolvedValue({
    id: POST, workspace_id: WS, cohort_id: null, author_user_id: '44444444-4444-4444-4444-444444444444', title: 'Hello',
    body: 'World', scope: 'hall', type: 'text', pinned: false, created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), deleted: false,
  });
  mockApi.listComments.mockResolvedValue([]);
  mockApi.addComment.mockImplementation(async (_p: string, body: string) => comment(body));
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

async function openPost() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  const view = await render(<QueryClientProvider client={qc}><CommunityThreadScreen /></QueryClientProvider>);
  await waitFor(() => expect(view.getByText('World')).toBeTruthy());
  return view;
}
const FIELD = 'community-thread-composer-field';
const boxOf = (v: Awaited<ReturnType<typeof openPost>>): string => v.getByTestId(FIELD).props.value;
const reply = async (v: Awaited<ReturnType<typeof openPost>>) => {
  await act(async () => { fireEvent.press(v.getByTestId('community-thread-composer-send')); });
};

it.each([
  ['no answer', NO_ANSWER],
  ['a timeout', TIMEOUT],
  ['a 5xx', SERVER_DOWN],
])('Send again after %s sends the same reply with the same key', async (_label, err) => {
  mockApi.addComment.mockRejectedValueOnce(err);
  const v = await openPost();
  await fireEvent.changeText(v.getByTestId(FIELD), 'Proud of you');
  await reply(v);
  await waitFor(() => expect(boxOf(v)).toBe('Proud of you'));
  await reply(v);
  await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(sent(0));
  expect(sent(0).body).toBe('Proud of you');
});

it('new words after a failed reply are a new key', async () => {
  mockApi.addComment.mockRejectedValueOnce(NO_ANSWER);
  const v = await openPost();
  await fireEvent.changeText(v.getByTestId(FIELD), 'Proud of you');
  await reply(v);
  await waitFor(() => expect(boxOf(v)).toBe('Proud of you'));
  await fireEvent.changeText(v.getByTestId(FIELD), 'So proud of you');
  await reply(v);
  await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it.each([
  ['a 400', REFUSED_400],
  ['a 409', REUSED_409],
])('after %s answer the same reply sent again is a new key', async (_label, err) => {
  mockApi.addComment.mockRejectedValueOnce(err);
  const v = await openPost();
  await fireEvent.changeText(v.getByTestId(FIELD), 'Proud of you');
  await reply(v);
  await waitFor(() => expect(boxOf(v)).toBe('Proud of you'));
  await reply(v);
  await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('two separate replies of the same words ("+1" twice) get two keys', async () => {
  const v = await openPost();
  await fireEvent.changeText(v.getByTestId(FIELD), '+1');
  await reply(v);
  await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledTimes(1));
  await fireEvent.changeText(v.getByTestId(FIELD), '+1');
  await reply(v);
  await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('leaving the post after a failed reply ends the draft and its key', async () => {
  mockApi.addComment.mockRejectedValueOnce(NO_ANSWER);
  const a = await openPost();
  await fireEvent.changeText(a.getByTestId(FIELD), 'Proud of you');
  await reply(a);
  await waitFor(() => expect(boxOf(a)).toBe('Proud of you'));
  await a.unmount();
  const b = await openPost();
  expect(boxOf(b)).toBe('');
  await fireEvent.changeText(b.getByTestId(FIELD), 'Proud of you');
  await reply(b);
  await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});
