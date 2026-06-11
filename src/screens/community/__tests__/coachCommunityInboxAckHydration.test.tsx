/**
 * CoachCommunityInboxScreen — v2-2 ack-cache HYDRATION + reconciliation
 * (R1 fixer: M-P0 regression + M-P1d pull-to-refresh).
 *
 * WHY a SEPARATE file from coachCommunityScreens.test.tsx: that suite mocks the
 * whole `useCoachCommunity` module — crucially `useCoachAckState` — and stubs an
 * INERT `@tanstack/react-query` client whose `setQueryData` is a no-op. Under
 * those mocks the inbox seeding effect cannot actually run and the badge state
 * is injected directly, so it can NOT catch the real P0 bug: the inbox parsing
 * the backend `ack` envelope, seeding the per-message cache, and the badge
 * reading it back. That was a SILENT FAILURE (the parser swallowed the real
 * envelope and every row fell back to the weakest `none` pill while the data was
 * right there on the wire).
 *
 * This suite instead drives the REAL path end to end:
 *   - a REAL QueryClient + QueryClientProvider,
 *   - the REAL `useCoachInbox` / `useCoachAckState` hooks (NOT mocked),
 *   - only the network seam (`coachCommunityApi.getInbox`) is mocked to return a
 *     page whose items carry the FULL backend ack envelope (the exact shape the
 *     backend now emits — `{state, seen_at, acked_at, replied_at, sla:{...}}`).
 *
 * M-P0 regression: with a real `acked`/`replied` envelope on the wire, the row's
 * badge must render the state-specific testID (`…-state-acked`), NOT `…-state-none`.
 * A regression in the parse/seed/read path flips this back to `none` and fails.
 *
 * M-P1d: a pull-to-refresh that returns a HIGHER state must OVERWRITE the cached
 * badge (the prior implementation skipped any entry already in cache, so a
 * refetch silently ignored newer backend state).
 */
import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Theme: real light tokens, no ThemeProvider (mirrors the sibling suite). ──
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// ── Safe-area: no provider in the test tree. ─────────────────────────────────
jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLocal.createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// ── Navigation: inert navigate. ──────────────────────────────────────────────
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

// ── Flag ON so the inbox seeds + renders ack badges. ─────────────────────────
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, communityAcks: true },
  };
});

// ── Empty-state payload hook: ready (never reached when items are present). ──
jest.mock('../../../hooks/useCoachEmptyStatePayload', () => ({
  useCoachEmptyStatePayload: () => ({
    status: 'ready',
    payload: {
      text: 'EMPTY',
      avatar_crop: 'neutral',
      surface_key: 'coach_community_inbox_empty',
      voice_variant: 'roman_v2',
    },
  }),
}));

// ── ONLY the network seam is mocked. Everything else (useCoachInbox,
//    useCoachAckState, the seeding effect, the real QueryClient) runs for real.
jest.mock('../../../api/coachCommunityApi', () => {
  const actual = jest.requireActual('../../../api/coachCommunityApi');
  return {
    ...actual,
    coachCommunityApi: {
      ...actual.coachCommunityApi,
      getInbox: jest.fn(),
      // ack transitions are exercised in M-P1d below.
      markCoachAckSeen: jest.fn(),
      markCoachAckAcked: jest.fn(),
      markCoachAckReplied: jest.fn(),
    },
  };
});

import { coachCommunityApi } from '../../../api/coachCommunityApi';
import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';

const mockApi = coachCommunityApi as unknown as {
  getInbox: jest.Mock;
  markCoachAckSeen: jest.Mock;
  markCoachAckAcked: jest.Mock;
  markCoachAckReplied: jest.Mock;
};

const MID = '11111111-1111-1111-1111-111111111111';

/** A FULL backend ack envelope (the exact shape the inbox now emits). */
function ackEnvelope(
  state: 'none' | 'seen' | 'acked' | 'replied',
  sla: 'within' | 'warning' | 'breached' = 'within',
) {
  return {
    state,
    seen_at: state === 'none' ? null : '2026-06-09T12:00:00.000Z',
    acked_at:
      state === 'acked' || state === 'replied'
        ? '2026-06-09T12:05:00.000Z'
        : null,
    replied_at: state === 'replied' ? '2026-06-09T12:10:00.000Z' : null,
    sla: {
      sla_state: sla,
      elapsed_ms: 1_000,
      soft_target_ms: 24 * 60 * 60 * 1000,
      hard_target_ms: 48 * 60 * 60 * 1000,
    },
  };
}

function inboxItem(ack: ReturnType<typeof ackEnvelope> | undefined, id = MID) {
  return {
    id,
    cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    cohort_name: 'Spring block',
    client_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    client_name: 'Dana Cruz',
    avatar_url: null,
    snippet: 'Quick question about my plan',
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    acknowledged: false,
    ...(ack != null ? { ack } : {}),
  };
}

function renderInbox() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CoachCommunityInboxScreen />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

beforeEach(() => {
  mockApi.getInbox.mockReset();
  mockApi.markCoachAckSeen.mockReset();
  mockApi.markCoachAckAcked.mockReset();
  mockApi.markCoachAckReplied.mockReset();
});

