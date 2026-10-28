/**
 * Behaviour tests for the v1-6 Coach Community screens (fixer R1 — payload-driven).
 *
 * Every data + mutation hook is mocked so each render path is deterministic and
 * the suite exits clean (no React Query timers). Coverage:
 *   - All five screens + the post-detail screen render their root testID
 *     without throwing (flag ON, mocked API).
 *   - FACE + VOICE contract (operator-locked 2026-06-10): every empty state
 *     renders <RomanAvatar /> (by `${root}-avatar` testID) AND the BACKEND
 *     PAYLOAD text — NOT a hardcoded local constant. The hook
 *     `useCoachEmptyStatePayload` is mocked to return the discriminated
 *     `{ status: 'ready', payload }` result with a deterministic synthetic
 *     payload (`text: "TEST_EMPTY_<SURFACE>_COPY"`, `voice_variant: 'roman_v2'`)
 *     so the assertions prove the screen renders whatever the backend says,
 *     never the production string baked into the file. The hook's `loading`
 *     and `error` branches are exercised by overriding that mock per-test
 *     (see the dedicated describe block) so a missing/late surface renders an
 *     honest spinner/CoachErrorState — never Roman copy from a local constant.
 *   - THREE distinct branches per screen (UX P0.2): loading spinner; an honest
 *     CoachErrorState on a load error (NEVER the calm/empty masquerade); and the
 *     payload-driven empty state on a genuinely empty success.
 *   - Coach creates a cohort -> create mutation fires with the typed name.
 *   - Coach invites a client -> invite mutation fires with the email.
 *   - Coach removes a client -> kebab overflow -> confirmation modal -> DELETE.
 *   - Inbox aggregates across cohorts; ack fires; the visible Select mode marks
 *     the selected rows as read (UX P1.3 discoverable batch affordance).
 *   - Moderator hides a post -> confirmation modal -> hide mutation fires (Hide
 *     is the only moderation decision; the no-network Approve stub was removed).
 *   - Moderation post row taps through to the post-detail surface.
 *
 * useTheme is mocked to return the real light tokens so semanticColors keys
 * resolve without standing up the full ThemeProvider.
 */
import React from 'react';
import { render, fireEvent, configure, act } from '@testing-library/react-native';
import { Alert, RefreshControl, StyleSheet } from 'react-native';
import { colors } from '../../../theme/tokens';
import {
  CoachCommunityApiError,
  ACK_ILLEGAL_TRANSITION_CODE,
  type CoachEmptyStateSurfaceKey,
  type RomanCopyPayload,
} from '../../../api/coachCommunityApi';

// ── Theme: real tokens, no ThemeProvider ─────────────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// ── Safe-area: no SafeAreaProvider in the test tree ──────────────────────────
// CompletionToast (rendered by the Cohorts, CohortDetail, and Moderation
// screens) reads useSafeAreaInsets(); without a provider it throws. Mirror the
// established repo pattern (src/screens/client/wearables/__tests__/...).
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

// ── Navigation ───────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockRouteParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

// ── Coach community hooks (data + mutations + payload) ───────────────────────
type QueryStub = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isRefetching?: boolean;
  refetch?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
};
const mockState: {
  dashboard: QueryStub;
  inbox: QueryStub;
  cohorts: QueryStub;
  cohortDetail: QueryStub;
  flagged: QueryStub;
  postDetail: QueryStub;
} = {
  dashboard: { data: undefined, isLoading: false, isError: false },
  inbox: { data: { items: [], next_cursor: null }, isLoading: false, isError: false },
  cohorts: { data: [], isLoading: false, isError: false },
  cohortDetail: { data: undefined, isLoading: false, isError: false },
  flagged: { data: [], isLoading: false, isError: false },
  postDetail: { data: undefined, isLoading: false, isError: false },
};
const mockCreateMutate = jest.fn();
const mockInviteMutate = jest.fn();
const mockRemoveMutate = jest.fn();
const mockHideMutate = jest.fn();

/**
 * Deterministic synthetic payloads — NOT the production strings. Each surface's
 * empty branch must render THIS text, proving the copy is backend-payload-driven
 * and never the local constant in coachVoice.ts. `voice_variant: 'roman_v2'`
 * marks the live (non-fallback) path. The moderation surface carries the `smile`
 * crop; the rest carry `neutral`, mirroring the backend SURFACE_AVATAR_CROP map.
 */
const SYNTHETIC_EMPTY: Record<CoachEmptyStateSurfaceKey, RomanCopyPayload> = {
  coach_community_home_empty: {
    text: 'TEST_EMPTY_HOME_COPY',
    avatar_crop: 'neutral',
    surface_key: 'coach_community_home_empty',
    voice_variant: 'roman_v2',
  },
  coach_community_inbox_empty: {
    text: 'TEST_EMPTY_INBOX_COPY',
    avatar_crop: 'neutral',
    surface_key: 'coach_community_inbox_empty',
    voice_variant: 'roman_v2',
  },
  coach_community_cohorts_empty: {
    text: 'TEST_EMPTY_COHORTS_COPY',
    avatar_crop: 'neutral',
    surface_key: 'coach_community_cohorts_empty',
    voice_variant: 'roman_v2',
  },
  coach_community_cohort_members_empty: {
    text: 'TEST_EMPTY_MEMBERS_COPY',
    avatar_crop: 'neutral',
    surface_key: 'coach_community_cohort_members_empty',
    voice_variant: 'roman_v2',
  },
  coach_community_moderation_empty: {
    text: 'TEST_EMPTY_MODERATION_COPY',
    avatar_crop: 'smile',
    surface_key: 'coach_community_moderation_empty',
    voice_variant: 'roman_v2',
  },
};

/**
 * Per-surface override for the empty-state RESULT. `null` (the default) means
 * "return the ready result built from SYNTHETIC_EMPTY for that surface". A test
 * can set an override to exercise the `loading`/`error` branches that the
 * stateful hook now produces — proving the screen renders a spinner or
 * CoachErrorState rather than Roman copy when the payload is not yet ready.
 */
type RomanResult =
  | { status: 'loading' }
  | { status: 'error'; kind: 'network' | 'contract'; retry: () => void }
  | { status: 'ready'; payload: RomanCopyPayload };
const mockEmptyResultOverride: {
  current: Partial<Record<CoachEmptyStateSurfaceKey, RomanResult>>;
} = { current: {} };

// v2-2: a per-message ack envelope the badge reads, keyed by message id. Tests
// seed this to drive the badge state; default empty (weakest `none`).
const mockAckStateByMessage: { current: Record<string, unknown> } = {
  current: {},
};
const mockMarkAckedMutate = jest.fn();

jest.mock('../../../hooks/useCoachCommunity', () => {
  const actual = jest.requireActual('../../../hooks/useCoachCommunity');
  return {
    // Keep the real `coachCommunityKeys` (the screen seeds the ack cache with
    // it) while stubbing every data/mutation hook.
    coachCommunityKeys: actual.coachCommunityKeys,
    useCoachDashboard: () => mockState.dashboard,
    useCoachInbox: () => mockState.inbox,
    useCoachCohorts: () => mockState.cohorts,
    useCoachCohortDetail: () => mockState.cohortDetail,
    useCoachFlagged: () => mockState.flagged,
    useCoachPostDetail: () => mockState.postDetail,
    useCoachAckState: (messageId: string) =>
      mockAckStateByMessage.current[messageId],
    useCoachEmptyStatePayload: (surfaceKey: CoachEmptyStateSurfaceKey) =>
      mockEmptyResultOverride.current[surfaceKey] ?? {
        status: 'ready',
        payload: SYNTHETIC_EMPTY[surfaceKey],
      },
    useCreateCohort: () => ({ mutate: mockCreateMutate, isPending: false }),
    useInviteMember: () => ({ mutate: mockInviteMutate, isPending: false }),
    useRemoveMember: () => ({ mutate: mockRemoveMutate, isPending: false }),
    useModerateFlagged: () => ({ mutate: mockHideMutate, isPending: false }),
  };
});

