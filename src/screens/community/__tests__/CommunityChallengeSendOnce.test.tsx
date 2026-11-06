/**
 * SEND-ONCE-PHONE (182-S10, the phone half of b#1228), write 4 of 5: a challenge comment. Send again after no answer,
 * a timeout, offline or a 5xx sends the same Idempotency-Key, so the server answers with the first comment; new
 * words, a success, or a 400 / 409 answer make a new key. The box keeps its draft (and key) only while the challenge
 * is open. Real React Query and the screen's own mutation; only the wire (communityChallengesApi) is stubbed.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { challengeId: 'ch-1' } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', name: 'Dana' }) }));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communityChallenges: true } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../api/communityChallengesApi', () => ({
  communityChallengesApi: {
    getChallenge: jest.fn(),
    listComments: jest.fn(),
    join: jest.fn(),
    updateProgress: jest.fn(),
    addComment: jest.fn(),
    reportComment: jest.fn(),
  },
  CHALLENGE_COMMENTS_PAGE_LIMIT: 20,
  CHALLENGE_LEADERBOARD_PAGE_LIMIT: 20,
}));

import { communityChallengesApi } from '../../../api/communityChallengesApi';
import CommunityChallengeDetailScreen from '../CommunityChallengeDetailScreen';

const api = jest.mocked(communityChallengesApi);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const axiosErr = (status: number, data: Record<string, unknown> = {}) => ({ isAxiosError: true, response: { status, data } });
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' };
const TIMEOUT = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };
const SERVER_DOWN = axiosErr(504, { error: 'gateway_timeout' });
const REFUSED_400 = axiosErr(400, { error: 'bad_request', code: 'IDEMPOTENCY_KEY_INVALID' });
const REUSED_409 = axiosErr(409, { error: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED' });

/** Comment `n`: its challenge, words and key (a key must be a v4 uuid, never missing). */
const sent = (n: number): { body: string; key: string } => {
  const [challengeId, body, key] = api.addComment.mock.calls[n] as unknown as [string, string, string | undefined];
  expect(challengeId).toBe('ch-1');
  expect(key).toEqual(expect.stringMatching(UUID));
  return { body, key: key as string };
};

beforeEach(() => {
  Object.values(api).forEach((fn) => (fn as jest.Mock).mockReset());
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  api.listComments.mockResolvedValue({ comments: [], next_cursor: null });
  api.getChallenge.mockResolvedValue({
    challenge: {
      id: 'ch-1', workspace_id: 'ws-1', cohort_id: 'co-1', created_by_user_id: 'coach-1', title: 'March step challenge',
      description: 'Walk 100k steps this month.', status: 'active', starts_at: null, ends_at: null, metric_key: 'steps',
      target_value: 100000, unit: 'steps', leaderboard_enabled: false, created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z', archived: false,
    },
    participation: {
      challenge_id: 'ch-1', user_id: 'me-1', progress_value: 25000, target_value: 100000, progress_fraction: 0.25,
      completed: false, completed_at: null, last_logged_at: '2026-03-05T00:00:00Z', leaderboard_opted_in: false,
    },
  });
  api.addComment.mockResolvedValue(undefined as never);
});
afterEach(() => jest.restoreAllMocks());

async function openChallenge() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}><CommunityChallengeDetailScreen /></QueryClientProvider>,
  );
  await screen.findByTestId(FIELD);
  return view;
}
const FIELD = 'community-challenge-composer-field';
const boxOf = (): string => screen.getByTestId(FIELD).props.value;
const type = async (words: string) => { await fireEvent.changeText(screen.getByTestId(FIELD), words); };
const send = async () => {
  await act(async () => { fireEvent.press(screen.getByTestId('community-challenge-composer-send')); });
};

it.each([
  ['no answer', NO_ANSWER],
  ['a timeout', TIMEOUT],
  ['a 5xx', SERVER_DOWN],
])('Send again after %s sends the same words with the same key', async (_label, err) => {
  api.addComment.mockRejectedValueOnce(err);
  await openChallenge();
  await type('Proud of you.');
  await send();
  await waitFor(() => expect(boxOf()).toBe('Proud of you.'));
  await send();
  await waitFor(() => expect(api.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1)).toEqual(sent(0));
  expect(sent(0).body).toBe('Proud of you.');
});

it('new words after a failed send are a new key', async () => {
  api.addComment.mockRejectedValueOnce(NO_ANSWER);
  await openChallenge();
  await type('Proud of you.');
  await send();
  await waitFor(() => expect(boxOf()).toBe('Proud of you.'));
  await type('Proud of you, keep going.');
  await send();
  await waitFor(() => expect(api.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it.each([
  ['a 400', REFUSED_400],
  ['a 409', REUSED_409],
])('after %s answer the same words sent again are a new key', async (_label, err) => {
  api.addComment.mockRejectedValueOnce(err);
  await openChallenge();
  await type('Proud of you.');
  await send();
  await waitFor(() => expect(boxOf()).toBe('Proud of you.'));
  await send();
  await waitFor(() => expect(api.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('two separate sends of the same words get two keys', async () => {
  await openChallenge();
  await type('Nice!');
  await send();
  await waitFor(() => expect(boxOf()).toBe(''));
  await type('Nice!');
  await send();
  await waitFor(() => expect(api.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});

it('leaving the challenge after a failed send ends the draft and its key', async () => {
  api.addComment.mockRejectedValueOnce(NO_ANSWER);
  const a = await openChallenge();
  await type('Proud of you.');
  await send();
  await waitFor(() => expect(boxOf()).toBe('Proud of you.'));
  await a.unmount();
  await openChallenge();
  expect(boxOf()).toBe('');
  await type('Proud of you.');
  await send();
  await waitFor(() => expect(api.addComment).toHaveBeenCalledTimes(2));
  expect(sent(1).key).not.toBe(sent(0).key);
});
