/**
 * C6-M1S Community Home (C6CHAT-S-V2 c01, x1; MOCK-COMMX2): every row and
 * control lands on a real route, flags hide what has no page, the segment only
 * draws tabs that exist, the spaces stay flat (no invented layers or counts),
 * the coach row carries the real C3 unread count, and the drawer switches
 * space in place.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, goBack: jest.fn() }),
  useRoute: () => ({ params: { space: 'cohort', cohortId: 'c-everyone' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaInsetsContext: require('react').createContext(null),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', coach_id: 'coach-1' }) }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const mockFlags = { communityChallenges: false, communitySearch: false, communityClassroom: false };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

const mockHaptics = { selection: jest.fn(), error: jest.fn(), softImpact: jest.fn() };
jest.mock('../../../ui/haptics/haptics.service', () => ({
  get HapticService() {
    return mockHaptics;
  },
}));

let mockCoach: { name?: unknown } | Error = { name: 'Sam Rivera' };
let mockUnread = 3;
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      if (url === '/messages/unread-count') return { data: { total: mockUnread } };
      if (mockCoach instanceof Error) throw mockCoach;
      return { data: mockCoach };
    }),
  },
}));

const query = <T,>(data: T) => ({ data, isLoading: false, isError: false, refetch: jest.fn(async () => ({ isError: false })) });
let mockMe = query<unknown>({ feature_flag_state: 'enabled', workspace_id: 'ws-1', unread: { cohort_messages: 4, dm_messages: 0, mentions: 0 } });
let mockCohorts = query<unknown>({
  cohorts: [
    { id: 'c-ann', name: 'Announcements', kind: 'announcement' },
    { id: 'c-everyone', name: 'Everyone', kind: 'chat' },
    { id: 'c-section', name: 'Spring program', kind: 'section' },
  ],
});
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => mockMe,
  useCommunityCohorts: () => mockCohorts,
  useCommunityWorkspace: (id: string | null) => ({ data: id ? { name: "Sam's Strength Club" } : undefined }),
}));
jest.mock('../CommunityChallengesScreen', () => {
  const { Text } = require('react-native');
  return () => <Text testID="challenges-list">Challenges list</Text>;
});

import CommunityHomeScreen from '../CommunityHomeScreen';
import { SpaceListButton } from '../../../components/community/SpaceDrawer';
import { CommunityCohortSummarySchema } from '../../../api/communityApi';

const mount = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockFlags, { communityChallenges: false, communitySearch: false, communityClassroom: false });
  mockCoach = { name: 'Sam Rivera' };
  mockUnread = 3;
  mockMe = query({ feature_flag_state: 'enabled', workspace_id: 'ws-1', unread: { cohort_messages: 4, dm_messages: 0, mentions: 0 } });
  mockCohorts = query({
    cohorts: [
      { id: 'c-ann', name: 'Announcements', kind: 'announcement' },
      { id: 'c-everyone', name: 'Everyone', kind: 'chat' },
      { id: 'c-section', name: 'Spring program', kind: 'section' },
    ],
  });
});

describe('Community Home', () => {
  it('draws the masthead, the flat spaces in server order and the coach thread with its real count', async () => {
    await mount(<CommunityHomeScreen />);
    expect(screen.getByText("Sam's Strength Club")).toBeTruthy();
    expect(screen.getByText('S', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText('Announcements')).toBeTruthy();
    expect(screen.getByLabelText('Everyone')).toBeTruthy();
    // A section holds spaces; with no layers yet it is not drawn as a space.
    expect(screen.queryByText('Spring program')).toBeNull();
    // No invented per-space counts: the server's cohort total is not shown.
    expect(screen.queryByText(/new$/)).toBeNull();
    expect(screen.getByLabelText('Leaderboard, Private')).toBeTruthy();
    expect(await screen.findByLabelText('Sam, Your coach, 3 new')).toBeTruthy();
    expect(screen.getByTestId('space-row-coach-badge')).toBeTruthy();
    // One segment has no page to switch to, so no control is drawn.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByLabelText('Search messages and spaces')).toBeNull();
    expect(screen.queryByLabelText('Classroom')).toBeNull();
  });

  it('every row lands on a real route', async () => {
    Object.assign(mockFlags, { communitySearch: true, communityClassroom: true });
    await mount(<CommunityHomeScreen />);
    await fireEvent.press(screen.getByTestId('space-row-c-ann'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CommunitySpace', { space: 'cohort', cohortId: 'c-ann' });
    await fireEvent.press(screen.getByTestId('space-row-leaderboard'));
    expect(mockNavigate).toHaveBeenLastCalledWith('Leaderboard');
    await fireEvent.press(screen.getByTestId('space-row-classroom'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CommunityClassroom');
    await fireEvent.press(screen.getByTestId('space-row-coach'));
    expect(mockNavigate).toHaveBeenLastCalledWith('Home', { screen: 'Messages' });
    await fireEvent.press(screen.getByTestId('community-home-search'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CommunityFind');
    await fireEvent.press(screen.getByTestId('community-home-safety'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CommunitySafety');
  });

  it('Home then Challenges: a selection tick, the Challenges list, and back to Home', async () => {
    mockFlags.communityChallenges = true;
    await mount(<CommunityHomeScreen />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityState.selected)).toEqual([true, false]);
    await fireEvent.press(screen.getByTestId('community-home-tab-challenges'));
    expect(mockHaptics.selection).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('challenges-list')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('community-home-tab-challenges'));
    expect(mockHaptics.selection).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('community-home-tab-home'));
    expect(screen.getByTestId('space-row-c-ann')).toBeTruthy();
  });

  it('a section header folds its rows and says so', async () => {
    await mount(<CommunityHomeScreen />);
    const header = screen.getByTestId('space-section-spaces');
    expect(header.props.accessibilityState).toEqual({ expanded: true });
    await fireEvent.press(header);
    expect(screen.queryByTestId('space-row-c-ann')).toBeNull();
    expect(screen.getByTestId('space-section-spaces').props.accessibilityState).toEqual({ expanded: false });
  });

  it('without the coach name the row still opens the coach thread; 120 unread reads 99+', async () => {
    mockCoach = new Error('offline');
    mockUnread = 120;
    await mount(<CommunityHomeScreen />);
    expect(await screen.findByText('99+')).toBeTruthy();
    expect(screen.getByLabelText('Your coach, 99+ new')).toBeTruthy();
  });

  it('a community switched off on the server still shows the coach thread and Leaderboard', async () => {
    mockMe = query({ feature_flag_state: 'disabled', workspace_id: null, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } });
    mockCohorts = query(undefined);
    await mount(<CommunityHomeScreen />);
    expect(screen.getByText('Community')).toBeTruthy();
    expect(screen.queryByTestId('space-row-c-ann')).toBeNull();
    expect(screen.getByTestId('space-row-leaderboard')).toBeTruthy();
    expect(screen.getByTestId('space-row-coach')).toBeTruthy();
  });

  it('loading is a still skeleton; a failed read offers Try again and ticks an error when it fails again', async () => {
    mockMe = { ...query(undefined), isLoading: true };
    const view = await mount(<CommunityHomeScreen />);
    expect(screen.getByLabelText('Loading your community')).toBeTruthy();
    mockMe = { ...query(undefined), isError: true, refetch: jest.fn(async () => ({ isError: true })) };
    await view.rerender(<QueryClientProvider client={new QueryClient()}><CommunityHomeScreen /></QueryClientProvider>);
    expect(screen.getByText('Your community did not load. Check your connection, then try again.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('community-home-retry'));
    expect(mockMe.refetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockHaptics.error).toHaveBeenCalledTimes(1));
  });
});

describe('Space list drawer', () => {
  it('opens on the same tree with the open space selected, filters by name, and swaps the space in place', async () => {
    await mount(<SpaceListButton />);
    await fireEvent.press(screen.getByLabelText('Open space list'));
    expect(screen.getByTestId('space-list')).toBeTruthy();
    expect(screen.getByTestId('space-row-c-everyone').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('space-row-c-ann').props.accessibilityState).toEqual({ selected: false });
    await fireEvent.changeText(screen.getByLabelText('Jump to a space or person'), 'ann');
    expect(screen.queryByTestId('space-row-c-everyone')).toBeNull();
    await fireEvent.press(screen.getByTestId('space-row-c-ann'));
    expect(mockReplace).toHaveBeenCalledWith('CommunitySpace', { space: 'cohort', cohortId: 'c-ann' });
  });

  it('the coach row in the drawer opens the coach thread', async () => {
    await mount(<SpaceListButton />);
    await fireEvent.press(screen.getByLabelText('Open space list'));
    await fireEvent.changeText(screen.getByLabelText('Jump to a space or person'), 'sam');
    await fireEvent.press(await screen.findByTestId('space-row-coach'));
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  });
});

describe('m#871 Sol B5: per-space unread counts (SC-BE2 unread_count)', () => {
  it.each([[0, null], [3, '3'], [99, '99+']] as const)('%i unread: the badge reads %s on Home and in the drawer', async (n, shown) => {
    mockCohorts = query({ cohorts: [{ id: 'c-everyone', name: 'Everyone', kind: 'chat', unread_count: n }] });
    const check = () => (shown ? expect(within(screen.getByTestId('space-row-c-everyone-badge')).getByText(shown)).toBeTruthy()
      : expect(screen.queryByTestId('space-row-c-everyone-badge')).toBeNull());
    const view = await mount(<CommunityHomeScreen />);
    check();
    expect(screen.getByLabelText(shown ? `Everyone, ${shown} new` : 'Everyone')).toBeTruthy();
    await view.unmount();
    await mount(<SpaceListButton />);
    await fireEvent.press(screen.getByLabelText('Open space list'));
    check();
  });

  it('the cohort parser keeps a whole count and drops a bad or missing one without failing the list', () => {
    const row = { id: '11111111-1111-4111-8111-111111111111', workspace_id: '22222222-2222-4222-8222-222222222222', name: 'Everyone', is_default: true, member_count: 3, my_role: 'client' };
    expect(CommunityCohortSummarySchema.parse({ ...row, unread_count: 3 }).unread_count).toBe(3);
    expect(CommunityCohortSummarySchema.parse({ ...row, unread_count: -1 }).unread_count).toBeUndefined();
    expect(CommunityCohortSummarySchema.parse({ ...row, unread_count: 'x' }).unread_count).toBeUndefined();
    expect(CommunityCohortSummarySchema.parse(row).unread_count).toBeUndefined();
  });
});
