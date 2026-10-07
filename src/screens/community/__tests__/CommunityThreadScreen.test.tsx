/**
 * CommunityThreadScreen — reactions that show and toggle, author/time lines,
 * own-post Delete, Back and pull to refresh (FW-COMM-128 U1, U2, U3, U5, U6).
 *
 * Real React Query and real community hooks; only the wire (communityApi),
 * navigation, theme and the signed-in user are stubbed. Emoji come from the
 * shared allowlist (no emoji literals in screen sources or tests).
 */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => mockCanGoBack }),
  useRoute: () => ({ params: { postId: '33333333-3333-3333-3333-333333333333' } }),
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    id: '22222222-2222-2222-2222-222222222222',
    coach_id: '99999999-9999-9999-9999-999999999999',
  }),
}));

const mockApi = {
  getMe: jest.fn(),
  getPost: jest.fn(),
  listComments: jest.fn(),
  addComment: jest.fn(),
  reactToPost: jest.fn(),
  unreactToPost: jest.fn(),
  deletePost: jest.fn(),
};
jest.mock('../../../api/communityApi', () => ({
  ...jest.requireActual('../../../api/communityApi'),
  communityApi: {
    getMe: (...a: unknown[]) => mockApi.getMe(...a),
    getPost: (...a: unknown[]) => mockApi.getPost(...a),
    listComments: (...a: unknown[]) => mockApi.listComments(...a),
    addComment: (...a: unknown[]) => mockApi.addComment(...a),
    reactToPost: (...a: unknown[]) => mockApi.reactToPost(...a),
    unreactToPost: (...a: unknown[]) => mockApi.unreactToPost(...a),
    deletePost: (...a: unknown[]) => mockApi.deletePost(...a),
  },
}));

import { COMMUNITY_REACTION_EMOJI } from '../../../api/communityApi';
import CommunityThreadScreen from '../CommunityThreadScreen';

const WS = '11111111-1111-1111-1111-111111111111';
const ME = '22222222-2222-2222-2222-222222222222';
const POST = '33333333-3333-3333-3333-333333333333';
const OTHER = '44444444-4444-4444-4444-444444444444';
const COACH = '99999999-9999-9999-9999-999999999999';
const [E0, E1] = COMMUNITY_REACTION_EMOJI;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;

/** Today's production post: no author_name, no reactions. */
const prodPost = (over: Record<string, unknown> = {}) => ({
  id: POST, workspace_id: WS, cohort_id: null, author_user_id: OTHER, title: 'Hello', body: 'World',
  scope: 'hall', type: 'text', pinned: false, created_at: ago(2 * HOUR), updated_at: ago(2 * HOUR),
  deleted: false, ...over,
});
const state = (reactions: { emoji: string; count: number; reacted_by_me: boolean }[]) => ({
  target_type: 'post', target_id: POST, reactions,
});
const chip = (view: Awaited<ReturnType<typeof render>>, emoji: string) => view.getByTestId(`reaction-${emoji}`);

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockApi.getMe.mockResolvedValue({ workspace_id: WS, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } });
  mockApi.getPost.mockResolvedValue(prodPost());
  mockApi.listComments.mockResolvedValue([]);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const b = ((call[2] ?? []) as AlertButton[]).find((x) => x.text === text);
  if (!b?.onPress) throw new Error(`no alert button ${text}`);
  return b.onPress();
}

async function renderThread() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={qc}><CommunityThreadScreen /></QueryClientProvider>,
  );
  await waitFor(() => expect(view.getByText('World')).toBeTruthy());
  return view;
}

