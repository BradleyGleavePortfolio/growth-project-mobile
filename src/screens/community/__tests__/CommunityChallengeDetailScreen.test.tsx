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
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
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
}));

import { communityChallengesApi } from '../../../api/communityChallengesApi';
import type {
  CommunityChallenge,
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

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CommunityChallengeDetailScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  flags.communityChallenges = true;
  Object.values(api).forEach((fn) => (fn as jest.Mock).mockReset());
  api.listComments.mockResolvedValue([]);
  api.getLeaderboard.mockResolvedValue({ available: true, opted_in: false, rows: [] });
});

describe('CommunityChallengeDetailScreen — flag off', () => {
  it('renders a neutral not-available state and never touches the API', async () => {
    flags.communityChallenges = false;
    renderScreen();

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
    renderScreen();

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
    renderScreen();

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
    renderScreen();

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
    });
    renderScreen();

    await waitFor(() => expect(api.getLeaderboard).toHaveBeenCalledWith('ch-1'));
    expect(await screen.findByTestId('community-challenge-lb-me-1')).toBeTruthy();
  });

  it('hides the leaderboard entirely when the coach has not enabled it', async () => {
    api.getChallenge.mockResolvedValue({
      challenge: challenge({ leaderboard_enabled: false }),
      participation: participation({ leaderboard_opted_in: false }),
    });
    renderScreen();

    await screen.findByTestId('community-challenge-primary-action');
    expect(screen.queryByTestId('community-challenge-leaderboard')).toBeNull();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });
});

describe('CommunityChallengeDetailScreen — error', () => {
  it('renders a recoverable error state with a retry, not a bare spinner', async () => {
    api.getChallenge.mockRejectedValue(new Error('boom'));
    renderScreen();

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
    api.listComments.mockResolvedValue([]); // server-confirmed zero rows
    renderScreen();

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
    renderScreen();

    // A load error is its own surface with a retry; the empty state is NOT shown
    // (a load error must never masquerade as "empty").
    expect(
      await screen.findByTestId('community-challenge-comments-load-error'),
    ).toBeTruthy();
    expect(screen.getByTestId('community-challenge-comments-retry')).toBeTruthy();
    expect(screen.queryByTestId('community-challenge-comments-empty')).toBeNull();
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
    renderScreen();

    // Open the sheet and submit a higher value; the write 409s.
    fireEvent.press(
      await screen.findByTestId('community-challenge-primary-action'),
    );
    fireEvent.changeText(
      await screen.findByTestId('community-challenge-progress-sheet-input'),
      '99999',
    );
    fireEvent.press(
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