// v2-2: ack-action hook. markAcked.mutate is the spy the Mark-acked
// quick-action fires; the other two are inert for these screen tests.
//
// The 409-conflict surface (F3) is driven by two mutable holders so a test can
// flip the row into its conflict branch: `mockMarkAckedError` becomes the
// CoachCommunityApiError the row reads, and `mockIsIllegalAckTransition` is the
// predicate the screen calls on that error. Both reset to the no-conflict
// default (null error, predicate false) in beforeEach.
const mockMarkAckedError: { current: unknown } = { current: null };
const mockIsIllegalAckTransition = jest.fn((_err: unknown) => false);
jest.mock('../../../hooks/useCoachAckActions', () => ({
  useCoachAckActions: () => ({
    markSeen: { mutate: jest.fn(), isPending: false, error: null },
    markAcked: {
      mutate: mockMarkAckedMutate,
      isPending: false,
      error: mockMarkAckedError.current,
    },
    markReplied: { mutate: jest.fn(), isPending: false, error: null },
  }),
  // The screen also imports the conflict predicate to decide whether to surface
  // the inline "message state changed" notice; default to false (no conflict).
  isIllegalAckTransition: (err: unknown) => mockIsIllegalAckTransition(err),
}));

// v2-2: force the kill-switch flag ON so the inbox renders the ack badge +
// Mark-acked quick-action. The screen reads `featureFlags.communityAcks` at
// module scope, so this mock must be in place before the screen is imported.
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, communityAcks: true },
  };
});

// react-query: the screen calls useQueryClient() to seed the ack cache. Provide
// an inert client so the seeding effect is a no-op in these render tests (the
// badge state is driven directly via the useCoachAckState mock above).
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }),
}));

import CoachCommunityHomeScreen from '../CoachCommunityHomeScreen';
import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';
import CoachCommunityCohortsScreen from '../CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../CoachCommunityCohortDetailScreen';
import CoachCommunityModerationScreen from '../CoachCommunityModerationScreen';
import CoachCommunityPostDetailScreen from '../CoachCommunityPostDetailScreen';

// v2-2: the per-row CoachAckBadge renders with `labelledByRow`, so it hides
// itself from the accessibility tree (the row owns the a11y summary). RTL
// excludes accessibility-hidden subtrees from queries by default; enable hidden
// elements file-wide so the badge testIDs stay queryable for these structural
// assertions. Negative `queryBy*` checks here assert genuine ABSENCE (elements
// not rendered at all), which this flag does not affect.
configure({ defaultIncludeHiddenElements: true });

const inboxItem = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  cohort_name: 'Spring block',
  client_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  client_name: 'Dana Cruz',
  avatar_url: null,
  snippet: 'Quick question about my plan',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  acknowledged: false,
  type: 'message',
  kind: 'text',
  ...over,
});

const cohort = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Spring block',
  member_count: 3,
  unread_count: 1,
  created_at: new Date().toISOString(),
  ...over,
});

const member = (over: Partial<Record<string, unknown>> = {}) => ({
  user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  name: 'Dana Cruz',
  email: 'dana@example.com',
  avatar_url: null,
  role: 'client',
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  joined_at: new Date().toISOString(),
  ...over,
});

const flaggedItem = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  target_type: 'post',
  target_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  content: 'Some reported content',
  author_name: 'Sam Lee',
  cohort_name: 'Spring block',
  reason: 'spam',
  created_at: new Date(Date.now() - 7_200_000).toISOString(),
  ...over,
});

const post = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  workspace_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  author_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  title: 'Form check thread',
  body: 'Filming my squat today.',
  scope: 'cohort',
  type: 'text',
  pinned: false,
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  updated_at: new Date(Date.now() - 3_600_000).toISOString(),
  deleted: false,
  ...over,
});

