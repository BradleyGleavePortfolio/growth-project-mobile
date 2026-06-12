/**
 * Render + branch tests for the two v2-3 Community EVENTS screens:
 *   - CommunityEventDetailScreen (client): loading / error / empty / data, the
 *     three RSVP actions, and the EXTERNAL link open path (never a native room).
 *   - CoachCommunityEventsScreen (coach): loading / error / empty / data, the
 *     create FAB + modal, and the per-event manage modal (advance / replay /
 *     reflect).
 *
 * Every data hook is mocked so each render path is deterministic and the suite
 * exits clean (no React Query timers). useTheme is mocked to the real light
 * tokens so semanticColors keys resolve without the ThemeProvider — mirroring
 * the v1-5/v1-6 screen-test harness.
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

// ── Theme: real tokens, no ThemeProvider ─────────────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// ── DateTimePicker: a headless stub that fires onChange with a fixed instant
//    when pressed, so the create-flow test can drive the F12 pickers ──────────
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  // A fixed local instant used by both the date and time picker stubs.
  const FIXED = new Date('2026-08-01T18:00:00.000Z');
  return {
    __esModule: true,
    default: ({ onChange, testID }: { onChange: (e: unknown, d: Date) => void; testID?: string }) =>
      React.createElement(Pressable, {
        testID,
        onPress: () => onChange({ type: 'set' }, FIXED),
      }),
  };
});

// ── Safe-area: provide stub insets so SafeAreaView renders headlessly ─────────
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// ── Navigation ────────────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRouteParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

// ── Current user + community/me ───────────────────────────────────────────────
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me-1', firstName: 'Dana', name: 'Dana' }),
}));
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1' } }),
}));

// ── Events hooks (the unit under test wires these) ───────────────────────────
const mockMutate = {
  rsvp: jest.fn(),
  create: jest.fn(),
  transition: jest.fn(),
  attachReplay: jest.fn(),
  reflect: jest.fn(),
};

// The list surface reads through useInfiniteQuery, so its data is paged
// (`pages: CommunityEventListResponse[]`) and it exposes the cursor controls
// (`fetchNextPage` / `hasNextPage` / `isFetchingNextPage`).
const mockFetchNextPage = jest.fn();
const mockEventHooks = {
  detail: { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() } as Record<string, unknown>,
  list: {
    data: { pages: [{ events: [], next_before: null }], pageParams: [undefined] },
    isLoading: false,
    isError: false,
    isRefetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: jest.fn(),
  } as Record<string, unknown>,
};

jest.mock('../../../hooks/useCommunityEvents', () => ({
  useCommunityEvent: () => mockEventHooks.detail,
  useCommunityEventsInfiniteList: () => mockEventHooks.list,
  useRsvpEvent: () => ({ mutate: mockMutate.rsvp, isPending: false }),
  useCreateEvent: () => ({ mutate: mockMutate.create, isPending: false }),
  useTransitionEvent: () => ({ mutate: mockMutate.transition, isPending: false }),
  useAttachReplay: () => ({ mutate: mockMutate.attachReplay, isPending: false }),
  useReflectEvent: () => ({ mutate: mockMutate.reflect, isPending: false }),
  isOptimisticEventId: (id: string) => id.startsWith('optimistic:'),
}));

import CommunityEventDetailScreen from '../CommunityEventDetailScreen';
import CoachCommunityEventsScreen from '../CoachCommunityEventsScreen';
import type { CommunityEvent } from '../../../api/communityEventsApi';

function makeEvent(overrides: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    id: 'ev-1',
    workspace_id: 'ws-1',
    cohort_id: null,
    created_by_user_id: 'coach-1',
    title: 'Live Q&A',
    description: 'Bring your questions.',
    state: 'scheduled',
    starts_at: '2026-07-01T18:00:00.000Z',
    ends_at: null,
    external_url: null,
    reflected_at: null,
    canceled: false,
    rsvp_counts: { going: 4, maybe: 1, declined: 0, attended: 0, missed: 0 },
    viewer_rsvp_status: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(mockMutate).forEach((m) => m.mockReset());
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockRouteParams.current = { eventId: 'ev-1' };
  mockEventHooks.detail = {
    data: undefined,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
  mockFetchNextPage.mockReset();
  mockEventHooks.list = {
    data: { pages: [{ events: [], next_before: null }], pageParams: [undefined] },
    isLoading: false,
    isError: false,
    isRefetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: jest.fn(),
  };
});

// ─── CommunityEventDetailScreen (client) ─────────────────────────────────────

describe('CommunityEventDetailScreen', () => {
  it('renders a loading branch', () => {
    mockEventHooks.detail = { ...mockEventHooks.detail, isLoading: true };
    const { getByTestId } = render(<CommunityEventDetailScreen />);
    expect(getByTestId('community-event-detail-loading')).toBeTruthy();
  });

  it('renders an honest error branch with retry (not an empty masquerade)', () => {
    const refetch = jest.fn();
    mockEventHooks.detail = { ...mockEventHooks.detail, isError: true, refetch };
    const { getByTestId } = render(<CommunityEventDetailScreen />);
    fireEvent.press(getByTestId('community-event-detail-retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders an empty state with a back action when the event is missing', () => {
    mockEventHooks.detail = { ...mockEventHooks.detail, data: undefined };
    const { getByTestId } = render(<CommunityEventDetailScreen />);
    fireEvent.press(getByTestId('community-event-detail-empty-action'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('renders event detail and fires RSVP with the client status', () => {
    mockEventHooks.detail = { ...mockEventHooks.detail, data: makeEvent() };
    const { getByText, getByTestId } = render(<CommunityEventDetailScreen />);
    expect(getByText('Live Q&A')).toBeTruthy();
    expect(getByText('Bring your questions.')).toBeTruthy();
    fireEvent.press(getByTestId('community-event-rsvp-going'));
    // F4/F10: mutate now carries success/error callbacks for confirmation +
    // surfaced failure, so the second arg is the mutation options object.
    expect(mockMutate.rsvp).toHaveBeenCalledWith('going', expect.any(Object));
  });

  it('does NOT render a mascot-voiced empty state on the event surface (F2)', () => {
    mockEventHooks.detail = { ...mockEventHooks.detail, data: undefined };
    const { queryByTestId } = render(<CommunityEventDetailScreen />);
    // The neutral event empty state must not borrow the mascot-voiced surface.
    expect(queryByTestId('community-empty-roman')).toBeNull();
    expect(queryByTestId('community-event-detail-empty')).toBeTruthy();
  });

  it('opens an EXTERNAL https link in the system browser (never a native room)', () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockEventHooks.detail = {
      ...mockEventHooks.detail,
      data: makeEvent({ state: 'live', external_url: 'https://example.com/live' }),
    };
    const { getByTestId, queryByText } = render(<CommunityEventDetailScreen />);
    // Copy never promises a native room.
    expect(queryByText(/join native room/i)).toBeNull();
    fireEvent.press(getByTestId('community-event-detail-link'));
    expect(openUrl).toHaveBeenCalledWith('https://example.com/live');
    openUrl.mockRestore();
  });

  it('F11: external-link copy says it opens in the browser', () => {
    mockEventHooks.detail = {
      ...mockEventHooks.detail,
      data: makeEvent({ state: 'replay', external_url: 'https://example.com/replay' }),
    };
    const { getByText } = render(<CommunityEventDetailScreen />);
    expect(getByText(/in browser/i)).toBeTruthy();
  });

  it('F3: refuses a non-https external link with a calm inline error', () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockEventHooks.detail = {
      ...mockEventHooks.detail,
      data: makeEvent({ state: 'live', external_url: 'javascript:alert(1)' }),
    };
    const { getByTestId } = render(<CommunityEventDetailScreen />);
    fireEvent.press(getByTestId('community-event-detail-link'));
    expect(openUrl).not.toHaveBeenCalled();
    expect(getByTestId('community-event-detail-link-error')).toBeTruthy();
    openUrl.mockRestore();
  });

  it('F13: shows the status-honest live lifecycle label', () => {
    mockEventHooks.detail = {
      ...mockEventHooks.detail,
      data: makeEvent({ state: 'live', external_url: 'https://example.com/live' }),
    };
    const { getByText } = render(<CommunityEventDetailScreen />);
    expect(getByText('Live now')).toBeTruthy();
  });

  it('hides RSVP actions once the event is reflected', () => {
    mockEventHooks.detail = {
      ...mockEventHooks.detail,
      data: makeEvent({ state: 'reflected', reflected_at: '2026-07-02T00:00:00.000Z' }),
    };
    const { queryByTestId } = render(<CommunityEventDetailScreen />);
    expect(queryByTestId('community-event-rsvp-going')).toBeNull();
  });
});

// ─── CoachCommunityEventsScreen (coach) ──────────────────────────────────────

describe('CoachCommunityEventsScreen', () => {
  it('renders a loading branch', () => {
    mockEventHooks.list = { ...mockEventHooks.list, isLoading: true };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    expect(getByTestId('coach-community-events-loading')).toBeTruthy();
  });

  it('renders an honest error branch with retry', () => {
    const refetch = jest.fn();
    mockEventHooks.list = { ...mockEventHooks.list, isError: true, refetch };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-events-error-retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders an honest empty state with a create action', () => {
    mockEventHooks.list = { ...mockEventHooks.list, data: { pages: [{ events: [], next_before: null }], pageParams: [undefined] } };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    expect(getByTestId('coach-community-events-empty')).toBeTruthy();
    fireEvent.press(getByTestId('coach-community-events-empty-action'));
    expect(getByTestId('coach-community-events-create-modal')).toBeTruthy();
  });

  it('F12: creates an event using the date/time pickers (ISO serialized)', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { pages: [{ events: [makeEvent()], next_before: null }], pageParams: [undefined] },
    };
    const { getByTestId, getByText } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-events-fab'));
    fireEvent.changeText(getByTestId('coach-community-events-title-input'), 'Workshop');
    // A visible local-timezone hint accompanies the pickers (no raw ISO input).
    expect(getByText(/local timezone/i)).toBeTruthy();
    // Open each picker; the stubbed pickers fire onChange with the fixed
    // instant, setting the date and time of the held Date respectively.
    fireEvent.press(getByTestId('coach-community-events-date-trigger'));
    fireEvent.press(getByTestId('coach-community-events-date-picker'));
    fireEvent.press(getByTestId('coach-community-events-time-trigger'));
    fireEvent.press(getByTestId('coach-community-events-time-picker'));
    fireEvent.press(getByTestId('coach-community-events-create-submit'));
    // The picked local time serializes to a UTC ISO-8601 string behind the
    // scenes. We assert the date + minute precision is preserved end-to-end by
    // checking it parses back to the same instant the picker emitted.
    const call = mockMutate.create.mock.calls[0][0] as { starts_at: string };
    expect(new Date(call.starts_at).getTime()).toBe(
      new Date('2026-08-01T18:00:00.000Z').getTime(),
    );
    expect(mockMutate.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Workshop' }),
      expect.any(Object),
    );
  });

  it('F12: the raw ISO start-time text input is gone', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { pages: [{ events: [makeEvent()], next_before: null }], pageParams: [undefined] },
    };
    const { getByTestId, queryByTestId } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-events-fab'));
    expect(queryByTestId('coach-community-events-starts-input')).toBeNull();
  });

  it('advances lifecycle state from the manage modal', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { pages: [{ events: [makeEvent({ id: 'ev-9', state: 'scheduled' })], next_before: null }], pageParams: [undefined] },
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-event-row-ev-9'));
    fireEvent.press(getByTestId('coach-community-events-advance'));
    // scheduled → tomorrow is the immediate next state.
    expect(mockMutate.transition).toHaveBeenCalledWith('tomorrow', expect.any(Object));
  });

  it('attaches an EXTERNAL replay link from the manage modal', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { pages: [{ events: [makeEvent({ id: 'ev-7', state: 'live' })], next_before: null }], pageParams: [undefined] },
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-event-row-ev-7'));
    fireEvent.changeText(
      getByTestId('coach-community-events-replay-input'),
      'https://example.com/replay',
    );
    fireEvent.press(getByTestId('coach-community-events-attach-replay'));
    expect(mockMutate.attachReplay).toHaveBeenCalledWith(
      'https://example.com/replay',
      expect.any(Object),
    );
  });

  it('F14: reflect (close) is gated behind a calm confirm sheet', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { pages: [{ events: [makeEvent({ id: 'ev-5', state: 'replay' })], next_before: null }], pageParams: [undefined] },
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-event-row-ev-5'));
    // Tapping reflect opens the confirm sheet — it does NOT fire the mutation.
    fireEvent.press(getByTestId('coach-community-events-reflect'));
    expect(mockMutate.reflect).not.toHaveBeenCalled();
    expect(getByTestId('coach-community-events-reflect-confirm')).toBeTruthy();
    // Confirming in the sheet fires the close.
    fireEvent.press(getByTestId('coach-community-events-reflect-confirm-action'));
    expect(mockMutate.reflect).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('F13: the manage modal shows status-honest lifecycle labels', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { pages: [{ events: [makeEvent({ id: 'ev-3', state: 'live' })], next_before: null }], pageParams: [undefined] },
    };
    const { getByTestId, getAllByText } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-event-row-ev-3'));
    // 'Live now' appears for the live state (label is shared via stateMeta).
    expect(getAllByText(/Live now/i).length).toBeGreaterThan(0);
  });

  it('declares list semantics on the event list container', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: {
        pages: [{ events: [makeEvent({ id: 'ev-2' })], next_before: null }],
        pageParams: [undefined],
      },
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    const list = getByTestId('coach-community-events-list');
    expect(list.props.accessibilityRole).toBe('list');
  });

  it('exposes a busy progressbar label on the loading branch', () => {
    mockEventHooks.list = { ...mockEventHooks.list, isLoading: true };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    const loading = getByTestId('coach-community-events-loading');
    expect(loading.props.accessibilityRole).toBe('progressbar');
    expect(loading.props.accessibilityLabel).toBe('Loading events');
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('error copy points at the available tap-to-retry control (not pull)', () => {
    mockEventHooks.list = { ...mockEventHooks.list, isError: true };
    const { getByText, queryByText } = render(<CoachCommunityEventsScreen />);
    expect(getByText(/Tap to retry/i)).toBeTruthy();
    expect(queryByText(/Pull to retry/i)).toBeNull();
  });

  it('cursor pagination: onEndReached fetches the next page when one exists', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: {
        pages: [
          { events: [makeEvent({ id: 'ev-a' })], next_before: '2026-06-01' },
        ],
        pageParams: [undefined],
      },
      hasNextPage: true,
      isFetchingNextPage: false,
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    const list = getByTestId('coach-community-events-list');
    // The FlatList is the single child of the list wrapper; drive its
    // onEndReached the way scrolling to the end would.
    const flatList = list.props.children;
    flatList.props.onEndReached();
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('cursor pagination: onEndReached is a no-op when there is no next page', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: {
        pages: [{ events: [makeEvent({ id: 'ev-b' })], next_before: null }],
        pageParams: [undefined],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    const flatList = getByTestId('coach-community-events-list').props.children;
    flatList.props.onEndReached();
    expect(mockFetchNextPage).not.toHaveBeenCalled();
  });

  it('cursor pagination: a calm load-more footer announces while fetching the next page', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: {
        pages: [
          { events: [makeEvent({ id: 'ev-c' })], next_before: '2026-06-01' },
        ],
        pageParams: [undefined],
      },
      hasNextPage: true,
      isFetchingNextPage: true,
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    const footer = getByTestId('coach-community-events-load-more');
    expect(footer.props.accessibilityRole).toBe('progressbar');
    expect(footer.props.accessibilityLabel).toBe('Loading more events');
  });
});
