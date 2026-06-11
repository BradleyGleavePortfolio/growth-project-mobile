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
import { render, fireEvent } from '@testing-library/react-native';
import type {
  CoachEmptyStateSurfaceKey,
  RomanCopyPayload,
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
  inbox: { data: { items: [], next_before: null }, isLoading: false, isError: false },
  cohorts: { data: [], isLoading: false, isError: false },
  cohortDetail: { data: undefined, isLoading: false, isError: false },
  flagged: { data: [], isLoading: false, isError: false },
  postDetail: { data: undefined, isLoading: false, isError: false },
};
const mockAckMutate = jest.fn();
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
    useAckInboxItem: () => ({ mutate: mockAckMutate, isPending: false }),
    useCreateCohort: () => ({ mutate: mockCreateMutate, isPending: false }),
    useInviteMember: () => ({ mutate: mockInviteMutate, isPending: false }),
    useRemoveMember: () => ({ mutate: mockRemoveMutate, isPending: false }),
    useHideFlagged: () => ({ mutate: mockHideMutate, isPending: false }),
  };
});

// v2-2: ack-action hook. markAcked.mutate is the spy the Mark-acked
// quick-action fires; the other two are inert for these screen tests.
jest.mock('../../../hooks/useCoachAckActions', () => ({
  useCoachAckActions: () => ({
    markSeen: { mutate: jest.fn(), isPending: false },
    markAcked: { mutate: mockMarkAckedMutate, isPending: false },
    markReplied: { mutate: jest.fn(), isPending: false },
  }),
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
    isMutating: () => 0,
  }),
  // v2-2 (R1 fixer, M-P1d): the inbox subscribes to in-flight ack mutations so
  // its reconcile effect can avoid clobbering an optimistic transition. With no
  // mutations in these mocked render tests it is always zero.
  useIsMutating: () => 0,
}));

