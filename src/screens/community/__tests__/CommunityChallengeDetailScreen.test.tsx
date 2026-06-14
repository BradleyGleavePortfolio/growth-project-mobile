/**
 * CommunityChallengeDetailScreen — render + behavioral-design regression tests
 * (v3-1). These pin the contract the design doctrine (Part III) imposes on the
 * challenge surface:
 *
 *   1. Flag-off invariance: when `communityChallenges` is false the screen
 *      renders a neutral "not available" state and NEVER calls the API — the
 *      surface is inert (matches the dead-route navigator posture).
 *   2. Personal progress is shown first; the primary action is Join when the
 *      caller has not joined, and Log progress once they have.
 *   3. The leaderboard is STRICTLY OPT-IN: even when the coach enabled it, a
 *      joined-but-not-opted-in caller sees only a calm opt-in affordance and
 *      NO standings are requested (§3.2 local + §3.4 no public failure).
 *
 * The data layer (`communityChallengesApi`) is mocked and a real QueryClient is
 * provided so the screen's own useQuery/useMutation branching is exercised
 * deterministically.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Theme: real light tokens, no ThemeProvider ───────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

// ── Navigation ───────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { challengeId: 'ch-1' } }),
}));

// ── Current user ─────────────────────────────────────────────────────────────
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', name: 'Dana' }),
}));

// ── Feature flags — overridden per test via the mutable holder ───────────────
const flags = { communityChallenges: true };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

// ── Safe-area stub ───────────────────────────────────────────────────────────
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// ── API client mock ──────────────────────────────────────────────────────────
jest.mock('../../../api/communityChallengesApi', () => ({
  communityChallengesApi: {
    getChallenge: jest.fn(),
    listComments: jest.fn(),
    getLeaderboard: jest.fn(),
    join: jest.fn(),
    updateProgress: jest.fn(),
    setLeaderboardOptIn: jest.fn(),
    addComment: jest.fn(),
    reportComment: jest.fn(),
  },
  // The screen imports the bounded page-limit constants from this module; the
  // mock must re-export them or they resolve to `undefined` and the bounded
  // fetch assertions (limit: 20) would see `{ limit: undefined }`.
  CHALLENGE_COMMENTS_PAGE_LIMIT: 20,
  CHALLENGE_LEADERBOARD_PAGE_LIMIT: 20,
}));

import { communityChallengesApi } from '../../../api/communityChallengesApi';
import type {
  CommunityChallenge,
  CommunityChallengeComment,
  CommunityChallengeParticipation,
} from '../../../api/communityChallengesApi';
// The local Roman empty-state copy that this surface must NEVER render (the
// original F1 P0 was rendering this local constant). Imported so the regression
// can assert its distinctive phrase is ABSENT from the rendered true-empty tree.
import { ROMAN_COMMUNITY_LINES } from '../../../components/community/romanVoice';
import CommunityChallengeDetailScreen from '../CommunityChallengeDetailScreen';

// F10: a properly typed mock surface via jest.mocked() rather than a double
// type-cast through the unknown type. Each method is already a jest.fn() from
// the module factory above, so jest.mocked() infers the mock types directly.
const api = jest.mocked(communityChallengesApi);

function challenge(
  overrides: Partial<CommunityChallenge> = {},
): CommunityChallenge {
  return {
    id: 'ch-1',
    workspace_id: 'ws-1',
    cohort_id: 'co-1',
    created_by_user_id: 'coach-1',
    title: 'March step challenge',
    description: 'Walk 100k steps this month.',
    status: 'active',
    starts_at: null,
    ends_at: null,
    metric_key: 'steps',
    target_value: 100000,
    unit: 'steps',
    leaderboard_enabled: false,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    archived: false,
    ...overrides,
  };
}

function participation(
  overrides: Partial<CommunityChallengeParticipation> = {},
): CommunityChallengeParticipation {
  return {
    challenge_id: 'ch-1',
    user_id: 'me-1',
    progress_value: 25000,
    target_value: 100000,
    progress_fraction: 0.25,
    completed: false,
    completed_at: null,
    last_logged_at: '2026-03-05T00:00:00Z',
    leaderboard_opted_in: false,
    ...overrides,
  };
}

async function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return await render(
    <QueryClientProvider client={client}>
      <CommunityChallengeDetailScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  flags.communityChallenges = true;
  Object.values(api).forEach((fn) => (fn as jest.Mock).mockReset());
  // Cursor envelopes per backend #392: comments/leaderboard return a paged
  // envelope (`next_cursor`), never a bare array.
  api.listComments.mockResolvedValue({ comments: [], next_cursor: null });
  api.getLeaderboard.mockResolvedValue({
    available: true,
    opted_in: false,
    rows: [],
    next_cursor: null,
  });
});

describe('CommunityChallengeDetailScreen — flag off', () => {
  it('renders a neutral not-available state and never touches the API', async () => {
    flags.communityChallenges = false;
    await renderScreen();

    expect(
      await screen.findByText('Challenges are not available right now.'),
    ).toBeTruthy();
    expect(api.getChallenge).not.toHaveBeenCalled();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });
});

describe('CommunityChallengeDetailScreen — joined caller', () => {
  it('shows personal progress and a Log progress primary action', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    await renderScreen();

    expect(await screen.findByText('25000 of 100000 steps')).toBeTruthy();
    const cta = await screen.findByTestId('community-challenge-primary-action');
    expect(cta).toBeTruthy();
    expect(screen.getByText('Log progress')).toBeTruthy();
  });
});

describe('CommunityChallengeDetailScreen — not joined', () => {
  it('shows a Join primary action and a join prompt', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: null,
    });
    await renderScreen();

    expect(await screen.findByText('Join this challenge')).toBeTruthy();
    expect(
      screen.getByText('Join to start logging your progress.'),
    ).toBeTruthy();
  });
});

describe('CommunityChallengeDetailScreen — leaderboard opt-in posture', () => {
  it('does NOT request standings until the caller opts in', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge({ leaderboard_enabled: true }),
      participation: participation({ leaderboard_opted_in: false }),
    });
    await renderScreen();

    // Opt-in affordance shown, no standings requested.
    expect(await screen.findByTestId('community-challenge-optin')).toBeTruthy();
    await waitFor(() => expect(api.getChallenge).toHaveBeenCalled());
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });

  it('requests standings only once opted in', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge({ leaderboard_enabled: true }),
      participation: participation({ leaderboard_opted_in: true }),
    });
    api.getLeaderboard.mockResolvedValue({
      available: true,
      opted_in: true,
      rows: [{ user_id: 'me-1', rank: 1, progress_value: 25000, is_self: true }],
      next_cursor: null,
    });
    await renderScreen();

    await waitFor(() =>
      expect(api.getLeaderboard).toHaveBeenCalledWith('ch-1', { limit: 20 }),
    );
    const lbRow = await screen.findByTestId('community-challenge-lb-me-1');
    expect(lbRow).toBeTruthy();
    // The leaderboard row wrapper carries the W3C `role="listitem"` so the
    // parent list's `accessibilityRole="list"` announces collection
    // membership; this mirrors the EventCard precedent (P1 — list/listitem).
    expect(lbRow.props.role).toBe('listitem');
  });

  it('hides the leaderboard entirely when the coach has not enabled it', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge({ leaderboard_enabled: false }),
      participation: participation({ leaderboard_opted_in: false }),
    });
    await renderScreen();

    await screen.findByTestId('community-challenge-primary-action');
    expect(screen.queryByTestId('community-challenge-leaderboard')).toBeNull();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });
});

describe('CommunityChallengeDetailScreen — error', () => {
  it('renders a recoverable error state with a retry, not a bare spinner', async () => {
    api.getChallenge.mockRejectedValue(new Error('boom'));
    await renderScreen();

    expect(await screen.findByTestId('community-challenge-error')).toBeTruthy();
    expect(screen.getByTestId('community-challenge-retry')).toBeTruthy();
  });
});

describe('CommunityChallengeDetailScreen — comments empty vs load error (F1/F8)', () => {
  it('renders a NEUTRAL true-empty state and NEVER the local Roman threadEmpty copy (F1 P0)', async () => {
    // F1 correction: the backend (PR #390 head) exposes NO participant-facing
    // empty-state payload endpoint and NO challenge-comments surface key in the
    // Roman voice-policy. Per the brief ("missing payload => honest state, never
    // local fallback") the only honest option is a NEUTRAL, non-Roman empty
    // state. This pins that the local Roman threadEmpty line is ABSENT (the
    // original P0) and that the real focus CTA is present (F8).
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.listComments.mockResolvedValue({ comments: [], next_cursor: null }); // server-confirmed zero rows
    await renderScreen();

    expect(
      await screen.findByTestId('community-challenge-comments-empty'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('community-challenge-comments-empty-action'),
    ).toBeTruthy();

    // The distinctive Roman threadEmpty phrase (token-free prefix) must be
    // absent so {firstName} interpolation cannot make the assertion pass.
    const romanPrefix = ROMAN_COMMUNITY_LINES.threadEmpty.straight.split(
      '{firstName}',
    )[0];
    expect(romanPrefix.length).toBeGreaterThan(0);
    const escaped = romanPrefix.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(screen.queryByText(new RegExp(escaped))).toBeNull();
  });

  it('renders a calm load-error (NOT the empty state) when comments fail to load', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.listComments.mockRejectedValue(new Error('comments down'));
    await renderScreen();

    // A load error is its own surface with a retry; the empty state is NOT shown
    // (a load error must never masquerade as "empty").
    expect(
      await screen.findByTestId('community-challenge-comments-load-error'),
    ).toBeTruthy();
    expect(screen.getByTestId('community-challenge-comments-retry')).toBeTruthy();
    expect(screen.queryByTestId('community-challenge-comments-empty')).toBeNull();
  });
});

describe('CommunityChallengeDetailScreen — optimistic join (P1)', () => {
  it('flips to the joined affordance immediately, then rolls back + announces on error', async () => {
    // Not joined to start.
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: null,
    });
    // The join round-trip fails so we can observe the rollback.
    api.join.mockRejectedValue(new Error('join failed'));

    await renderScreen();

    // Pre-mutation the primary action is Join.
    const cta = await screen.findByTestId('community-challenge-primary-action');
    expect(screen.getByText('Join this challenge')).toBeTruthy();

    await fireEvent.press(cta);

    // Optimistic write flips the cached participation -> the Join prompt is gone
    // and the calm error banner is surfaced after the round-trip rejects.
    await waitFor(() => expect(api.join).toHaveBeenCalledWith('ch-1'));
    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenge-action-error'),
      ).toBeTruthy(),
    );

    // Rollback: onSettled invalidates and the (still-null) server truth is
    // refetched, so the Join prompt returns — the optimistic state never dangles.
    await waitFor(() =>
      expect(screen.getByText('Join this challenge')).toBeTruthy(),
    );
  });
});

describe('CommunityChallengeDetailScreen — optimistic leaderboard opt-in (P1)', () => {
  it('reveals standings optimistically on opt-in, then rolls back + announces on error', async () => {
    // Joined, coach-enabled leaderboard, NOT yet opted in.
    api.getChallenge.mockResolvedValue({
      challenge: challenge({ leaderboard_enabled: true }),
      participation: participation({ leaderboard_opted_in: false }),
    });
    // The opt-in write fails so we observe rollback to opted-out.
    api.setLeaderboardOptIn.mockRejectedValue(new Error('opt-in failed'));

    await renderScreen();

    const optin = await screen.findByTestId('community-challenge-optin');
    await fireEvent.press(optin);

    // The write was attempted with the optimistic next value (true).
    await waitFor(() =>
      expect(api.setLeaderboardOptIn).toHaveBeenCalledWith('ch-1', true),
    );
    // On error the banner is surfaced (and announced via the live-region effect).
    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenge-action-error'),
      ).toBeTruthy(),
    );
    // Rollback: the opt-in affordance is shown again (opted_in reverted to false)
    // and standings were never persisted.
    await waitFor(() =>
      expect(screen.getByTestId('community-challenge-optin')).toBeTruthy(),
    );
  });
});

describe('CommunityChallengeDetailScreen — progress conflict (F3)', () => {
  it('refetches the detail after a 409 conflict on a progress write', async () => {
    const { CommunityApiError } = jest.requireActual(
      '../../../api/communityApi',
    );
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.updateProgress.mockRejectedValue(
      new CommunityApiError('conflict', 409, 'conflict'),
    );
    await renderScreen();

    // Open the sheet and submit a higher value; the write 409s.
    await fireEvent.press(
      await screen.findByTestId('community-challenge-primary-action'),
    );
    await fireEvent.changeText(
      await screen.findByTestId('community-challenge-progress-sheet-input'),
      '99999',
    );
    await fireEvent.press(
      screen.getByTestId('community-challenge-progress-sheet-submit'),
    );

    // The conflict triggers a re-fetch of the detail (true value): getChallenge
    // is called again beyond the initial load.
    await waitFor(() =>
      expect(api.getChallenge.mock.calls.length).toBeGreaterThan(1),
    );
    // The sheet surfaces its own calm inline error and stays open.
    expect(
      await screen.findByTestId('community-challenge-progress-sheet-error'),
    ).toBeTruthy();
  });
});

describe('CommunityChallengeDetailScreen — list/listitem semantics (P1)', () => {
  function comment(
    overrides: Partial<CommunityChallengeComment> = {},
  ): CommunityChallengeComment {
    return {
      id: 'cm-1',
      challenge_id: 'ch-1',
      author_user_id: 'other-1',
      body: 'Keep going, you have got this.',
      created_at: '2026-03-05T00:00:00Z',
      ...overrides,
    };
  }

  it('wraps each comment row in a `role="listitem"` container for assistive tech', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.listComments.mockResolvedValue({ comments: [comment()], next_cursor: null });
    await renderScreen();

    const row = await screen.findByTestId('community-challenge-comment-cm-1');
    // The comment row wrapper carries the W3C `role="listitem"` so the parent
    // comments list's `accessibilityRole="list"` announces collection
    // membership; this mirrors the EventCard precedent.
    expect(row.props.role).toBe('listitem');
  });
});

describe('CommunityChallengeDetailScreen — lists named + live-announced (P2-2)', () => {
  function comment(
    overrides: Partial<CommunityChallengeComment> = {},
  ): CommunityChallengeComment {
    return {
      id: 'cm-1',
      challenge_id: 'ch-1',
      author_user_id: 'other-1',
      body: 'Keep going, you have got this.',
      created_at: '2026-03-05T00:00:00Z',
      ...overrides,
    };
  }

  it('names the comments list with its count and marks it a polite live region', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.listComments.mockResolvedValue({
      comments: [comment({ id: 'cm-1' }), comment({ id: 'cm-2' })],
      next_cursor: null,
    });
    await renderScreen();

    const list = await screen.findByTestId('community-challenge-comments');
    await waitFor(() =>
      expect(list.props.accessibilityLabel).toBe('Encouragement notes, 2 items'),
    );
    expect(list.props.accessibilityLiveRegion).toBe('polite');
  });

  it('announces the loaded comment count to assistive tech on data arrival', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.listComments.mockResolvedValue({
      comments: [comment({ id: 'cm-1' })],
      next_cursor: null,
    });
    await renderScreen();

    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith('Encouragement notes loaded, 1 item'),
    );
    announce.mockRestore();
  });

  it('names the leaderboard list with its row count and announces it once opted in', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    api.getChallenge.mockResolvedValue({
      challenge: challenge({ leaderboard_enabled: true }),
      participation: participation({ leaderboard_opted_in: true }),
    });
    api.getLeaderboard.mockResolvedValue({
      available: true,
      opted_in: true,
      rows: [
        { user_id: 'me-1', rank: 1, progress_value: 25000, is_self: true },
        { user_id: 'u-2', rank: 2, progress_value: 20000, is_self: false },
      ],
      next_cursor: null,
    });
    await renderScreen();

    const list = await screen.findByTestId('community-challenge-leaderboard-list');
    await waitFor(() =>
      expect(list.props.accessibilityLabel).toBe('Leaderboard, 2 rows'),
    );
    expect(list.props.accessibilityLiveRegion).toBe('polite');
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith('Leaderboard loaded, 2 rows'),
    );
    announce.mockRestore();
  });
});

describe('CommunityChallengeDetailScreen — comment draft retention (P2-C3)', () => {
  it('keeps the typed draft and surfaces an error when the send rejects', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    // The comment send round-trip fails; the draft must survive the failure so
    // the user does not lose what they typed (a swallowed loss would be #36).
    api.addComment.mockRejectedValue(new Error('comment send down'));
    await renderScreen();

    const field = await screen.findByTestId(
      'community-challenge-composer-field',
    );
    await fireEvent.changeText(field, 'You are doing great, keep at it.');
    await fireEvent.press(screen.getByTestId('community-challenge-composer-send'));

    // A calm error banner is shown (the failure is surfaced, not swallowed)...
    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenge-action-error'),
      ).toBeTruthy(),
    );
    // ...and the draft is restored into the field so the user can retry.
    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenge-composer-field').props.value,
      ).toBe('You are doing great, keep at it.'),
    );
  });

  it('clears the draft only after a successful send', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.addComment.mockResolvedValue(undefined as never);
    await renderScreen();

    const field = await screen.findByTestId(
      'community-challenge-composer-field',
    );
    await fireEvent.changeText(field, 'Proud of you.');
    await fireEvent.press(screen.getByTestId('community-challenge-composer-send'));

    await waitFor(() => expect(api.addComment).toHaveBeenCalledWith('ch-1', 'Proud of you.'));
    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenge-composer-field').props.value,
      ).toBe(''),
    );
  });
});

describe('CommunityChallengeDetailScreen — real cursor page transitions (P2-C4)', () => {
  const CURSOR_UUID = '22222222-2222-4222-8222-222222222222';

  function comment(
    overrides: Partial<CommunityChallengeComment> = {},
  ): CommunityChallengeComment {
    return {
      id: 'cm-1',
      challenge_id: 'ch-1',
      author_user_id: 'other-1',
      body: 'Keep going, you have got this.',
      created_at: '2026-03-05T00:00:00Z',
      ...overrides,
    };
  }

  it('comments: onEndReached sends the first page next_cursor as the bare cursor, stops on null, dedupes', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.listComments
      .mockResolvedValueOnce({ comments: [comment({ id: 'cm-1' })], next_cursor: CURSOR_UUID })
      .mockResolvedValueOnce({
        comments: [comment({ id: 'cm-1' }), comment({ id: 'cm-2' })],
        next_cursor: null,
      });
    await renderScreen();

    await screen.findByTestId('community-challenge-comment-cm-1');
    await waitFor(() =>
      expect(api.listComments).toHaveBeenNthCalledWith(1, 'ch-1', { limit: 20 }),
    );

    const list = screen.getByTestId('community-challenge-comments');
    await act(async () => {
      list.props.onEndReached();
    });

    await waitFor(() =>
      expect(api.listComments).toHaveBeenNthCalledWith(2, 'ch-1', {
        limit: 20,
        cursor: CURSOR_UUID,
      }),
    );
    await screen.findByTestId('community-challenge-comment-cm-2');

    await waitFor(() =>
      expect(
        screen.getAllByTestId('community-challenge-comment-cm-1'),
      ).toHaveLength(1),
    );

    await act(async () => {
      list.props.onEndReached();
    });
    await waitFor(() => expect(api.listComments).toHaveBeenCalledTimes(2));
  });

  it('leaderboard: "Show more" sends the first page next_cursor as the bare cursor, stops on null, dedupes', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge({ leaderboard_enabled: true }),
      participation: participation({ leaderboard_opted_in: true }),
    });
    api.getLeaderboard
      .mockResolvedValueOnce({
        available: true,
        opted_in: true,
        rows: [{ user_id: 'me-1', rank: 1, progress_value: 25000, is_self: true }],
        next_cursor: CURSOR_UUID,
      })
      .mockResolvedValueOnce({
        available: true,
        opted_in: true,
        rows: [
          { user_id: 'me-1', rank: 1, progress_value: 25000, is_self: true },
          { user_id: 'u-2', rank: 2, progress_value: 20000, is_self: false },
        ],
        next_cursor: null,
      });
    await renderScreen();

    await waitFor(() =>
      expect(api.getLeaderboard).toHaveBeenNthCalledWith(1, 'ch-1', { limit: 20 }),
    );
    const showMore = await screen.findByTestId(
      'community-challenge-leaderboard-load-more',
    );
    await fireEvent.press(showMore);

    await waitFor(() =>
      expect(api.getLeaderboard).toHaveBeenNthCalledWith(2, 'ch-1', {
        limit: 20,
        cursor: CURSOR_UUID,
      }),
    );
    await screen.findByTestId('community-challenge-lb-u-2');

    await waitFor(() =>
      expect(screen.getAllByTestId('community-challenge-lb-me-1')).toHaveLength(1),
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId('community-challenge-leaderboard-load-more'),
      ).toBeNull(),
    );
    expect(api.getLeaderboard).toHaveBeenCalledTimes(2);
  });
});

describe('CommunityChallengeDetailScreen — composer keeps a newer draft on failed send (P2-C2)', () => {
  it('does NOT restore the failed draft over text typed while the send was pending', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    let rejectSend: ((err: Error) => void) | undefined;
    api.addComment.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }) as never,
    );
    await renderScreen();

    const field = await screen.findByTestId('community-challenge-composer-field');
    await fireEvent.changeText(field, 'Draft A');
    await fireEvent.press(screen.getByTestId('community-challenge-composer-send'));

    await waitFor(() => expect(field.props.value).toBe(''));
    await fireEvent.changeText(field, 'Draft B');

    await act(async () => {
      rejectSend?.(new Error('send failed'));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenge-composer-field').props.value,
      ).toBe('Draft B'),
    );
  });
});

describe('CommunityChallengeDetailScreen — report double-submit guard (P2-C4)', () => {
  function comment(
    overrides: Partial<CommunityChallengeComment> = {},
  ): CommunityChallengeComment {
    return {
      id: 'cm-1',
      challenge_id: 'ch-1',
      author_user_id: 'other-1',
      body: 'Keep going, you have got this.',
      created_at: '2026-03-05T00:00:00Z',
      ...overrides,
    };
  }

  it('fires exactly one report request on a rapid double-tap and reuses one key', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge(),
      participation: participation(),
    });
    api.listComments.mockResolvedValue({
      comments: [comment()],
      next_cursor: null,
    });
    // The report stays pending so the second tap lands while the first is in
    // flight — the guard must drop it.
    let resolveReport: (() => void) | undefined;
    api.reportComment.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReport = resolve;
        }),
    );
    await renderScreen();

    const reportBtn = await screen.findByTestId(
      'community-challenge-comment-cm-1-report',
    );
    await fireEvent.press(reportBtn);
    await fireEvent.press(reportBtn);

    await waitFor(() => expect(api.reportComment).toHaveBeenCalledTimes(1));
    // The single call carries a stable idempotency key (5th argument).
    const key = api.reportComment.mock.calls[0][4];
    expect(typeof key).toBe('string');
    expect((key as string).length).toBeGreaterThan(0);

    resolveReport?.();
    await waitFor(() => expect(api.reportComment).toHaveBeenCalledTimes(1));
  });
});
