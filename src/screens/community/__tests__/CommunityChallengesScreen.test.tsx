/**
 * CommunityChallengesScreen — reachability + bounded-fetch regression tests
 * (v3-1, P1).
 *
 * The discovery surface is what makes the detail screen findable. The P1
 * finding was that the route could be reached with no workspace id threaded in
 * (deep link) and therefore fetch nothing — a functionally empty route. The fix
 * resolves the workspace id INTERNALLY from `useCommunityMe` when no prop is
 * supplied, mirroring CommunityTabScreen. These tests pin:
 *
 *   1. With NO workspaceId prop, the screen resolves the id from useCommunityMe
 *      and fires listChallenges(wsId, { limit }) — the route is not empty for
 *      want of an injected prop.
 *   2. The list fetch is BOUNDED — listChallenges is always called with the
 *      page limit (Category 3 — no unbounded fetches), never bare.
 *   3. An explicit workspaceId prop wins (embedded callers avoid a second
 *      fetch) and still passes the bounded page limit.
 *
 * The data layer is mocked and a real QueryClient is provided so the screen's
 * own useQuery branching runs deterministically.
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
const meHolder: { data: { workspace_id: string } | undefined } = {
  data: { workspace_id: 'ws-resolved' },
};
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => meHolder,
}));

// ── API client mock ──────────────────────────────────────────────────────────
jest.mock('../../../api/communityChallengesApi', () => ({
  communityChallengesApi: {
    listChallenges: jest.fn(),
  },
  CHALLENGES_PAGE_LIMIT: 20,
}));

import { communityChallengesApi } from '../../../api/communityChallengesApi';
import type { CommunityChallenge } from '../../../api/communityChallengesApi';
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
  meHolder.data = { workspace_id: 'ws-resolved' };
  (api.listChallenges as jest.Mock).mockReset();
  api.listChallenges.mockResolvedValue([]);
});

describe('CommunityChallengesScreen — reachable discovery surface (P1)', () => {
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

  it('does NOT fetch when no workspace id can be resolved (no prop, no me)', async () => {
    meHolder.data = undefined;
    renderScreen();

    // The query is disabled without a workspace id — the route shows its empty
    // state rather than firing an unscoped fetch.
    await waitFor(() =>
      expect(screen.getByTestId('community-challenges-header')).toBeTruthy(),
    );
    expect(api.listChallenges).not.toHaveBeenCalled();
  });

  it('wraps each challenge row in a `role="listitem"` container for assistive tech (P1 — list/listitem semantics)', async () => {
    api.listChallenges.mockResolvedValue([challenge()]);
    renderScreen();

    const row = await screen.findByTestId('community-challenge-listitem-ch-1');
    // The outer wrapper must carry the W3C `role="listitem"` so the parent
    // FlatList's `accessibilityRole="list"` announces collection membership;
    // this mirrors the EventCard precedent.
    expect(row.props.role).toBe('listitem');
  });

  it('prefers an explicit workspaceId prop (embedded caller) and still bounds the fetch', async () => {
    renderScreen({ workspaceId: 'ws-embedded' });

    await waitFor(() =>
      expect(api.listChallenges).toHaveBeenCalledWith('ws-embedded', {
        limit: 20,
      }),
    );
    // The internally-resolved id is NOT used when the prop is present.
    expect(api.listChallenges).not.toHaveBeenCalledWith('ws-resolved', {
      limit: 20,
    });
  });
});