describe('M-P0 regression — inbox hydrates the ack badge from the real backend envelope', () => {
  it('renders the state-specific badge (acked), NOT the weakest none fallback', async () => {
    mockApi.getInbox.mockResolvedValue({
      items: [inboxItem(ackEnvelope('acked', 'within'))],
      next_before: null,
    });

    const { getByTestId, queryByTestId } = renderInbox();

    // The badge container appears once the page loads.
    await waitFor(() =>
      expect(getByTestId(`coach-community-inbox-ack-badge-${MID}`)).toBeTruthy(),
    );
    // CRITICAL: the parse+seed+read path produced the REAL state, not `none`.
    await waitFor(() =>
      expect(
        getByTestId(`coach-community-inbox-ack-badge-${MID}-state-acked`),
      ).toBeTruthy(),
    );
    expect(
      queryByTestId(`coach-community-inbox-ack-badge-${MID}-state-none`),
    ).toBeNull();
  });

  it('hydrates a replied envelope (strongest state) and omits the SLA chip', async () => {
    mockApi.getInbox.mockResolvedValue({
      items: [inboxItem(ackEnvelope('replied'))],
      next_before: null,
    });

    const { getByTestId, queryByTestId } = renderInbox();

    await waitFor(() =>
      expect(
        getByTestId(`coach-community-inbox-ack-badge-${MID}-state-replied`),
      ).toBeTruthy(),
    );
    // A settled (replied) thread shows no live SLA chip.
    expect(
      queryByTestId(`coach-community-inbox-ack-badge-${MID}-sla-within`),
    ).toBeNull();
  });

  it('surfaces the breached SLA chip on a seen-but-overdue envelope', async () => {
    mockApi.getInbox.mockResolvedValue({
      items: [inboxItem(ackEnvelope('seen', 'breached'))],
      next_before: null,
    });

    const { getByTestId } = renderInbox();

    await waitFor(() =>
      expect(
        getByTestId(`coach-community-inbox-ack-badge-${MID}-state-seen`),
      ).toBeTruthy(),
    );
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-sla-breached`),
    ).toBeTruthy();
  });

  it('falls back to none ONLY when the wire envelope is genuinely absent', async () => {
    mockApi.getInbox.mockResolvedValue({
      items: [inboxItem(undefined)],
      next_before: null,
    });

    const { getByTestId } = renderInbox();

    await waitFor(() =>
      expect(getByTestId(`coach-community-inbox-ack-badge-${MID}`)).toBeTruthy(),
    );
    // No envelope on the wire => the weakest pill is the HONEST render (this is
    // the only legitimate `none`, distinct from the silent-failure `none`).
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-state-none`),
    ).toBeTruthy();
  });
});

describe('M-P1d — pull-to-refresh reconciles the ack cache from the fresh inbox payload', () => {
  it('OVERWRITES a stale cached badge when a refetch returns a higher state', async () => {
    // First load: seen. Refetch: acked. The badge must catch up (the prior
    // skip-if-cached impl left it stuck at `seen` because the entry already
    // existed in the per-message cache).
    mockApi.getInbox
      .mockResolvedValueOnce({
        items: [inboxItem(ackEnvelope('seen', 'within'))],
        next_before: null,
      })
      .mockResolvedValueOnce({
        items: [inboxItem(ackEnvelope('acked', 'within'))],
        next_before: null,
      });

    const { getByTestId, UNSAFE_getByType } = renderInbox();

    await waitFor(() =>
      expect(
        getByTestId(`coach-community-inbox-ack-badge-${MID}-state-seen`),
      ).toBeTruthy(),
    );

    // Pull-to-refresh: fire the FlatList RefreshControl's onRefresh, which is
    // wired to inbox.refetch(). This is the real user-visible affordance.
    const refreshControl = UNSAFE_getByType(RefreshControl);
    await act(async () => {
      refreshControl.props.onRefresh();
    });

    await waitFor(() => expect(mockApi.getInbox).toHaveBeenCalledTimes(2));
    // The badge caught up to the fresher backend state instead of staying stale.
    await waitFor(() =>
      expect(
        getByTestId(`coach-community-inbox-ack-badge-${MID}-state-acked`),
      ).toBeTruthy(),
    );
  });

  it('does NOT clobber an in-flight optimistic transition during a refetch', async () => {
    // The row is at `seen`; the coach taps "Mark acked" (optimistic -> acked)
    // while a refetch returns a STALE `seen`. The optimistic acked state must
    // survive the reconcile (the mutation owns the cache until it settles).
    mockApi.getInbox.mockResolvedValue({
      items: [inboxItem(ackEnvelope('seen', 'within'))],
      next_before: null,
    });
    // Hold the ack transition open so it stays "in flight" across the refetch.
    let resolveAck: (v: unknown) => void = () => {};
    mockApi.markCoachAckAcked.mockReturnValue(
      new Promise((res) => {
        resolveAck = res;
      }),
    );

    const { getByTestId, UNSAFE_getByType } = renderInbox();

    await waitFor(() =>
      expect(
        getByTestId(`coach-community-inbox-ack-badge-${MID}-state-seen`),
      ).toBeTruthy(),
    );

    // Tap Mark acked -> optimistic raise to acked, request pending.
    await act(async () => {
      fireEvent.press(getByTestId(`coach-community-inbox-mark-acked-${MID}`));
    });
    await waitFor(() =>
      expect(
        getByTestId(`coach-community-inbox-ack-badge-${MID}-state-acked`),
      ).toBeTruthy(),
    );

    // A refetch now returns the STALE seen envelope while the ack is pending.
    const refreshControl = UNSAFE_getByType(RefreshControl);
    await act(async () => {
      refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(mockApi.getInbox).toHaveBeenCalledTimes(2));

    // The optimistic acked state was NOT clobbered back to seen by the refetch.
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-state-acked`),
    ).toBeTruthy();

    // Settle the transition so no act() warnings leak.
    await act(async () => {
      resolveAck({
        message_id: MID,
        ack: ackEnvelope('acked', 'within'),
      });
    });
  });
});
