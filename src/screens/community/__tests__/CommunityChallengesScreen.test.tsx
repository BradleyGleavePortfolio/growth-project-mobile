/**
 * CommunityChallengesScreen — reachability, prerequisite-state, and bounded
 * cursor-fetch regression tests (v3-1).
 *
 * The discovery surface is what makes the detail screen findable. The screen
 * resolves the workspace id internally from `useCommunityMe` when no prop is
 * supplied (mirroring CommunityTabScreen) and pages the list with a cursor
 * envelope. These tests pin:
 *
 *   1. With NO workspaceId prop, the screen resolves the id from useCommunityMe
 *      and fires listChallenges(wsId, { limit }) — the route is not empty for
 *      want of an injected prop.
 *   2. The list fetch is bounded — listChallenges always carries the page
 *      limit, never bare.
 *   3. An explicit workspaceId prop wins (embedded callers avoid a second
 *      fetch) and still passes the bounded page limit.
 *   4. The workspace prerequisite resolves BEFORE the challenge empty state: a
 *      still-loading prerequisite shows a loading state (never "no challenges"),
 *      and an errored prerequisite shows a retry (never "no challenges").
 *
 * The data layer is mocked and a real QueryClient is provided so the screen's
 * own query branching runs deterministically.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Theme: real light tokens, no ThemeProvider ───────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

// ── Navigation ───────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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

// ── useCommunityMe — the internal workspace-id source (mutable holder) ────────
type MeState = {
  data: { workspace_id: string } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};
const mockMeHolder: MeState = {
  data: { workspace_id: 'ws-resolved' },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => mockMeHolder,
}));

// ── API client mock ──────────────────────────────────────────────────────────
jest.mock('../../../api/communityChallengesApi', () => ({
  communityChallengesApi: {
    listChallenges: jest.fn(),
  },
  CHALLENGES_PAGE_LIMIT: 20,
}));

import { AccessibilityInfo } from 'react-native';
import { communityChallengesApi } from '../../../api/communityChallengesApi';
import type {
  CommunityChallenge,
  CommunityChallengeListPage,
} from '../../../api/communityChallengesApi';
import CommunityChallengesScreen from '../CommunityChallengesScreen';

const api = jest.mocked(communityChallengesApi);

function challenge(
  overrides: Partial<CommunityChallenge> = {},
): CommunityChallenge {
  return {
    id: 'ch-1',
    workspace_id: 'ws-resolved',
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

function page(
  challenges: CommunityChallenge[],
  next_cursor: string | null = null,
): CommunityChallengeListPage {
  return { challenges, next_cursor };
}

function renderScreen(props: { workspaceId?: string | null } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CommunityChallengesScreen {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  flags.communityChallenges = true;
  mockMeHolder.data = { workspace_id: 'ws-resolved' };
  mockMeHolder.isLoading = false;
  mockMeHolder.isError = false;
  mockMeHolder.refetch = jest.fn();
  (api.listChallenges as jest.Mock).mockReset();
  api.listChallenges.mockResolvedValue(page([]));
});

describe('CommunityChallengesScreen — reachable discovery surface', () => {
  it('resolves the workspace id from useCommunityMe when no prop is supplied and fires a bounded list fetch', async () => {
    renderScreen(); // NO workspaceId prop — must self-resolve

    await waitFor(() =>
      expect(api.listChallenges).toHaveBeenCalledWith('ws-resolved', {
        limit: 20,
      }),
    );
    // The list fetch is bounded — never a bare unbounded call.
    expect(api.listChallenges).not.toHaveBeenCalledWith('ws-resolved');
  });

  it('does NOT fetch when no workspace id can be resolved (no prop, me settled with no workspace)', async () => {
    mockMeHolder.data = undefined;
    renderScreen();

    // The query is disabled without a workspace id — the route shows its empty
    // state rather than firing an unscoped fetch.
    await waitFor(() =>
      expect(screen.getByTestId('community-challenges-header')).toBeTruthy(),
    );
    expect(api.listChallenges).not.toHaveBeenCalled();
  });

  it('wraps each challenge row in a `role="listitem"` container for assistive tech', async () => {
    api.listChallenges.mockResolvedValue(page([challenge()]));
    renderScreen();

    const row = await screen.findByTestId('community-challenge-listitem-ch-1');
    expect(row.props.role).toBe('listitem');
  });

  it('prefers an explicit workspaceId prop (embedded caller) and still bounds the fetch', async () => {
    renderScreen({ workspaceId: 'ws-embedded' });

    await waitFor(() =>
      expect(api.listChallenges).toHaveBeenCalledWith('ws-embedded', {
        limit: 20,
      }),
    );
    expect(api.listChallenges).not.toHaveBeenCalledWith('ws-resolved', {
      limit: 20,
    });
  });
});

describe('CommunityChallengesScreen — workspace prerequisite resolves before empty', () => {
  it('shows the prerequisite loading state (never "no challenges") while me is loading', async () => {
    mockMeHolder.data = undefined;
    mockMeHolder.isLoading = true;
    renderScreen(); // self-resolving; me still loading

    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenges-prereq-loading'),
      ).toBeTruthy(),
    );
    // The benign empty copy must NOT be shown while the prerequisite loads.
    expect(screen.queryByTestId('community-challenges-empty')).toBeNull();
    expect(api.listChallenges).not.toHaveBeenCalled();
  });

  it('shows a retryable error (never "no challenges") when me errors', async () => {
    mockMeHolder.data = undefined;
    mockMeHolder.isError = true;
    renderScreen();

    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenges-prereq-error'),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId('community-challenges-prereq-retry')).toBeTruthy();
    expect(screen.queryByTestId('community-challenges-empty')).toBeNull();
  });

  it('treats an explicit null workspaceId prop as a still-pending prerequisite, not an empty workspace', async () => {
    renderScreen({ workspaceId: null });

    await waitFor(() =>
      expect(
        screen.getByTestId('community-challenges-prereq-loading'),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId('community-challenges-empty')).toBeNull();
    expect(api.listChallenges).not.toHaveBeenCalled();
  });

  it('reaches the true-empty state only once the prerequisite AND the list succeed', async () => {
    api.listChallenges.mockResolvedValue(page([]));
    renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('community-challenges-empty')).toBeTruthy(),
    );
  });
});

describe('CommunityChallengesScreen — list named + live-announced', () => {
  it('names the list with its loaded count and marks it a polite live region', async () => {
    api.listChallenges.mockResolvedValue(
      page([challenge({ id: 'ch-1' }), challenge({ id: 'ch-2' })]),
    );
    renderScreen();

    const list = await screen.findByTestId('community-challenges-list');
    await waitFor(() =>
      expect(list.props.accessibilityLabel).toBe('Challenges, 2 items'),
    );
    expect(list.props.accessibilityLiveRegion).toBe('polite');
  });

  it('names an empty list "Challenges, empty"', async () => {
    api.listChallenges.mockResolvedValue(page([]));
    renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('community-challenges-empty')).toBeTruthy(),
    );
  });

  it('announces the loaded count to assistive tech on data arrival', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    api.listChallenges.mockResolvedValue(
      page([
        challenge({ id: 'ch-1' }),
        challenge({ id: 'ch-2' }),
        challenge({ id: 'ch-3' }),
      ]),
    );
    renderScreen();

    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith('Challenges loaded, 3 items'),
    );
    announce.mockRestore();
  });
});