const comment = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'aaaa1111-aaaa-1111-aaaa-111111111111',
  post_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  author_user_id: 'cccc2222-cccc-2222-cccc-222222222222',
  body: 'Looks solid, drive the knees out.',
  created_at: new Date(Date.now() - 1_800_000).toISOString(),
  ...over,
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockRouteParams.current = {};
  mockCreateMutate.mockReset();
  mockInviteMutate.mockReset();
  mockRemoveMutate.mockReset();
  mockHideMutate.mockReset();
  mockMarkAckedMutate.mockReset();
  mockMarkAckedError.current = null;
  mockIsIllegalAckTransition.mockReset();
  mockIsIllegalAckTransition.mockReturnValue(false);
  mockAckStateByMessage.current = {};
  // Reset to default quiet/empty state per suite.
  mockState.dashboard = { data: undefined, isLoading: false, isError: false };
  mockState.inbox = { data: { items: [], next_cursor: null }, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.cohorts = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.cohortDetail = { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.flagged = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.postDetail = { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockEmptyResultOverride.current = {};
});

describe('Coach Community screens — render with flag ON, mocked API', () => {
  it('Home renders', async () => {
    mockState.dashboard = {
      data: { unread_inbox_count: 2, active_cohort_count: 1, flagged_today_count: 0 },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = await render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-screen')).toBeTruthy();
    expect(getByTestId('coach-community-home-inbox-card')).toBeTruthy();
  });

  it('Inbox renders with aggregated rows across cohorts', async () => {
    mockState.inbox = {
      data: {
        items: [
          inboxItem(),
          inboxItem({
            id: '22222222-2222-2222-2222-222222222222',
            cohort_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            cohort_name: 'Autumn block',
            client_name: 'Ravi Patel',
          }),
        ],
        next_cursor: null,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, getByText } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-screen')).toBeTruthy();
    // Mixed cohorts present.
    expect(getByText('Spring block')).toBeTruthy();
    expect(getByText('Autumn block')).toBeTruthy();
  });

  it('Cohorts renders with a row', async () => {
    mockState.cohorts = {
      data: [cohort()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = await render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-cohort-row-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ).toBeTruthy();
  });

  it('Cohort detail renders with a member', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cohortName: 'Spring block' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-member-row-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBeTruthy();
  });

  it('Moderation renders with a flagged row', async () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = await render(<CoachCommunityModerationScreen />);
    expect(getByTestId('coach-community-moderation-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-flagged-row-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    ).toBeTruthy();
  });

  it('Post detail renders the post, author label, and reply thread', async () => {
    mockRouteParams.current = { postId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' };
    mockState.postDetail = {
      data: { post: post(), comments: [comment()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = await render(<CoachCommunityPostDetailScreen />);
    expect(getByTestId('coach-community-post-detail-screen')).toBeTruthy();
    expect(getByText('Form check thread')).toBeTruthy();
    expect(getByText('Filming my squat today.')).toBeTruthy();
    expect(
      getByTestId('coach-community-post-comment-aaaa1111-aaaa-1111-aaaa-111111111111'),
    ).toBeTruthy();
    // Opened outside the moderation queue -> no flagged badge.
    expect(getByText('1 reply')).toBeTruthy();
  });

  it('Post detail shows the flagged badge when opened from moderation', async () => {
    mockRouteParams.current = {
      postId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      flagged: true,
    };
    mockState.postDetail = {
      data: { post: post(), comments: [] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = await render(<CoachCommunityPostDetailScreen />);
    expect(getByTestId('coach-community-post-detail-flagged-badge')).toBeTruthy();
    expect(getByText('No replies yet')).toBeTruthy();
  });
});

describe('FACE + VOICE contract — RomanAvatar + BACKEND-PAYLOAD copy on every empty state', () => {
  it('Home empty: neutral avatar + payload copy, avatar above text', async () => {
    mockState.dashboard = {
      data: { unread_inbox_count: 0, active_cohort_count: 0, flagged_today_count: 0 },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText, toJSON } = await render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-empty')).toBeTruthy();
    expect(getByTestId('coach-community-home-empty-avatar')).toBeTruthy();
    // The screen renders the BACKEND payload text, never a local constant.
    expect(getByText('TEST_EMPTY_HOME_COPY')).toBeTruthy();
    // Layout: the avatar renders ABOVE the copy. We assert source order by
    // serialising the rendered tree and confirming the avatar's testID appears
    // before the payload copy string. (Comparing host-node fibers directly is
    // brittle — react-test-renderer's internal Maps throw on identity checks —
    // so we compare positions in the serialised tree instead.) FIN-868: the quiet
    // Home pulls to refresh, so its RefreshControl element (circular) is left out.
    const serialised = JSON.stringify(toJSON(), (key, value) =>
      key === 'refreshControl' ? undefined : value,
    );
    const avatarIdx = serialised.indexOf('coach-community-home-empty-avatar');
    const copyIdx = serialised.indexOf('TEST_EMPTY_HOME_COPY');
    expect(avatarIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeGreaterThan(-1);
    expect(avatarIdx).toBeLessThan(copyIdx);
  });

  it('Inbox empty: neutral avatar + payload copy', async () => {
    const { getByTestId, getByText } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-empty-avatar')).toBeTruthy();
    expect(getByText('TEST_EMPTY_INBOX_COPY')).toBeTruthy();
  });

  it('Cohorts empty: neutral avatar + payload copy', async () => {
    const { getByTestId, getByText } = await render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-empty-avatar')).toBeTruthy();
    expect(getByText('TEST_EMPTY_COHORTS_COPY')).toBeTruthy();
  });

  it('Cohort detail empty members: neutral avatar + payload copy', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort({ member_count: 0 }), members: [] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = await render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-empty-avatar')).toBeTruthy();
    expect(getByText('TEST_EMPTY_MEMBERS_COPY')).toBeTruthy();
  });

  it('Moderation empty (celebratory): smile avatar + payload copy', async () => {
    const { getByTestId, getByText } = await render(<CoachCommunityModerationScreen />);
    const avatar = getByTestId('coach-community-moderation-empty-avatar');
    expect(avatar).toBeTruthy();
    // The smile crop (from the payload) announces the celebratory variant.
    expect(avatar.props.accessibilityLabel).toBe('Roman, pleased');
    expect(getByText('TEST_EMPTY_MODERATION_COPY')).toBeTruthy();
  });
});

describe('Empty-state PAYLOAD is stateful — loading + error branches (BLOCKER 1/2)', () => {
  it('Home: payload still loading on a quiet dashboard renders a spinner, NOT Roman copy', async () => {
    // Primary data is a genuinely-empty success, but the voice-policy payload
    // is still in flight. The screen must show the non-Roman loading branch,
    // never the calm empty copy.
    mockState.dashboard = {
      data: { unread_inbox_count: 0, active_cohort_count: 0, flagged_today_count: 0 },
      isLoading: false,
      isError: false,
    };
    mockEmptyResultOverride.current = {
      coach_community_home_empty: { status: 'loading' },
    };
    const { getByTestId, queryByText, queryByTestId } = await render(
      <CoachCommunityHomeScreen />,
    );
    expect(getByTestId('coach-community-home-empty-loading')).toBeTruthy();
    // No Roman face and no Roman copy while the policy loads.
    expect(queryByTestId('coach-community-home-empty-avatar')).toBeNull();
    expect(queryByText('TEST_EMPTY_HOME_COPY')).toBeNull();
  });

  it('Cohorts: a CONTRACT failure (200 missing surface) renders CoachErrorState, NOT Roman copy', async () => {
    const retry = jest.fn();
    mockState.cohorts = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
    mockEmptyResultOverride.current = {
      coach_community_cohorts_empty: { status: 'error', kind: 'contract', retry },
    };
    const { getByTestId, queryByText } = await render(<CoachCommunityCohortsScreen />);
    // The payload-error branch renders an honest error, never the empty copy.
    expect(getByTestId('coach-community-cohorts-empty-payload-error')).toBeTruthy();
    expect(queryByText('TEST_EMPTY_COHORTS_COPY')).toBeNull();
    // Retrying re-runs the policy fetch.
    await fireEvent.press(getByTestId('coach-community-cohorts-empty-payload-error-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('Moderation: a NETWORK payload failure renders CoachErrorState, NOT the celebratory empty copy', async () => {
    const retry = jest.fn();
    mockState.flagged = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
    mockEmptyResultOverride.current = {
      coach_community_moderation_empty: { status: 'error', kind: 'network', retry },
    };
    const { getByTestId, queryByText } = await render(<CoachCommunityModerationScreen />);
    expect(getByTestId('coach-community-moderation-empty-payload-error')).toBeTruthy();
    expect(queryByText('TEST_EMPTY_MODERATION_COPY')).toBeNull();
  });
});

describe('UX P0.2 — error branch is distinct from the empty state (no masquerade)', () => {
  it('Home load error renders CoachErrorState, NOT the empty copy', async () => {
    mockState.dashboard = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText } = await render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-error')).toBeTruthy();
    expect(getByTestId('coach-community-home-error-retry')).toBeTruthy();
    // The calm empty copy must NOT appear on an error.
    expect(queryByText('TEST_EMPTY_HOME_COPY')).toBeNull();
  });

  it('Inbox load error renders CoachErrorState, NOT the empty copy', async () => {
    mockState.inbox = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-error')).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_INBOX_COPY')).toBeNull();
  });

  it('Cohorts load error renders CoachErrorState, NOT the empty copy', async () => {
    mockState.cohorts = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = await render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-error')).toBeTruthy();
    expect(queryByTestId('coach-community-cohorts-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_COHORTS_COPY')).toBeNull();
  });

  it('Cohort detail load error renders CoachErrorState, NOT the empty copy', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-error')).toBeTruthy();
    expect(queryByTestId('coach-community-cohort-detail-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_MEMBERS_COPY')).toBeNull();
    expect(queryByText(/ members$/)).toBeNull(); // no "0 members" while the count is unknown
  });

  it('Moderation load error renders CoachErrorState, NOT the celebratory empty copy', async () => {
    mockState.flagged = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = await render(<CoachCommunityModerationScreen />);
    expect(getByTestId('coach-community-moderation-error')).toBeTruthy();
    expect(queryByTestId('coach-community-moderation-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_MODERATION_COPY')).toBeNull();
  });

  it('the error retry button re-runs the failed query', async () => {
    const refetch = jest.fn();
    mockState.inbox = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch };
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    await fireEvent.press(getByTestId('coach-community-inbox-error-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('Coach mutations — create / invite / remove / ack / hide', () => {
  it('creates a cohort with the typed name', async () => {
    const { getByTestId } = await render(<CoachCommunityCohortsScreen />);
    await fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    await fireEvent.changeText(
      getByTestId('coach-community-cohorts-name-input'),
      'Winter cut',
    );
    await fireEvent.press(getByTestId('coach-community-cohorts-modal-submit'));
    expect(mockCreateMutate).toHaveBeenCalledWith(
      { name: 'Winter cut' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('a failed create says why, in the shared community words (FIN-868R5 LS-4)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = await render(<CoachCommunityCohortsScreen />);
    await fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    await fireEvent.changeText(getByTestId('coach-community-cohorts-name-input'), 'Winter cut');
    await fireEvent.press(getByTestId('coach-community-cohorts-modal-submit'));
    const opts = mockCreateMutate.mock.calls[0][1] as { onError?: (e: unknown) => void };
    await act(async () => opts.onError?.({ isAxiosError: true }));
    expect(alertSpy).toHaveBeenCalledWith(
      'Action not applied',
      'You appear to be offline. Check your connection, then try again.',
    );
    alertSpy.mockRestore();
  });

  it('does not create a cohort with an empty name', async () => {
    const { getByTestId } = await render(<CoachCommunityCohortsScreen />);
    await fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    await fireEvent.press(getByTestId('coach-community-cohorts-modal-submit'));
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it('invites a client by email', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    await fireEvent.press(getByTestId('coach-community-cohort-detail-invite'));
    await fireEvent.changeText(
      getByTestId('coach-community-cohort-detail-email-input'),
      'new@example.com',
    );
    await fireEvent.press(getByTestId('coach-community-cohort-detail-invite-submit'));
    expect(mockInviteMutate).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // A failed invite says so; an unknown email gets its own line.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const notFound = { isAxiosError: true, response: { status: 404, data: { code: 'community.cohort.user_not_found' } } };
    await act(async () => mockInviteMutate.mock.calls[0][1].onError(notFound));
    expect(alertSpy).toHaveBeenLastCalledWith(
      'Action not applied',
      'No client of yours has that email. Check it and try again.',
    );
    await act(async () => mockInviteMutate.mock.calls[0][1].onError({ isAxiosError: true }));
    expect(alertSpy.mock.calls[1][0]).toBe('Action not applied');
    expect(alertSpy.mock.calls[1][1]).not.toMatch(/that email/);
    alertSpy.mockRestore();
  });

  it('a person the space shows from its audience (no saved row) has no Remove menu', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = { data: { cohort: cohort(), members: [member({ id: null })] }, isLoading: false, isError: false };
    const { queryByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    expect(queryByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')).toBeNull();
  });

  it('does not invite with an invalid email', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    await fireEvent.press(getByTestId('coach-community-cohort-detail-invite'));
    await fireEvent.changeText(
      getByTestId('coach-community-cohort-detail-email-input'),
      'not-an-email',
    );
    await fireEvent.press(getByTestId('coach-community-cohort-detail-invite-submit'));
    expect(mockInviteMutate).not.toHaveBeenCalled();
  });

  it('removes a client only after the kebab overflow AND confirmation (UX P1.1)', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, queryByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    // Remove is NOT a visible button on the row — only the kebab overflow is.
    expect(
      queryByTestId('coach-community-member-remove-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBeNull();
    expect(
      getByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBeTruthy();
    // Open the overflow sheet, then choose Remove from cohort.
    await fireEvent.press(
      getByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );
    await fireEvent.press(getByTestId('coach-community-member-menu-remove'));
    // Confirmation modal is now shown; mutation has NOT fired yet.
    expect(
      queryByTestId('coach-community-cohort-detail-remove-confirm-confirm'),
    ).toBeTruthy();
    expect(mockRemoveMutate).not.toHaveBeenCalled();
    // Confirm fires the DELETE.
    await fireEvent.press(
      getByTestId('coach-community-cohort-detail-remove-confirm-confirm'),
    );
    expect(mockRemoveMutate).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('cancelling the remove confirmation fires no DELETE', async () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    await fireEvent.press(
      getByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );
    await fireEvent.press(getByTestId('coach-community-member-menu-remove'));
    await fireEvent.press(getByTestId('coach-community-cohort-detail-remove-confirm-cancel'));
    expect(mockRemoveMutate).not.toHaveBeenCalled();
  });

  it('an inbox row has no dismiss action: the server has no route for one', async () => {
    // An item leaves the inbox when the coach replies in that space; there is
    // no Ack button, Select mode or long-press any more.
    mockState.inbox = {
      data: { items: [inboxItem()], next_cursor: null },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { queryByTestId, getByTestId, queryByText } = await render(
      <CoachCommunityInboxScreen />,
    );
    const row = getByTestId('coach-community-inbox-row-11111111-1111-1111-1111-111111111111');
    expect(row.props.onLongPress).toBeUndefined();
    expect(
      queryByTestId('coach-community-inbox-ack-11111111-1111-1111-1111-111111111111'),
    ).toBeNull();
    expect(queryByTestId('coach-community-inbox-select-toggle')).toBeNull();
    expect(queryByText('Ack')).toBeNull();
  });

  it('hides a flagged post only after confirmation', async () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, queryByTestId } = await render(<CoachCommunityModerationScreen />);
    await fireEvent.press(
      getByTestId('coach-community-flagged-hide-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    expect(
      queryByTestId('coach-community-moderation-hide-confirm-confirm'),
    ).toBeTruthy();
    expect(mockHideMutate).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-confirm'));
    expect(mockHideMutate).toHaveBeenCalledWith(
      {
        item: expect.objectContaining({
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          target_type: 'post',
        }),
        action: 'hide',
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onSettled: expect.any(Function),
      }),
    );
  });

  it.each(['warn', 'ban', 'dismiss'] as const)(
    '%s routes through the confirmation and sends that action',
    async (action) => {
      mockState.flagged = {
        data: [flaggedItem()],
        isLoading: false,
        isError: false,
        isRefetching: false,
        refetch: jest.fn(),
      };
      const { getByTestId } = await render(<CoachCommunityModerationScreen />);
      await fireEvent.press(
        getByTestId(`coach-community-flagged-${action}-cccccccc-cccc-cccc-cccc-cccccccccccc`),
      );
      expect(mockHideMutate).not.toHaveBeenCalled();
      await fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-confirm'));
      expect(mockHideMutate).toHaveBeenCalledWith(
        { item: expect.objectContaining({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }), action },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    },
  );

  it.each([
    ['warn', true, 'Warning saved. The member reads it in Community safety in the app.'],
    ['hide', true, 'Hidden. The member can read why in Community safety in the app.'],
    ['ban', true, 'Member removed. They can read why in Community safety in the app.'],
    [
      'warn',
      false,
      'The report is closed, but the warning was not saved for the member. Message them directly with the warning.',
    ],
  ] as const)(
    'B-314-6: %s with a stored notice = %s says only what the backend did',
    async (action, stored, copy) => {
      mockState.flagged = {
        data: [flaggedItem()],
        isLoading: false,
        isError: false,
        isRefetching: false,
        refetch: jest.fn(),
      };
      const { getByTestId, findByText, queryByText } = await render(
        <CoachCommunityModerationScreen />,
      );
      await fireEvent.press(
        getByTestId(`coach-community-flagged-${action}-cccccccc-cccc-cccc-cccc-cccccccccccc`),
      );
      await fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-confirm'));
      const opts = mockHideMutate.mock.calls[0][1] as {
        onSuccess: (o: unknown) => void;
      };
      await act(async () => {
        opts.onSuccess({ memberNotice: { stored, push: stored ? 'attempted' : 'not_sent' } });
      });
      expect(await findByText(copy)).toBeTruthy();
      expect(queryByText('Warning sent.')).toBeNull();
    },
  );

  it('cancelling the hide confirmation fires no mutation', async () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = await render(<CoachCommunityModerationScreen />);
    await fireEvent.press(
      getByTestId('coach-community-flagged-hide-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    await fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-cancel'));
    expect(mockHideMutate).not.toHaveBeenCalled();
  });

  it('exposes no Approve action (the no-network stub was removed — G10.2 Option A)', async () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { queryByTestId } = await render(<CoachCommunityModerationScreen />);
    expect(
      queryByTestId('coach-community-flagged-approve-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    ).toBeNull();
  });

  it('a flagged post row taps through to the post-detail surface', async () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = await render(<CoachCommunityModerationScreen />);
    await fireEvent.press(
      getByTestId('coach-community-flagged-content-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityPostDetail', {
      postId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      flagged: true,
    });
  });

  it('a reported voice note shows a player, the 24-hour respond-by and voice-note copy', async () => {
    mockState.flagged = {
      data: [
        flaggedItem({
          target_type: 'voice_note',
          content: 'Voice note, 0:42',
          author_name: 'Bob',
          media: {
            kind: 'voice_note',
            url: 'https://storage.example.test/signed',
            duration_ms: 42000,
            mime_type: 'audio/mp4',
          },
          removed: false,
          respond_by: new Date(Date.now() + 5 * 3_600_000 - 60_000).toISOString(),
          overdue: false,
        }),
      ],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, getByText } = await render(<CoachCommunityModerationScreen />);
    const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    expect(getByTestId(`coach-community-flagged-player-${id}`)).toBeTruthy();
    expect(getByTestId(`coach-community-flagged-due-${id}`).props.children).toBe(
      'Review within 5h',
    );
    expect(getByText('Spring block · voice note · Spam or scams')).toBeTruthy();
    // Opening a decision names the voice note, not a raw enum.
    await fireEvent.press(getByTestId(`coach-community-flagged-hide-${id}`));
    expect(getByText(/Hide this voice note from Bob\?/)).toBeTruthy();
  });

  it('a reported win and an overdue report read plainly; a removed voice note has no player', async () => {
    mockState.flagged = {
      data: [
        flaggedItem({
          id: 'cccccccc-cccc-cccc-cccc-ccccccccccc1',
          target_type: 'win',
          content: 'Best week',
          respond_by: new Date(Date.now() - 60_000).toISOString(),
          overdue: true,
        }),
        flaggedItem({
          id: 'cccccccc-cccc-cccc-cccc-ccccccccccc2',
          target_type: 'voice_note',
          content: 'Removed',
          media: null,
          removed: true,
        }),
      ],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, getByText, queryByTestId } = await render(
      <CoachCommunityModerationScreen />,
    );
    expect(getByText('Spring block · win · Spam or scams')).toBeTruthy();
    expect(
      getByTestId('coach-community-flagged-due-cccccccc-cccc-cccc-cccc-ccccccccccc1').props
        .children,
    ).toBe('Past 24 hours, review now');
    expect(
      queryByTestId('coach-community-flagged-player-cccccccc-cccc-cccc-cccc-ccccccccccc2'),
    ).toBeNull();
  });
});

describe('Home stat cards route into the matching surfaces', () => {
  beforeEach(() => {
    mockState.dashboard = {
      data: { unread_inbox_count: 4, active_cohort_count: 2, flagged_today_count: 1 },
      isLoading: false,
      isError: false,
    };
  });

  it('inbox card -> Inbox', async () => {
    const { getByTestId } = await render(<CoachCommunityHomeScreen />);
    await fireEvent.press(getByTestId('coach-community-home-inbox-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityInbox');
  });

  it('cohorts card -> Cohorts', async () => {
    const { getByTestId } = await render(<CoachCommunityHomeScreen />);
    await fireEvent.press(getByTestId('coach-community-home-cohorts-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohorts');
  });

  it('moderation card -> Moderation', async () => {
    const { getByTestId } = await render(<CoachCommunityHomeScreen />);
    await fireEvent.press(getByTestId('coach-community-home-moderation-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityModeration');
  });
});

describe('List states + interactions — loading, refresh, navigation', () => {
  it('Inbox shows a loading indicator while fetching', async () => {
    mockState.inbox = { data: undefined, isLoading: true, isError: false };
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-loading')).toBeTruthy();
  });

  it('Cohorts shows a loading indicator while fetching', async () => {
    mockState.cohorts = { data: undefined, isLoading: true, isError: false };
    const { getByTestId } = await render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-loading')).toBeTruthy();
  });

  it('Cohorts row tap navigates to the cohort detail with its id and name', async () => {
    mockState.cohorts = {
      data: [cohort()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = await render(<CoachCommunityCohortsScreen />);
    await fireEvent.press(
      getByTestId('coach-community-cohort-row-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    );
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohortDetail', {
      cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      cohortName: 'Spring block',
    });
  });

  it('Cohorts cancel closes the create modal without a mutation', async () => {
    const { getByTestId, queryByTestId } = await render(<CoachCommunityCohortsScreen />);
    await fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    expect(getByTestId('coach-community-cohorts-modal')).toBeTruthy();
    await fireEvent.press(getByTestId('coach-community-cohorts-modal-cancel'));
    expect(mockCreateMutate).not.toHaveBeenCalled();
    expect(queryByTestId('coach-community-cohorts-name-input')).toBeNull();
  });
});

// ─── v2-2 — Coach ack badges + Mark-acked quick-action (flag ON) ─────────────
//
// The featureFlags mock above pins `communityAcks: true`, so the inbox renders
// the CoachAckBadge per row and a per-row "Mark acked" quick-action. The badge
// state is driven by the `useCoachAckState` mock (keyed by message id) and the
// quick-action fires the mocked `markAcked.mutate`. These three cases cover the
// brief's inbox-integration requirements: badge renders for each state from the
// API, tap "Mark acked" fires the hook, and the SLA chip matches the state.
describe('v2-2 inbox ack integration — badge + Mark-acked quick-action', () => {
  const MID = '11111111-1111-1111-1111-111111111111';

  const ackEnvelope = (
    state: 'none' | 'seen' | 'acked' | 'replied',
    sla: 'within' | 'warning' | 'breached',
  ) => ({
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
  });

  const seedInbox = () => {
    mockState.inbox = {
      data: { items: [inboxItem()], next_cursor: null },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
  };

  it('renders the ack badge per row reflecting the state from the API', async () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('acked', 'within');
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId(`coach-community-inbox-ack-badge-${MID}`)).toBeTruthy();
    // The derived state pill is keyed by the API state.
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-state-acked`),
    ).toBeTruthy();
  });

  it('tapping Mark acked fires the ack-action hook for that message', async () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'within');
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    await fireEvent.press(getByTestId(`coach-community-inbox-mark-acked-${MID}`));
    expect(mockMarkAckedMutate).toHaveBeenCalledTimes(1);
  });

  it('the SLA chip matches the state from the API (breached)', async () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'breached');
    const { getByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    // The breached SLA chip renders; the within/warning chips do not.
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-sla-breached`),
    ).toBeTruthy();
    expect(
      queryByTestId(`coach-community-inbox-ack-badge-${MID}-sla-within`),
    ).toBeNull();
    expect(
      queryByTestId(`coach-community-inbox-ack-badge-${MID}-sla-warning`),
    ).toBeNull();
  });

  it('renders NO badge for the default none + within row (kill the badge wall)', async () => {
    // R1 UX F2: a default/untouched row (state=none + sla=within) carries no
    // redundant chrome — the badge renders null, so its testID is absent.
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('none', 'within');
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(
      queryByTestId(`coach-community-inbox-ack-badge-${MID}`),
    ).toBeNull();
    expect(
      queryByTestId(`coach-community-inbox-ack-badge-${MID}-state-none`),
    ).toBeNull();
  });

  it('shows ONLY the Overdue chip for an untouched but breached row', async () => {
    // R1 UX F2/F3: none + breached surfaces the priority Overdue chip without a
    // redundant "Awaiting coach" state pill.
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('none', 'breached');
    const { getByTestId, getByText, queryByTestId } = await render(
      <CoachCommunityInboxScreen />,
    );
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-sla-breached`),
    ).toBeTruthy();
    expect(getByText('Overdue')).toBeTruthy();
    expect(
      queryByTestId(`coach-community-inbox-ack-badge-${MID}-state-none`),
    ).toBeNull();
  });

  it('uses the unified Acknowledge / Acknowledged vocabulary (UX F5)', async () => {
    seedInbox();
    // Not-yet-acked: the action button reads "Acknowledge".
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'warning');
    const { getByTestId, queryByTestId, getAllByText, queryByText, rerender } = await render(
      <CoachCommunityInboxScreen />,
    );
    const button = getByTestId(`coach-community-inbox-mark-acked-${MID}`);
    expect(button).toHaveTextContent('Acknowledge');
    // The abbreviated "Mark acked"/"Acked" vocabulary is gone everywhere.
    expect(queryByText('Mark acked')).toBeNull();
    expect(queryByText('Acked')).toBeNull();

    // Already acked: the badge says "Acknowledged" once and the button goes
    // (FX4-868 C1: the word never shows twice, no disabled button left).
    mockAckStateByMessage.current[MID] = ackEnvelope('acked', 'within');
    await rerender(<CoachCommunityInboxScreen />);
    expect(queryByTestId(`coach-community-inbox-mark-acked-${MID}`)).toBeNull();
    expect(getAllByText('Acknowledged')).toHaveLength(1);
  });

  it('the row owns the ack accessibility summary, Overdue-first (badge hidden from a11y)', async () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('acked', 'breached');
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    // The row's accessibility label leads with the Overdue cue, then the state.
    const row = getByTestId(`coach-community-inbox-row-${MID}`);
    expect(row.props.accessibilityLabel).toContain('Overdue');
    expect(row.props.accessibilityLabel).toContain('Acknowledged');
    // The badge itself is hidden from the a11y tree (no duplicate announcement).
    const badge = getByTestId(`coach-community-inbox-ack-badge-${MID}`);
    expect(badge.props.accessibilityElementsHidden).toBe(true);
  });

  it('shows a subtle closure confirmation toast on a successful acknowledge (UX F6)', async () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'within');
    // Drive the mutate spy to invoke the per-call onSuccess (the screen passes
    // `onAcknowledged` there) so we can assert the closure moment renders.
    mockMarkAckedMutate.mockImplementation(
      (_vars?: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    await fireEvent.press(getByTestId(`coach-community-inbox-mark-acked-${MID}`));
    expect(
      getByTestId('coach-community-inbox-completion-toast'),
    ).toBeTruthy();
  });

  it('a refused Acknowledge says why; a 409 keeps only its calm inline line (FIN-868R5 LS-4)', async () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'within');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    await fireEvent.press(getByTestId(`coach-community-inbox-mark-acked-${MID}`));
    const opts = mockMarkAckedMutate.mock.calls[0][1] as { onError?: (e: unknown) => void };
    await act(async () => opts.onError?.({ isAxiosError: true, response: { status: 429 } }));
    expect(alertSpy).toHaveBeenCalledWith(
      'Action not applied',
      'You are doing that a little too often. Wait a minute, then try again.',
    );
    mockIsIllegalAckTransition.mockReturnValueOnce(true);
    await act(async () => opts.onError?.({ isAxiosError: true, response: { status: 409 } }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('surfaces an accessible 409 conflict notice when the ack transition is illegal (Code F3)', async () => {
    // The mutation failed with the backend 409 `illegal_transition` code: the
    // message state changed underneath the coach. The hook has already
    // refetched the authoritative ack state (covered by the hook suite); here
    // we assert the SCREEN renders the calm inline notice with its testID and
    // the alert/live-region accessibility props a screen reader announces.
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'within');
    // A real conflict error (kind: 'conflict', the bounded backend code) drives
    // the predicate so we exercise the genuine classification, not a bare stub.
    mockMarkAckedError.current = new CoachCommunityApiError(
      'conflict',
      409,
      'ack transition rejected',
      undefined,
      ACK_ILLEGAL_TRANSITION_CODE,
    );
    mockIsIllegalAckTransition.mockReturnValue(true);

    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    const notice = getByTestId(`coach-community-inbox-ack-conflict-${MID}`);
    expect(notice).toBeTruthy();
    expect(notice).toHaveTextContent('Message state changed — refreshed');
    // The predicate was asked about the conflict error the hook surfaced.
    expect(mockIsIllegalAckTransition).toHaveBeenCalledWith(
      mockMarkAckedError.current,
    );
    // Accessibility: announced as an alert in a polite live region.
    expect(notice.props.accessibilityRole).toBe('alert');
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
  });

  it('renders NO conflict notice when there is no illegal-transition error', async () => {
    // Default path: predicate false, no error -> the inline notice is absent.
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'within');
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(
      queryByTestId(`coach-community-inbox-ack-conflict-${MID}`),
    ).toBeNull();
  });

  it('only message text and photo rows get ack controls; a summary ack shows as done', async () => {
    const POST = '22222222-2222-2222-2222-222222222222';
    const VOICE = '33333333-3333-3333-3333-333333333333';
    const PHOTO = '44444444-4444-4444-4444-444444444444';
    const items = [
      inboxItem({ ack: { state: 'acked', sla_state: 'within' } }),
      inboxItem({ id: POST, type: 'post' }),
      inboxItem({ id: VOICE, kind: 'voice' }),
      inboxItem({ id: PHOTO, kind: 'photo', snippet: 'Photo', ack: { state: 'none', sla_state: 'within' } }),
    ];
    mockState.inbox = { data: { items }, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    // Done: the badge says so and no disabled button is left behind.
    expect(getByTestId(`coach-community-inbox-ack-badge-${MID}-state-acked`)).toBeTruthy();
    expect(queryByTestId(`coach-community-inbox-mark-acked-${MID}`)).toBeNull();
    expect(queryByTestId(`coach-community-inbox-mark-acked-${POST}`)).toBeNull();
    expect(queryByTestId(`coach-community-inbox-mark-acked-${VOICE}`)).toBeNull();
    expect(getByTestId(`coach-community-inbox-mark-acked-${PHOTO}`)).toBeTruthy();
  });

  it('loads the next inbox page at the end of the list, once at a time', async () => {
    const fetchNextPage = jest.fn();
    const base = { data: { items: [inboxItem()] }, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(), fetchNextPage };
    mockState.inbox = { ...base, hasNextPage: true, isFetchingNextPage: false };
    const view = await render(<CoachCommunityInboxScreen />);
    await fireEvent(view.getByTestId('coach-community-inbox-list'), 'endReached');
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    mockState.inbox = { ...base, hasNextPage: true, isFetchingNextPage: true };
    await view.rerender(<CoachCommunityInboxScreen />);
    await fireEvent(view.getByTestId('coach-community-inbox-list'), 'endReached');
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('coach-community-inbox-next-page')).toBeTruthy();
  });
});

describe('FR-868 round 2 — inbox ack fallback, a11y, block, destinations, errors', () => {
  const MID = '11111111-1111-1111-1111-111111111111';
  const BLOCKED = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const inboxWith = (items: unknown[], over: Record<string, unknown> = {}) => {
    mockState.inbox = {
      data: { items, next_cursor: null },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      ...over,
    };
  };

  afterEach(async () => {
    const { useBlockedUsersStore } = jest.requireActual('../../../store/blockedUsersStore');
    await useBlockedUsersStore.getState().reset();
  });

  it('with an empty ack cache, the row summary drives the badge and the label (breached)', async () => {
    inboxWith([inboxItem({ ack: { state: 'none', sla_state: 'breached' } })]);
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-sla-breached`),
    ).toBeTruthy();
    const row = getByTestId(`coach-community-inbox-row-${MID}`);
    expect(row.props.accessibilityLabel).toContain('Overdue');
  });

  it('the Acknowledge control is its own accessible element, outside the row label element', async () => {
    inboxWith([inboxItem({ ack: { state: 'seen', sla_state: 'within' } })]);
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    const row = getByTestId(`coach-community-inbox-row-${MID}`);
    const button = getByTestId(`coach-community-inbox-mark-acked-${MID}`);
    // Walk up from the button: no ancestor may be the accessible row element.
    let node = button.parent;
    while (node) {
      expect(node).not.toBe(row);
      node = node.parent;
    }
    expect(row.props.accessible).toBe(true);
  });

  it('rows from a blocked person never show, and an unblock refetches', async () => {
    const refetch = jest.fn();
    inboxWith(
      [inboxItem(), inboxItem({ id: '22222222-2222-2222-2222-222222222222', client_user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', client_name: 'Lee Park' })],
      { refetch },
    );
    const { useBlockedUsersStore } = jest.requireActual('../../../store/blockedUsersStore');
    await useBlockedUsersStore.getState().hydrate('me');
    await useBlockedUsersStore.getState().block({ id: BLOCKED, displayName: 'Dana Cruz', role: 'client' });
    const view = await render(<CoachCommunityInboxScreen />);
    expect(view.queryByTestId(`coach-community-inbox-row-${MID}`)).toBeNull();
    expect(view.getByTestId('coach-community-inbox-row-22222222-2222-2222-2222-222222222222')).toBeTruthy();
    await act(async () => {
      await useBlockedUsersStore.getState().unblock(BLOCKED);
    });
    expect(refetch).toHaveBeenCalled();
    expect(view.getByTestId(`coach-community-inbox-row-${MID}`)).toBeTruthy();
  });

  it('a post row opens the post detail', async () => {
    inboxWith([inboxItem({ type: 'post', kind: 'text' })]);
    const navigate = jest.fn();
    const { getByTestId } = await render(
      <CoachCommunityInboxScreen navigation={{ navigate } as never} />,
    );
    await fireEvent.press(getByTestId(`coach-community-inbox-row-${MID}`));
    expect(navigate).toHaveBeenCalledWith('CoachCommunityPostDetail', { postId: MID });
  });

  it('a failed refresh keeps the rows and shows the inline card', async () => {
    const refetch = jest.fn();
    inboxWith([inboxItem()], { isError: true, refetch });
    const { getByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId(`coach-community-inbox-row-${MID}`)).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-error')).toBeNull();
    await fireEvent.press(getByTestId('coach-community-inbox-refresh-error-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('offline with nothing cached shows the offline card, not an endless skeleton', async () => {
    mockState.inbox = { data: undefined, isLoading: true, isError: false, fetchStatus: 'paused' };
    const { getByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-offline')).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-loading')).toBeNull();
  });
});

describe('FX4-868 round 4 — offline from the phone, the caught-up page, whole typed rows, photo rows', () => {
  const MID = '11111111-1111-1111-1111-111111111111';
  const POST = '22222222-2222-2222-2222-222222222222';
  const PHOTO = '44444444-4444-4444-4444-444444444444';
  const PHOTO_BARE = '55555555-5555-5555-5555-555555555555';
  // jest.setup.js mocks NetInfo with a settable state.
  const netinfo = jest.requireMock('@react-native-community/netinfo') as {
    __setState: (s: Record<string, unknown>) => void;
  };
  const caughtUpNav = () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: () => true,
    setOptions: jest.fn(),
  });
  afterEach(() => {
    netinfo.__setState({ isConnected: true, isInternetReachable: true });
  });

  it('B1: the phone offline (NetInfo) with nothing loaded shows the offline card, even when the fetch is not paused', async () => {
    netinfo.__setState({ isConnected: false, isInternetReachable: false });
    mockState.inbox = { data: undefined, isLoading: true, isError: false, isRefetching: false, refetch: jest.fn(), fetchStatus: 'fetching' };
    const { findByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(await findByTestId('coach-community-inbox-offline')).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-loading')).toBeNull();
  });

  it('B1: a failed load while the phone is offline says offline, not a generic error', async () => {
    netinfo.__setState({ isConnected: false, isInternetReachable: false });
    mockState.inbox = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn(), fetchStatus: 'idle' };
    const { findByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(await findByTestId('coach-community-inbox-offline')).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-error')).toBeNull();
  });

  it('B2/B4: a clear inbox is the dark caught-up page — title, Roman in his ring above his line, a way back', async () => {
    const nav = caughtUpNav();
    const { getByTestId, getByText, getByRole, toJSON } = await render(
      <CoachCommunityInboxScreen navigation={nav} />,
    );
    expect(getByRole('header', { name: 'Inbox' })).toBeTruthy();
    expect(getByTestId('coach-community-inbox-empty')).toBeTruthy();
    expect(getByTestId('coach-community-inbox-empty-avatar')).toBeTruthy();
    expect(getByText('TEST_EMPTY_INBOX_COPY')).toBeTruthy();
    // The page pulls to refresh: leave its RefreshControl element (circular) out of the dump.
    const serialised = JSON.stringify(toJSON(), (key, value) =>
      key === 'refreshControl' ? undefined : value,
    );
    expect(serialised.indexOf('coach-community-inbox-empty-avatar')).toBeLessThan(
      serialised.indexOf('TEST_EMPTY_INBOX_COPY'),
    );
    // The bar above the dark page turns forest with a bone back arrow.
    expect(nav.setOptions).toHaveBeenLastCalledWith({
      headerStyle: { backgroundColor: '#2C4A36' },
      headerTintColor: '#F7FAF7',
    });
    const back = getByTestId('coach-community-inbox-empty-back');
    expect(back.props.accessibilityLabel).toBe('Back to Community');
    await fireEvent.press(back);
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it('the caught-up page shows no back button when there is nowhere to go back to', async () => {
    const nav = { ...caughtUpNav(), canGoBack: () => false };
    const { getByTestId, queryByTestId } = await render(<CoachCommunityInboxScreen navigation={nav} />);
    expect(getByTestId('coach-community-inbox-empty')).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-empty-back')).toBeNull();
  });

  it("while the voice policy loads, the light page keeps the title and the bone bar, and Roman's line waits", async () => {
    mockEmptyResultOverride.current = { coach_community_inbox_empty: { status: 'loading' } };
    const nav = caughtUpNav();
    const { getByRole, getByTestId, queryByTestId, queryByText } = await render(
      <CoachCommunityInboxScreen navigation={nav} />,
    );
    expect(getByRole('header', { name: 'Inbox' })).toBeTruthy();
    expect(getByTestId('coach-community-inbox-empty-loading')).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-empty-back')).toBeNull();
    expect(queryByText('TEST_EMPTY_INBOX_COPY')).toBeNull();
    expect(nav.setOptions).toHaveBeenLastCalledWith({
      headerStyle: { backgroundColor: '#F7FAF7' },
      headerTintColor: '#1A1A18',
    });
  });

  it('rows on the page keep the bone bar', async () => {
    mockState.inbox = { data: { items: [inboxItem()] }, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
    const nav = caughtUpNav();
    await render(<CoachCommunityInboxScreen navigation={nav} />);
    expect(nav.setOptions).toHaveBeenLastCalledWith({
      headerStyle: { backgroundColor: '#F7FAF7' },
      headerTintColor: '#1A1A18',
    });
  });

  it('B3: a message row shows its whole text; a post row, which opens, clamps to two lines', async () => {
    const LONG =
      'Coach, my knee felt tight on the last two sets of squats today and I stopped early. Should I swap tomorrow for the bike?';
    mockState.inbox = {
      data: {
        items: [
          inboxItem({ snippet: LONG }),
          inboxItem({ id: POST, type: 'post', snippet: 'Post text' }),
        ],
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByText } = await render(<CoachCommunityInboxScreen />);
    expect(getByText(LONG).props.numberOfLines).toBeUndefined();
    expect(getByText('Post text').props.numberOfLines).toBe(2);
  });

  it('a photo row shows its caption, or "Photo" with none, and can be acknowledged', async () => {
    mockState.inbox = {
      data: {
        items: [
          inboxItem({ id: PHOTO, kind: 'photo', snippet: 'New squat best', ack: { state: 'none', sla_state: 'within' } }),
          inboxItem({ id: PHOTO_BARE, kind: 'photo', snippet: 'Photo', ack: { state: 'none', sla_state: 'within' } }),
        ],
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByText, getByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByText('New squat best')).toBeTruthy();
    expect(getByText('Photo')).toBeTruthy();
    expect(getByTestId(`coach-community-inbox-row-${PHOTO_BARE}`).props.accessibilityLabel).toContain(': Photo');
    expect(getByTestId(`coach-community-inbox-mark-acked-${PHOTO}`)).toBeTruthy();
    expect(getByTestId(`coach-community-inbox-mark-acked-${PHOTO_BARE}`)).toBeTruthy();
  });

  it('C1: an acknowledged row says "Acknowledged" once', async () => {
    mockState.inbox = {
      data: { items: [inboxItem({ id: MID, ack: { state: 'acked', sla_state: 'within' } })] },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getAllByText, queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getAllByText('Acknowledged')).toHaveLength(1);
    expect(queryByTestId(`coach-community-inbox-mark-acked-${MID}`)).toBeNull();
  });
});

describe('FX4-868 round 4 — Cohorts and a cohort in K2 Style B (#172-10)', () => {
  const COHORT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('Cohorts draws its serif page title, and loading is labelled skeleton cards', async () => {
    mockState.cohorts = { data: undefined, isLoading: true, isError: false };
    const { getByRole, getByTestId } = await render(<CoachCommunityCohortsScreen />);
    expect(getByRole('header', { name: 'Cohorts' })).toBeTruthy();
    expect(getByTestId('coach-community-cohorts-loading').props.accessibilityLabel).toBe(
      'Loading your cohorts',
    );
  });

  it('Cohorts error is an inline card: its Try again refetches, and the page can be pulled', async () => {
    const refetch = jest.fn();
    mockState.cohorts = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch };
    const { getByTestId, getByText } = await render(<CoachCommunityCohortsScreen />);
    expect(getByText('Could not load your cohorts. Pull to retry.')).toBeTruthy();
    expect(getByTestId('coach-community-cohorts-fab')).toBeTruthy();
    await fireEvent.press(getByTestId('coach-community-cohorts-error-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
    // Pull-to-retry is real: the error card sits in a ScrollView whose RefreshControl refetches.
    const scroll = getByTestId('coach-community-cohorts-error-scroll');
    expect(scroll.props.refreshControl.type).toBe(RefreshControl);
    await scroll.props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('a cohort row carries its filled monogram, hidden from screen readers (the row label says it all)', async () => {
    mockState.cohorts = { data: [cohort({ name: 'Spring block' })], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, getByText } = await render(<CoachCommunityCohortsScreen />);
    const row = getByTestId(`coach-community-cohort-row-${COHORT}`);
    expect(row.props.accessibilityLabel).toMatch(/^Spring block, \d+ members$/);
    expect(getByText('SB')).toBeTruthy();
  });

  it('a cohort draws its name as the serif page title, also while it loads', async () => {
    mockRouteParams.current = { cohortId: COHORT, cohortName: 'Spring block' };
    mockState.cohortDetail = { data: undefined, isLoading: true, isError: false };
    const { getByRole, getByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    expect(getByRole('header', { name: 'Spring block' })).toBeTruthy();
    expect(getByTestId('coach-community-cohort-detail-loading').props.accessibilityLabel).toBe(
      'Loading this cohort',
    );
  });

  it('a cohort error is an inline card whose Try again refetches', async () => {
    const refetch = jest.fn();
    mockRouteParams.current = { cohortId: COHORT };
    mockState.cohortDetail = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch };
    const { getByTestId, getByText } = await render(<CoachCommunityCohortDetailScreen />);
    expect(getByText('Could not load this cohort. Pull back and open it again.')).toBeTruthy();
    await fireEvent.press(getByTestId('coach-community-cohort-detail-error-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
    const scroll = getByTestId('coach-community-cohort-detail-error-scroll');
    expect(scroll.props.refreshControl.type).toBe(RefreshControl);
    await scroll.props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});

describe('FX4-868 round 4 — pull to retry on the empty pages, the member sheet at the foot, one inline card', () => {
  const COHORT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('the empty inbox whose words failed pulls to retry them and the inbox ("Pull to retry" is true)', async () => {
    const refetch = jest.fn();
    const retry = jest.fn();
    mockState.inbox = { data: { items: [], next_cursor: null }, isLoading: false, isError: false, isRefetching: false, refetch };
    mockEmptyResultOverride.current = {
      coach_community_inbox_empty: { status: 'error', kind: 'network', retry },
    };
    const { getByTestId, getByText } = await render(<CoachCommunityInboxScreen />);
    expect(getByText('Could not reach the server. Pull to retry.')).toBeTruthy();
    const scroll = getByTestId('coach-community-inbox-empty-scroll');
    expect(scroll.props.refreshControl.type).toBe(RefreshControl);
    await scroll.props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('the dark caught-up page pulls to refresh the inbox, with a bone spinner', async () => {
    const refetch = jest.fn();
    mockState.inbox = { data: { items: [], next_cursor: null }, isLoading: false, isError: false, isRefetching: false, refetch };
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-empty-avatar')).toBeTruthy();
    const control = getByTestId('coach-community-inbox-empty-scroll').props.refreshControl;
    expect(control.props.tintColor).toBe(colors.bone);
    await control.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('Cohorts with no cohorts and failed words pulls to retry both', async () => {
    const refetch = jest.fn();
    const retry = jest.fn();
    mockState.cohorts = { data: [], isLoading: false, isError: false, isRefetching: false, refetch };
    mockEmptyResultOverride.current = {
      coach_community_cohorts_empty: { status: 'error', kind: 'network', retry },
    };
    const { getByTestId } = await render(<CoachCommunityCohortsScreen />);
    await getByTestId('coach-community-cohorts-empty-scroll').props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a cohort with no members and failed words pulls to retry both', async () => {
    const refetch = jest.fn();
    const retry = jest.fn();
    mockRouteParams.current = { cohortId: COHORT };
    mockState.cohortDetail = { data: { cohort: cohort(), members: [] }, isLoading: false, isError: false, isRefetching: false, refetch };
    mockEmptyResultOverride.current = {
      coach_community_cohort_members_empty: { status: 'error', kind: 'network', retry },
    };
    const { getByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    await getByTestId('coach-community-cohort-detail-empty-scroll').props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('the member sheet sits at the foot over a full-screen scrim, and the scrim closes it', async () => {
    mockRouteParams.current = { cohortId: COHORT };
    mockState.cohortDetail = { data: { cohort: cohort(), members: [member()] }, isLoading: false, isError: false };
    const { getByTestId, queryByTestId } = await render(<CoachCommunityCohortDetailScreen />);
    await fireEvent.press(getByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));
    const scrim = getByTestId('coach-community-member-menu-dismiss');
    expect(StyleSheet.flatten(scrim.props.style)).toMatchObject({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
    expect(StyleSheet.flatten(getByTestId('coach-community-member-menu-root').props.style)).toMatchObject({ flex: 1, justifyContent: 'flex-end' });
    expect(getByTestId('coach-community-member-menu-remove')).toBeTruthy();
    await fireEvent.press(scrim);
    expect(queryByTestId('coach-community-member-menu-remove')).toBeNull();
  });

  it('a long member name may take two lines and the email reads in full (130% text), never cut', async () => {
    mockRouteParams.current = { cohortId: COHORT };
    const email = 'morgan.featherstonehaugh.training@example.com';
    mockState.cohortDetail = { data: { cohort: cohort(), members: [member({ name: 'Morgan Featherstonehaugh', email })] }, isLoading: false, isError: false };
    const { getByText } = await render(<CoachCommunityCohortDetailScreen />);
    expect(getByText('Morgan Featherstonehaugh').props.numberOfLines).toBe(2);
    expect(getByText(`client · ${email}`).props.numberOfLines).toBeUndefined();
  });

  it('the Cohorts and cohort error cards use the inbox card: an outlined forest Try again, so the page keeps one filled button', async () => {
    mockState.cohorts = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const cohortsView = await render(<CoachCommunityCohortsScreen />);
    const cohortsRetry = StyleSheet.flatten(cohortsView.getByTestId('coach-community-cohorts-error-retry').props.style);
    expect(cohortsRetry).toMatchObject({ borderColor: colors.forest, borderWidth: 1.5 });
    expect(cohortsRetry.backgroundColor).toBeUndefined();
    expect(cohortsView.getByRole('alert')).toBeTruthy();
    await cohortsView.unmount();

    mockRouteParams.current = { cohortId: COHORT };
    mockState.cohortDetail = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const detailView = await render(<CoachCommunityCohortDetailScreen />);
    const detailRetry = StyleSheet.flatten(detailView.getByTestId('coach-community-cohort-detail-error-retry').props.style);
    expect(detailRetry).toMatchObject({ borderColor: colors.forest, borderWidth: 1.5 });
    expect(detailRetry.backgroundColor).toBeUndefined();
  });
});
