/**
 * CommunityClassroomScreen — reachability, prerequisite-ordering, list-render,
 * release-lock, and flag-guard regression tests (v3-2).
 *
 * The read-only student feed resolves the workspace id internally from
 * `useCommunityMe` when no prop is supplied (mirroring CommunityTabScreen) and
 * pages the list with a cursor envelope. These tests pin:
 *
 *   1. Empty state only AFTER the workspace prerequisite AND the list succeed —
 *      a still-loading or errored prerequisite is never shown as "no lessons".
 *   2. The LessonCard list renders for a populated feed, each row wrapped in a
 *      `role="listitem"` container for assistive tech.
 *   3. A release-locked lesson renders the LessonReleaseLockBadge in its card.
 *   4. Defense-in-depth flag guard: with `communityClassroom` OFF the screen
 *      renders a neutral "not available" state and fires NO feed request — even
 *      though the route would not normally register at all.
 *
 * The data layer is mocked and a real QueryClient is provided so the screen's
 * own query branching runs deterministically. RNTL v14 async patterns
 * (findBy*, act around state-changing fires) are used throughout.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Theme: real light tokens, no ThemeProvider ───────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// ── Ionicons -> a Text node so line icons are observable without font assets ──
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, testID }: { name: string; testID?: string }) =>
      React.createElement(
        Text,
        { testID: testID ?? `icon-${name}` },
        `icon:${name}`,
      ),
  };
});

// ── Navigation ───────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// ── Feature flags — overridden per test via the mutable holder ───────────────
const flags = { communityClassroom: true };
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
jest.mock('../../../api/communityClassroomApi', () => ({
  communityClassroomApi: {
    listFeed: jest.fn(),
    getLesson: jest.fn(),
  },
  CLASSROOM_PAGE_LIMIT: 20,
}));

import { AccessibilityInfo } from 'react-native';
import { communityClassroomApi } from '../../../api/communityClassroomApi';
import type {
  ClassroomPost,
  ClassroomFeedPage,
} from '../../../api/communityClassroomApi';
import CommunityClassroomScreen from '../CommunityClassroomScreen';

const api = jest.mocked(communityClassroomApi);

const WS = '11111111-1111-4111-8111-111111111111';
const COACH = '22222222-2222-4222-8222-222222222222';
const CURSOR_UUID = '99999999-9999-4999-8999-999999999999';

function lesson(overrides: Partial<ClassroomPost> = {}): ClassroomPost {
  return {
    id: 'lesson-1',
    workspace_id: WS,
    cohort_id: null,
    coach_id: COACH,
    title: 'Week 1 — Foundations',
    body_markdown: '',
    status: 'published',
    pinned: false,
    pinned_order: null,
    release_at: null,
    release_locked: false,
    published_at: '2026-03-01T00:00:00.000Z',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    media: [],
    ...overrides,
  };
}

function page(
  posts: ClassroomPost[],
  next_cursor: string | null = null,
): ClassroomFeedPage {
  return { posts, next_cursor };
}

type ScreenProps = {
  workspaceId?: string | null;
  prerequisiteLoading?: boolean;
  prerequisiteError?: boolean;
  onRetryPrerequisite?: () => void;
};

function ClassroomWithClient(props: ScreenProps): React.ReactElement {
  return <CommunityClassroomScreen {...props} />;
}

async function renderScreen(props: ScreenProps = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = await render(
    <QueryClientProvider client={client}>
      <ClassroomWithClient {...props} />
    </QueryClientProvider>,
  );
  const rerender = (next: React.ReactElement) =>
    utils.rerender(
      <QueryClientProvider client={client}>{next}</QueryClientProvider>,
    );
  return { ...utils, rerender };
}

beforeEach(() => {
  flags.communityClassroom = true;
  mockMeHolder.data = { workspace_id: 'ws-resolved' };
  mockMeHolder.isLoading = false;
  mockMeHolder.isError = false;
  mockMeHolder.refetch = jest.fn();
  mockNavigate.mockReset();
  (api.listFeed as jest.Mock).mockReset();
  api.listFeed.mockResolvedValue(page([]));
});

describe('CommunityClassroomScreen — workspace prerequisite resolves before empty', () => {
  it('shows the prerequisite loading state (never "no lessons") while me is loading', async () => {
    mockMeHolder.data = undefined;
    mockMeHolder.isLoading = true;
    await renderScreen();

    expect(
      await screen.findByTestId('community-classroom-prereq-loading'),
    ).toBeTruthy();
    expect(screen.queryByTestId('community-classroom-empty')).toBeNull();
    expect(api.listFeed).not.toHaveBeenCalled();
  });

  it('shows a retryable error (never "no lessons") when me errors, and retry refetches', async () => {
    mockMeHolder.data = undefined;
    mockMeHolder.isError = true;
    await renderScreen();

    expect(
      await screen.findByTestId('community-classroom-prereq-error'),
    ).toBeTruthy();
    expect(screen.queryByTestId('community-classroom-empty')).toBeNull();
    expect(api.listFeed).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('community-classroom-prereq-retry'));
    });
    expect(mockMeHolder.refetch).toHaveBeenCalledTimes(1);
  });

  it('treats an explicit null workspaceId prop as a still-pending prerequisite, not an empty workspace', async () => {
    await renderScreen({ workspaceId: null });

    expect(
      await screen.findByTestId('community-classroom-prereq-loading'),
    ).toBeTruthy();
    expect(screen.queryByTestId('community-classroom-empty')).toBeNull();
    expect(api.listFeed).not.toHaveBeenCalled();
  });
});

describe('CommunityClassroomScreen — empty state', () => {
  it('renders the empty state only once the prerequisite AND the list succeed', async () => {
    api.listFeed.mockResolvedValue(page([]));
    await renderScreen();

    expect(
      await screen.findByTestId('community-classroom-empty'),
    ).toBeTruthy();
    // The bounded fetch fired against the self-resolved workspace.
    await waitFor(() =>
      expect(api.listFeed).toHaveBeenCalledWith('ws-resolved', { limit: 20 }),
    );
  });
});

describe('CommunityClassroomScreen — populated feed renders LessonCards', () => {
  it('renders a LessonCard list, each row wrapped in a role="listitem" container', async () => {
    api.listFeed.mockResolvedValue(
      page([lesson({ id: 'lesson-1' }), lesson({ id: 'lesson-2' })]),
    );
    await renderScreen();

    expect(
      await screen.findByTestId('community-lesson-card-lesson-1'),
    ).toBeTruthy();
    expect(screen.getByTestId('community-lesson-card-lesson-2')).toBeTruthy();

    const row = screen.getByTestId('community-lesson-listitem-lesson-1');
    expect(row.props.role).toBe('listitem');

    // The list is named with its loaded count and is a polite live region.
    const list = screen.getByTestId('community-classroom-list');
    expect(list.props.accessibilityLabel).toBe('Lessons, 2 items');
    expect(list.props.accessibilityLiveRegion).toBe('polite');
  });

  it('opens the lesson detail with the tapped post id', async () => {
    api.listFeed.mockResolvedValue(page([lesson({ id: 'lesson-7' })]));
    await renderScreen();

    const card = await screen.findByTestId('community-lesson-card-lesson-7');
    await act(async () => {
      fireEvent.press(card);
    });
    expect(mockNavigate).toHaveBeenCalledWith('CommunityLessonDetail', {
      postId: 'lesson-7',
    });
  });

  it('renders the LessonReleaseLockBadge for a release-locked lesson in the feed', async () => {
    api.listFeed.mockResolvedValue(
      page([
        lesson({
          id: 'lesson-locked',
          release_locked: true,
          release_at: '2026-03-04T00:00:00.000Z',
        }),
      ]),
    );
    await renderScreen();

    expect(
      await screen.findByTestId('community-lesson-card-lesson-locked'),
    ).toBeTruthy();
    // The lock badge renders inside the card (card testID prefix + "-lock").
    expect(
      screen.getByTestId('community-lesson-card-lesson-locked-lock'),
    ).toBeTruthy();
  });

  it('announces the loaded count to assistive tech on data arrival', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    api.listFeed.mockResolvedValue(
      page([lesson({ id: 'lesson-1' }), lesson({ id: 'lesson-2' })]),
    );
    await renderScreen();

    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith('Lessons loaded, 2 items'),
    );
    announce.mockRestore();
  });

  it('pages the feed via onEndReached, threading the bare cursor, then stops on null', async () => {
    api.listFeed
      .mockResolvedValueOnce(page([lesson({ id: 'lesson-1' })], CURSOR_UUID))
      .mockResolvedValueOnce(page([lesson({ id: 'lesson-2' })], null));
    await renderScreen();

    await screen.findByTestId('community-lesson-card-lesson-1');
    const list = screen.getByTestId('community-classroom-list');
    await act(async () => {
      list.props.onEndReached();
    });

    await waitFor(() =>
      expect(api.listFeed).toHaveBeenNthCalledWith(2, 'ws-resolved', {
        limit: 20,
        cursor: CURSOR_UUID,
      }),
    );
    await screen.findByTestId('community-lesson-card-lesson-2');
  });
});

describe('CommunityClassroomScreen — defense-in-depth flag guard', () => {
  it('renders a neutral "not available" state and fires NO feed request when the flag is OFF', async () => {
    flags.communityClassroom = false;
    await renderScreen();

    // The header still renders, but the neutral copy is shown — never an error,
    // never an empty-state, never the list.
    expect(
      await screen.findByText('The classroom is not available right now.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('community-classroom-list')).toBeNull();
    expect(screen.queryByTestId('community-classroom-empty')).toBeNull();
    // No classroom request is issued in a flag-off build (belt-and-suspenders).
    expect(api.listFeed).not.toHaveBeenCalled();
  });
});