describe('CommunityThreadScreen reactions (U1)', () => {
  it('flips at once, then shows the summary the tap returned, and the next tap removes it (no reactions on the post)', async () => {
    let resolveTap: (v: unknown) => void = () => undefined;
    mockApi.reactToPost.mockReturnValue(new Promise((r) => { resolveTap = r; }));
    mockApi.unreactToPost.mockResolvedValue(state([]));
    const view = await renderThread();
    expect(chip(view, E0).props.accessibilityState).toMatchObject({ selected: false });

    await fireEvent.press(chip(view, E0));
    expect(mockApi.reactToPost).toHaveBeenCalledWith(POST, E0);
    await waitFor(() => expect(chip(view, E0).props.accessibilityState).toMatchObject({ selected: true }));
    expect(chip(view, E0).props.accessibilityLabel).toBe(`React ${E0}, 1`);

    await act(async () => resolveTap(state([{ emoji: E0, count: 2, reacted_by_me: true }])));
    await waitFor(() => expect(chip(view, E0).props.accessibilityLabel).toBe(`React ${E0}, 2`));
    // The post refetch (still without reactions) does not wipe what the tap returned.
    await waitFor(() => expect(mockApi.getPost).toHaveBeenCalledTimes(2));
    expect(chip(view, E0).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(chip(view, E0));
    expect(mockApi.unreactToPost).toHaveBeenCalledWith(POST, E0);
    expect(mockApi.reactToPost).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(chip(view, E0).props.accessibilityLabel).toBe(`React ${E0}`));
  });

  it('shows the post’s own summary when the backend sends it and refetches the post after a tap', async () => {
    mockApi.getPost.mockResolvedValue(prodPost({ reactions: [{ emoji: E1, count: 3, reacted_by_me: true }] }));
    mockApi.unreactToPost.mockResolvedValue(state([{ emoji: E1, count: 2, reacted_by_me: false }]));
    const view = await renderThread();
    await waitFor(() => expect(chip(view, E1).props.accessibilityLabel).toBe(`React ${E1}, 3`));
    expect(chip(view, E1).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(chip(view, E1));
    expect(mockApi.unreactToPost).toHaveBeenCalledWith(POST, E1);
    await waitFor(() => expect(mockApi.getPost).toHaveBeenCalledTimes(2));
  });
});

describe('CommunityThreadScreen author and time (U2)', () => {
  it('names the author only from ids or a sent name, otherwise shows only the time', async () => {
    mockApi.getPost.mockResolvedValue(prodPost({ author_name: 'Sam' }));
    mockApi.listComments.mockResolvedValue([
      { id: 'c-me', post_id: POST, author_user_id: ME, body: 'Mine', created_at: ago(5 * 60_000) },
      { id: 'c-coach', post_id: POST, author_user_id: COACH, body: 'Coach reply', created_at: ago(HOUR) },
      { id: 'c-named', post_id: POST, author_user_id: OTHER, author_name: 'Ana', body: 'Hi', created_at: ago(HOUR) },
      { id: 'c-anon', post_id: POST, author_user_id: OTHER, body: 'Hey', created_at: ago(3 * 24 * HOUR) },
    ]);
    const view = await renderThread();
    expect(view.getByTestId('community-thread-post-meta').props.children).toBe('Sam · 2h');
    await waitFor(() => expect(view.getByTestId('comment-meta-c-me').props.children).toBe('You · 5m'));
    expect(view.getByTestId('comment-meta-c-coach').props.children).toBe('Your coach · 1h');
    expect(view.getByTestId('comment-meta-c-named').props.children).toBe('Ana · 1h');
    expect(view.getByTestId('comment-meta-c-anon').props.children).toBe('3d');
  });

  it('shows only the time on a post from today’s backend (no author name sent)', async () => {
    const view = await renderThread();
    expect(view.getByTestId('community-thread-post-meta').props.children).toBe('2h');
  });
});

describe('CommunityThreadScreen own post, Back and refresh (U3, U5, U6)', () => {
  it('lets the author delete their own post after confirming, then leaves the thread', async () => {
    mockApi.getPost.mockResolvedValue(prodPost({ author_user_id: ME }));
    mockApi.deletePost.mockResolvedValue(undefined);
    const view = await renderThread();
    await fireEvent.press(view.getByTestId('community-thread-post-safety'));
    await fireEvent.press(view.getByTestId('community-thread-post-safety-delete'));
    expect(alertSpy.mock.calls[0][0]).toBe('Delete this post?');
    await act(async () => { await pressAlertButton('Delete'); });
    expect(mockApi.deletePost).toHaveBeenCalledWith(POST);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('Back returns, or opens the Community tab when nothing is beneath the thread', async () => {
    const view = await renderThread();
    await fireEvent.press(view.getByTestId('community-thread-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    mockCanGoBack = false;
    await fireEvent.press(view.getByTestId('community-thread-back'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityTab');
  });

  it('pull to refresh reloads the post and its replies, also when there are no replies yet', async () => {
    const view = await renderThread();
    await waitFor(() => expect(view.getByTestId('community-thread-empty')).toBeTruthy());
    await act(async () => view.getByTestId('community-thread-replies').props.refreshControl.props.onRefresh());
    expect(mockApi.getPost).toHaveBeenCalledTimes(2);
    expect(mockApi.listComments).toHaveBeenCalledTimes(2);
  });
});
