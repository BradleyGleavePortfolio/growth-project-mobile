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

const mockEventHooks = {
  detail: { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() } as Record<string, unknown>,
  list: { data: { events: [], next_before: null }, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() } as Record<string, unknown>,
};

jest.mock('../../../hooks/useCommunityEvents', () => ({
  useCommunityEvent: () => mockEventHooks.detail,
  useCommunityEventsList: () => mockEventHooks.list,
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
  mockEventHooks.list = {
    data: { events: [], next_before: null },
    isLoading: false,
    isError: false,
    isRefetching: false,
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
    expect(mockMutate.rsvp).toHaveBeenCalledWith('going');
  });

  it('opens an EXTERNAL link in the system browser (never a native room)', () => {
    const canOpen = jest
      .spyOn(Linking, 'canOpenURL')
      .mockResolvedValue(true);
    mockEventHooks.detail = {
      ...mockEventHooks.detail,
      data: makeEvent({ state: 'live', external_url: 'https://example.com/live' }),
    };
    const { getByTestId, queryByText } = render(<CommunityEventDetailScreen />);
    // Copy never promises a native room.
    expect(queryByText(/join native room/i)).toBeNull();
    fireEvent.press(getByTestId('community-event-detail-link'));
    expect(canOpen).toHaveBeenCalledWith('https://example.com/live');
    canOpen.mockRestore();
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
    mockEventHooks.list = { ...mockEventHooks.list, data: { events: [], next_before: null } };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    expect(getByTestId('coach-community-events-empty')).toBeTruthy();
    fireEvent.press(getByTestId('coach-community-events-empty-action'));
    expect(getByTestId('coach-community-events-create-modal')).toBeTruthy();
  });

  it('creates an event from the FAB modal with title + start time', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { events: [makeEvent()], next_before: null },
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-events-fab'));
    fireEvent.changeText(getByTestId('coach-community-events-title-input'), 'Workshop');
    fireEvent.changeText(
      getByTestId('coach-community-events-starts-input'),
      '2026-08-01T18:00:00Z',
    );
    fireEvent.press(getByTestId('coach-community-events-create-submit'));
    expect(mockMutate.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Workshop', starts_at: '2026-08-01T18:00:00Z' }),
      expect.any(Object),
    );
  });

  it('advances lifecycle state from the manage modal', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { events: [makeEvent({ id: 'ev-9', state: 'scheduled' })], next_before: null },
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
      data: { events: [makeEvent({ id: 'ev-7', state: 'live' })], next_before: null },
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

  it('reflects (closes) an event from the manage modal', () => {
    mockEventHooks.list = {
      ...mockEventHooks.list,
      data: { events: [makeEvent({ id: 'ev-5', state: 'replay' })], next_before: null },
    };
    const { getByTestId } = render(<CoachCommunityEventsScreen />);
    fireEvent.press(getByTestId('coach-community-event-row-ev-5'));
    fireEvent.press(getByTestId('coach-community-events-reflect'));
    expect(mockMutate.reflect).toHaveBeenCalledWith(undefined, expect.any(Object));
  });
});
