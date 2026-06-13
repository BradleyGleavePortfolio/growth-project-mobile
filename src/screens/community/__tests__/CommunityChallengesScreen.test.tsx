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
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react-native';
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

type ScreenProps = {
  workspaceId?: string | null;
  prerequisiteLoading?: boolean;
  prerequisiteError?: boolean;
  onRetryPrerequisite?: () => void;
};

// A stable single QueryClient wrapper so `rerender` keeps the same cache
// (needed to assert a post-retry success transition within one mount).
function ChallengesWithClient(props: ScreenProps): React.ReactElement {
  return <CommunityChallengesScreen {...props} />;
}

function renderScreen(props: ScreenProps = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <ChallengesWithClient {...props} />
    </QueryClientProvider>,
  );
  const rerender = (next: React.ReactElement) =>
    utils.rerender(
      <QueryClientProvider client={client}>{next}</QueryClientProvider>,
    );
  return { ...utils, rerender };
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

  it('embedded tab: a /community/me error renders the retryable error (NOT loading), retry refetches, success renders challenges (P1)', async () => {
    // The embedded tab threads the real `me` truth through props. A rejected
    // `/community/me` arrives as workspaceId=null + prerequisiteError=true; the
    // screen must render the SAME calm retryable error the route renders — never
    // an indefinite loading state (50-failures #36, swallowed error).
    const onRetryPrerequisite = jest.fn();
    const { rerender } = renderScreen({
      workspaceId: null,
      prerequisiteLoading: false,
      prerequisiteError: true,
      onRetryPrerequisite,
    });

    // Retryable error rendered, NOT the loading state, NOT the empty state.
    await waitFor(() =>
      expect(screen.getByTestId('community-challenges-prereq-error')).toBeTruthy(),
    );
    expect(screen.queryByTestId('community-challenges-prereq-loading')).toBeNull();
    expect(screen.queryByTestId('community-challenges-empty')).toBeNull();
    expect(api.listChallenges).not.toHaveBeenCalled();

    // Retry actually refetches /community/me (the parent's me.refetch).
    fireEvent.press(screen.getByTestId('community-challenges-prereq-retry'));
    expect(onRetryPrerequisite).toHaveBeenCalledTimes(1);

    // After a successful refetch the parent rethreads a resolved id + cleared
    // prerequisite flags, and the challenges list renders.
    api.listChallenges.mockResolvedValue(page([challenge({ id: 'ch-1' })]));
    rerender(
      <ChallengesWithClient
        workspaceId="ws-resolved"
        prerequisiteLoading={false}
        prerequisiteError={false}
        onRetryPrerequisite={onRetryPrerequisite}
      />,
    );
    expect(await screen.findByTestId('community-challenge-card-ch-1')).toBeTruthy();
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

describe('CommunityChallengesScreen — real cursor page transitions (P2-C4)', () => {
  // A bare UUID the first page hands back as `next_cursor`; the second fetch
  // must send it verbatim as the `cursor` param (backend #392 bare-UUID
  // contract), and a `next_cursor: null` second page must stop further fetches.
  const CURSOR_UUID = '11111111-1111-4111-8111-111111111111';

  it('sends the first page next_cursor as the bare cursor param, then stops on null', async () => {
    api.listChallenges
      .mockResolvedValueOnce(page([challenge({ id: 'ch-1' })], CURSOR_UUID))
      .mockResolvedValueOnce(page([challenge({ id: 'ch-2' })], null));
    renderScreen();

    // First page lands (bounded, no cursor).
    await waitFor(() =>
      expect(api.listChallenges).toHaveBeenNthCalledWith(1, 'ws-resolved', {
        limit: 20,
      }),
    );
    await screen.findByTestId('community-challenge-card-ch-1');

    // Trigger the real onEndReached page transition.
    const list = screen.getByTestId('community-challenges-list');
    await act(async () => {
      list.props.onEndReached();
    });

    // The second call sends the first page's next_cursor verbatim as the bare
    // cursor value (not wrapped, not a synthetic page number).
    await waitFor(() =>
      expect(api.listChallenges).toHaveBeenNthCalledWith(2, 'ws-resolved', {
        limit: 20,
        cursor: CURSOR_UUID,
      }),
    );
    await screen.findByTestId('community-challenge-card-ch-2');

    // The second page terminated the cursor (null) -> a further onEndReached is
    // a no-op (hasNextPage is false), so no third request fires. Re-query the
    // list node first: the prior render swapped the FlatList instance, so the
    // earlier handle is stale.
    const listAfter = screen.getByTestId('community-challenges-list');
    await act(async () => {
      listAfter.props.onEndReached();
    });
    await waitFor(() =>
      expect(api.listChallenges).toHaveBeenCalledTimes(2),
    );
  });

  it('renders each id once when an overlapping page replays a duplicate (dedupe, P2-C3)', async () => {
    // The second page replays ch-1 (overlapping cursor window) alongside a new
    // ch-2; the merged list must render ch-1 once, first-occurrence order kept.
    api.listChallenges
      .mockResolvedValueOnce(page([challenge({ id: 'ch-1' })], CURSOR_UUID))
      .mockResolvedValueOnce(
        page([challenge({ id: 'ch-1' }), challenge({ id: 'ch-2' })], null),
      );
    renderScreen();

    await screen.findByTestId('community-challenge-card-ch-1');
    const list = screen.getByTestId('community-challenges-list');
    await act(async () => {
      list.props.onEndReached();
    });
    await screen.findByTestId('community-challenge-card-ch-2');

    // ch-1 appears exactly once despite being present in both pages.
    await waitFor(() =>
      expect(screen.getAllByTestId('community-challenge-listitem-ch-1')).toHaveLength(1),
    );
    expect(
      screen.getAllByTestId('community-challenge-listitem-ch-2'),
    ).toHaveLength(1);
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