import CoachCommunityHomeScreen from '../CoachCommunityHomeScreen';
import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';
import CoachCommunityCohortsScreen from '../CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../CoachCommunityCohortDetailScreen';
import CoachCommunityModerationScreen from '../CoachCommunityModerationScreen';
import CoachCommunityPostDetailScreen from '../CoachCommunityPostDetailScreen';

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
  mockAckMutate.mockReset();
  mockCreateMutate.mockReset();
  mockInviteMutate.mockReset();
  mockRemoveMutate.mockReset();
  mockHideMutate.mockReset();
  mockMarkAckedMutate.mockReset();
  mockAckStateByMessage.current = {};
  // Reset to default quiet/empty state per suite.
  mockState.dashboard = { data: undefined, isLoading: false, isError: false };
  mockState.inbox = { data: { items: [], next_before: null }, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.cohorts = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.cohortDetail = { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.flagged = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockState.postDetail = { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
  mockEmptyResultOverride.current = {};
});

describe('Coach Community screens — render with flag ON, mocked API', () => {
  it('Home renders', () => {
    mockState.dashboard = {
      data: { unread_inbox_count: 2, active_cohort_count: 1, flagged_today_count: 0 },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-screen')).toBeTruthy();
    expect(getByTestId('coach-community-home-inbox-card')).toBeTruthy();
  });

  it('Inbox renders with aggregated rows across cohorts', () => {
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
        next_before: null,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, getByText } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-screen')).toBeTruthy();
    // Mixed cohorts present.
    expect(getByText('Spring block')).toBeTruthy();
    expect(getByText('Autumn block')).toBeTruthy();
  });

  it('Cohorts renders with a row', () => {
    mockState.cohorts = {
      data: [cohort()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-cohort-row-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ).toBeTruthy();
  });

  it('Cohort detail renders with a member', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cohortName: 'Spring block' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-member-row-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBeTruthy();
  });

  it('Moderation renders with a flagged row', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityModerationScreen />);
    expect(getByTestId('coach-community-moderation-screen')).toBeTruthy();
    expect(
      getByTestId('coach-community-flagged-row-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    ).toBeTruthy();
  });

  it('Post detail renders the post, author label, and reply thread', () => {
    mockRouteParams.current = { postId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' };
    mockState.postDetail = {
      data: { post: post(), comments: [comment()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = render(<CoachCommunityPostDetailScreen />);
    expect(getByTestId('coach-community-post-detail-screen')).toBeTruthy();
    expect(getByText('Form check thread')).toBeTruthy();
    expect(getByText('Filming my squat today.')).toBeTruthy();
    expect(
      getByTestId('coach-community-post-comment-aaaa1111-aaaa-1111-aaaa-111111111111'),
    ).toBeTruthy();
    // Opened outside the moderation queue -> no flagged badge.
    expect(getByText('1 reply')).toBeTruthy();
  });

  it('Post detail shows the flagged badge when opened from moderation', () => {
    mockRouteParams.current = {
      postId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      flagged: true,
    };
    mockState.postDetail = {
      data: { post: post(), comments: [] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = render(<CoachCommunityPostDetailScreen />);
    expect(getByTestId('coach-community-post-detail-flagged-badge')).toBeTruthy();
    expect(getByText('No replies yet')).toBeTruthy();
  });
});

describe('FACE + VOICE contract — RomanAvatar + BACKEND-PAYLOAD copy on every empty state', () => {
  it('Home empty: neutral avatar + payload copy, avatar above text', () => {
    mockState.dashboard = {
      data: { unread_inbox_count: 0, active_cohort_count: 0, flagged_today_count: 0 },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText, toJSON } = render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-empty')).toBeTruthy();
    expect(getByTestId('coach-community-home-empty-avatar')).toBeTruthy();
    // The screen renders the BACKEND payload text, never a local constant.
    expect(getByText('TEST_EMPTY_HOME_COPY')).toBeTruthy();
    // Layout: the avatar renders ABOVE the copy. We assert source order by
    // serialising the rendered tree and confirming the avatar's testID appears
    // before the payload copy string. (Comparing host-node fibers directly is
    // brittle — react-test-renderer's internal Maps throw on identity checks —
    // so we compare positions in the serialised tree instead.)
    const serialised = JSON.stringify(toJSON());
    const avatarIdx = serialised.indexOf('coach-community-home-empty-avatar');
    const copyIdx = serialised.indexOf('TEST_EMPTY_HOME_COPY');
    expect(avatarIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeGreaterThan(-1);
    expect(avatarIdx).toBeLessThan(copyIdx);
  });

  it('Inbox empty: neutral avatar + payload copy', () => {
    const { getByTestId, getByText } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-empty-avatar')).toBeTruthy();
    expect(getByText('TEST_EMPTY_INBOX_COPY')).toBeTruthy();
  });

  it('Cohorts empty: neutral avatar + payload copy', () => {
    const { getByTestId, getByText } = render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-empty-avatar')).toBeTruthy();
    expect(getByText('TEST_EMPTY_COHORTS_COPY')).toBeTruthy();
  });

  it('Cohort detail empty members: neutral avatar + payload copy', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort({ member_count: 0 }), members: [] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-empty-avatar')).toBeTruthy();
    expect(getByText('TEST_EMPTY_MEMBERS_COPY')).toBeTruthy();
  });

  it('Moderation empty (celebratory): smile avatar + payload copy', () => {
    const { getByTestId, getByText } = render(<CoachCommunityModerationScreen />);
    const avatar = getByTestId('coach-community-moderation-empty-avatar');
    expect(avatar).toBeTruthy();
    // The smile crop (from the payload) announces the celebratory variant.
    expect(avatar.props.accessibilityLabel).toBe('Roman, pleased');
    expect(getByText('TEST_EMPTY_MODERATION_COPY')).toBeTruthy();
  });
});

describe('Empty-state PAYLOAD is stateful — loading + error branches (BLOCKER 1/2)', () => {
  it('Home: payload still loading on a quiet dashboard renders a spinner, NOT Roman copy', () => {
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
    const { getByTestId, queryByText, queryByTestId } = render(
      <CoachCommunityHomeScreen />,
    );
    expect(getByTestId('coach-community-home-empty-loading')).toBeTruthy();
    // No Roman face and no Roman copy while the policy loads.
    expect(queryByTestId('coach-community-home-empty-avatar')).toBeNull();
    expect(queryByText('TEST_EMPTY_HOME_COPY')).toBeNull();
  });

  it('Cohorts: a CONTRACT failure (200 missing surface) renders CoachErrorState, NOT Roman copy', () => {
    const retry = jest.fn();
    mockState.cohorts = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
    mockEmptyResultOverride.current = {
      coach_community_cohorts_empty: { status: 'error', kind: 'contract', retry },
    };
    const { getByTestId, queryByText } = render(<CoachCommunityCohortsScreen />);
    // The payload-error branch renders an honest error, never the empty copy.
    expect(getByTestId('coach-community-cohorts-empty-payload-error')).toBeTruthy();
    expect(queryByText('TEST_EMPTY_COHORTS_COPY')).toBeNull();
    // Retrying re-runs the policy fetch.
    fireEvent.press(getByTestId('coach-community-cohorts-empty-payload-error-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('Moderation: a NETWORK payload failure renders CoachErrorState, NOT the celebratory empty copy', () => {
    const retry = jest.fn();
    mockState.flagged = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() };
    mockEmptyResultOverride.current = {
      coach_community_moderation_empty: { status: 'error', kind: 'network', retry },
    };
    const { getByTestId, queryByText } = render(<CoachCommunityModerationScreen />);
    expect(getByTestId('coach-community-moderation-empty-payload-error')).toBeTruthy();
    expect(queryByText('TEST_EMPTY_MODERATION_COPY')).toBeNull();
  });
});

describe('UX P0.2 — error branch is distinct from the empty state (no masquerade)', () => {
  it('Home load error renders CoachErrorState, NOT the empty copy', () => {
    mockState.dashboard = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText } = render(<CoachCommunityHomeScreen />);
    expect(getByTestId('coach-community-home-error')).toBeTruthy();
    expect(getByTestId('coach-community-home-error-retry')).toBeTruthy();
    // The calm empty copy must NOT appear on an error.
    expect(queryByText('TEST_EMPTY_HOME_COPY')).toBeNull();
  });

  it('Inbox load error renders CoachErrorState, NOT the empty copy', () => {
    mockState.inbox = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-error')).toBeTruthy();
    expect(queryByTestId('coach-community-inbox-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_INBOX_COPY')).toBeNull();
  });

  it('Cohorts load error renders CoachErrorState, NOT the empty copy', () => {
    mockState.cohorts = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-error')).toBeTruthy();
    expect(queryByTestId('coach-community-cohorts-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_COHORTS_COPY')).toBeNull();
  });

  it('Cohort detail load error renders CoachErrorState, NOT the empty copy', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = render(<CoachCommunityCohortDetailScreen />);
    expect(getByTestId('coach-community-cohort-detail-error')).toBeTruthy();
    expect(queryByTestId('coach-community-cohort-detail-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_MEMBERS_COPY')).toBeNull();
  });

  it('Moderation load error renders CoachErrorState, NOT the celebratory empty copy', () => {
    mockState.flagged = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() };
    const { getByTestId, queryByText, queryByTestId } = render(<CoachCommunityModerationScreen />);
    expect(getByTestId('coach-community-moderation-error')).toBeTruthy();
    expect(queryByTestId('coach-community-moderation-empty')).toBeNull();
    expect(queryByText('TEST_EMPTY_MODERATION_COPY')).toBeNull();
  });

  it('the error retry button re-runs the failed query', () => {
    const refetch = jest.fn();
    mockState.inbox = { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch };
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    fireEvent.press(getByTestId('coach-community-inbox-error-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('Coach mutations — create / invite / remove / ack / hide', () => {
  it('creates a cohort with the typed name', () => {
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    fireEvent.changeText(
      getByTestId('coach-community-cohorts-name-input'),
      'Winter cut',
    );
    fireEvent.press(getByTestId('coach-community-cohorts-modal-submit'));
    expect(mockCreateMutate).toHaveBeenCalledWith(
      { name: 'Winter cut' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('does not create a cohort with an empty name', () => {
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    fireEvent.press(getByTestId('coach-community-cohorts-modal-submit'));
    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it('invites a client by email', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite'));
    fireEvent.changeText(
      getByTestId('coach-community-cohort-detail-email-input'),
      'new@example.com',
    );
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite-submit'));
    expect(mockInviteMutate).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('does not invite with an invalid email', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite'));
    fireEvent.changeText(
      getByTestId('coach-community-cohort-detail-email-input'),
      'not-an-email',
    );
    fireEvent.press(getByTestId('coach-community-cohort-detail-invite-submit'));
    expect(mockInviteMutate).not.toHaveBeenCalled();
  });

  it('removes a client only after the kebab overflow AND confirmation (UX P1.1)', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityCohortDetailScreen />);
    // Remove is NOT a visible button on the row — only the kebab overflow is.
    expect(
      queryByTestId('coach-community-member-remove-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBeNull();
    expect(
      getByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBeTruthy();
    // Open the overflow sheet, then choose Remove from cohort.
    fireEvent.press(
      getByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );
    fireEvent.press(getByTestId('coach-community-member-menu-remove'));
    // Confirmation modal is now shown; mutation has NOT fired yet.
    expect(
      queryByTestId('coach-community-cohort-detail-remove-confirm-confirm'),
    ).toBeTruthy();
    expect(mockRemoveMutate).not.toHaveBeenCalled();
    // Confirm fires the DELETE.
    fireEvent.press(
      getByTestId('coach-community-cohort-detail-remove-confirm-confirm'),
    );
    expect(mockRemoveMutate).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('cancelling the remove confirmation fires no DELETE', () => {
    mockRouteParams.current = { cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    mockState.cohortDetail = {
      data: { cohort: cohort(), members: [member()] },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<CoachCommunityCohortDetailScreen />);
    fireEvent.press(
      getByTestId('coach-community-member-menu-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );
    fireEvent.press(getByTestId('coach-community-member-menu-remove'));
    fireEvent.press(getByTestId('coach-community-cohort-detail-remove-confirm-cancel'));
    expect(mockRemoveMutate).not.toHaveBeenCalled();
  });

  it('acknowledges an inbox item via the Mark-acked quick-action (flag ON; legacy Ack CTA suppressed)', () => {
    // v2-2 (R1 fixer, M-P2 copy collision): with EXPO_PUBLIC_FF_COMMUNITY_ACKS
    // on, the legacy trailing "Ack" CTA is removed in favour of the in-row
    // "Mark acked" quick-action (which is state-aware and disables once
    // acked/replied). The two competing acknowledge affordances were the
    // collision the UX audit flagged.
    mockState.inbox = {
      data: { items: [inboxItem()], next_before: null },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    mockAckStateByMessage.current['11111111-1111-1111-1111-111111111111'] = {
      state: 'seen',
      seen_at: '2026-06-09T12:00:00.000Z',
      acked_at: null,
      replied_at: null,
      sla: {
        sla_state: 'within',
        elapsed_ms: 1_000,
        soft_target_ms: 24 * 60 * 60 * 1000,
        hard_target_ms: 48 * 60 * 60 * 1000,
      },
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityInboxScreen />);
    // The legacy v1-6 "Ack" CTA is gone under the flag.
    expect(
      queryByTestId('coach-community-inbox-ack-11111111-1111-1111-1111-111111111111'),
    ).toBeNull();
    // The v2-2 "Mark acked" quick-action fires the ack-action hook instead.
    fireEvent.press(
      getByTestId('coach-community-inbox-mark-acked-11111111-1111-1111-1111-111111111111'),
    );
    expect(mockMarkAckedMutate).toHaveBeenCalledTimes(1);
  });

  it('hides a flagged post only after confirmation', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityModerationScreen />);
    fireEvent.press(
      getByTestId('coach-community-flagged-hide-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    expect(
      queryByTestId('coach-community-moderation-hide-confirm-confirm'),
    ).toBeTruthy();
    expect(mockHideMutate).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-confirm'));
    expect(mockHideMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', target_type: 'post' }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onSettled: expect.any(Function),
      }),
    );
  });

  it('cancelling the hide confirmation fires no mutation', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityModerationScreen />);
    fireEvent.press(
      getByTestId('coach-community-flagged-hide-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-cancel'));
    expect(mockHideMutate).not.toHaveBeenCalled();
  });

  it('exposes no Approve action (the no-network stub was removed — G10.2 Option A)', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { queryByTestId } = render(<CoachCommunityModerationScreen />);
    expect(
      queryByTestId('coach-community-flagged-approve-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    ).toBeNull();
  });

  it('a flagged post row taps through to the post-detail surface', () => {
    mockState.flagged = {
      data: [flaggedItem()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityModerationScreen />);
    fireEvent.press(
      getByTestId('coach-community-flagged-content-cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityPostDetail', {
      postId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      flagged: true,
    });
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

  it('inbox card -> Inbox', () => {
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    fireEvent.press(getByTestId('coach-community-home-inbox-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityInbox');
  });

  it('cohorts card -> Cohorts', () => {
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    fireEvent.press(getByTestId('coach-community-home-cohorts-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohorts');
  });

  it('moderation card -> Moderation', () => {
    const { getByTestId } = render(<CoachCommunityHomeScreen />);
    fireEvent.press(getByTestId('coach-community-home-moderation-card'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityModeration');
  });
});

describe('List states + interactions — loading, refresh, navigation, batch select', () => {
  it('Inbox shows a loading indicator while fetching', () => {
    mockState.inbox = { data: undefined, isLoading: true, isError: false };
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId('coach-community-inbox-loading')).toBeTruthy();
  });

  it('Inbox Select mode reveals checkboxes and marks selected rows as read (UX P1.3)', () => {
    mockState.inbox = {
      data: {
        items: [
          inboxItem({ id: '11111111-1111-1111-1111-111111111111' }),
          inboxItem({ id: '99999999-9999-9999-9999-999999999999' }),
        ],
        next_before: null,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityInboxScreen />);
    // The visible Select toggle is the discoverable, sighted-user batch entry.
    fireEvent.press(getByTestId('coach-community-inbox-select-toggle'));
    // Rows now expose checkboxes.
    expect(
      getByTestId('coach-community-inbox-check-11111111-1111-1111-1111-111111111111'),
    ).toBeTruthy();
    // Select one row, then mark the selection as read.
    fireEvent.press(
      getByTestId('coach-community-inbox-row-11111111-1111-1111-1111-111111111111'),
    );
    fireEvent.press(getByTestId('coach-community-inbox-mark-selected'));
    expect(mockAckMutate).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(mockAckMutate).not.toHaveBeenCalledWith('99999999-9999-9999-9999-999999999999');
    // Select mode exits after the batch action.
    expect(queryByTestId('coach-community-inbox-mark-selected')).toBeNull();
  });

  it('Inbox long-press marks every item in the same cohort thread as read', () => {
    mockState.inbox = {
      data: {
        items: [
          inboxItem({ id: '11111111-1111-1111-1111-111111111111' }),
          inboxItem({ id: '99999999-9999-9999-9999-999999999999' }),
          inboxItem({
            id: '22222222-2222-2222-2222-222222222222',
            cohort_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            cohort_name: 'Autumn block',
          }),
        ],
        next_before: null,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    fireEvent(
      getByTestId('coach-community-inbox-row-11111111-1111-1111-1111-111111111111'),
      'longPress',
    );
    // Both Spring-block items acked; the Autumn-block item left untouched.
    expect(mockAckMutate).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(mockAckMutate).toHaveBeenCalledWith('99999999-9999-9999-9999-999999999999');
    expect(mockAckMutate).not.toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222');
  });

  it('Cohorts shows a loading indicator while fetching', () => {
    mockState.cohorts = { data: undefined, isLoading: true, isError: false };
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    expect(getByTestId('coach-community-cohorts-loading')).toBeTruthy();
  });

  it('Cohorts row tap navigates to the cohort detail with its id and name', () => {
    mockState.cohorts = {
      data: [cohort()],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
    const { getByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(
      getByTestId('coach-community-cohort-row-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    );
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohortDetail', {
      cohortId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      cohortName: 'Spring block',
    });
  });

  it('Cohorts cancel closes the create modal without a mutation', () => {
    const { getByTestId, queryByTestId } = render(<CoachCommunityCohortsScreen />);
    fireEvent.press(getByTestId('coach-community-cohorts-fab'));
    expect(getByTestId('coach-community-cohorts-modal')).toBeTruthy();
    fireEvent.press(getByTestId('coach-community-cohorts-modal-cancel'));
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
      data: { items: [inboxItem()], next_before: null },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
  };

  it('renders the ack badge per row reflecting the state from the API', () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('acked', 'within');
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    expect(getByTestId(`coach-community-inbox-ack-badge-${MID}`)).toBeTruthy();
    // The derived state pill is keyed by the API state.
    expect(
      getByTestId(`coach-community-inbox-ack-badge-${MID}-state-acked`),
    ).toBeTruthy();
  });

  it('tapping Mark acked fires the ack-action hook for that message', () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'within');
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    fireEvent.press(getByTestId(`coach-community-inbox-mark-acked-${MID}`));
    expect(mockMarkAckedMutate).toHaveBeenCalledTimes(1);
  });

  it('the SLA chip matches the state from the API (breached)', () => {
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'breached');
    const { getByTestId, queryByTestId } = render(<CoachCommunityInboxScreen />);
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

  it('a normal row tap navigates to the message-detail surface (M-NEW closed loop)', () => {
    // The R1 UX audit dead-ended here: the inbox showed ack badges but tapping a
    // row went NOWHERE. A normal (non-select) tap now opens the message detail.
    seedInbox();
    mockAckStateByMessage.current[MID] = ackEnvelope('seen', 'within');
    const { getByTestId } = render(<CoachCommunityInboxScreen />);
    fireEvent.press(getByTestId(`coach-community-inbox-row-${MID}`));
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityMessageDetail', {
      messageId: MID,
    });
  });
});
