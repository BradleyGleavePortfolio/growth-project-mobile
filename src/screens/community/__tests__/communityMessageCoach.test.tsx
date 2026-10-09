/**
 * C-F6-1: Community "Send your coach a message".
 *
 *   - Today (no cohort yet) with community DMs OFF used to call nothing; it now
 *     opens the 1:1 coach Messages screen in the Home stack (Home > Messages),
 *     the same target as the m#389 no-workspace state.
 *   - With DMs ON it still opens the community DM inbox.
 *   - A client with no coach sees no message button on either surface.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

let mockUser: { id: string; firstName: string; name: string; coach_id?: string } = {
  id: 'me-1',
  firstName: 'Dana',
  name: 'Dana',
  coach_id: 'coach-1',
};
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUser,
}));

const mockFlags = {
  communityHall: true,
  communityDm: false,
  communityEvents: true,
  communityChallenges: true,
  communityVoiceNotes: false,
};
// Getter: the factory runs before `mockFlags` is initialised (jest.mock hoisting).
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaInsetsContext: jest.requireActual('react').createContext(null),
}));

const mockToday = {
  data: {
    feature_flag_state: {},
    cohort: null,
    event: null,
    pinned_post: null,
    challenge: null,
    empty_reason: 'no_membership',
  } as unknown,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
const mockPosts = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
const mockMe = { data: { workspace_id: null }, isLoading: false, isError: false, refetch: jest.fn() };
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityToday: () => mockToday,
  useCommunityMe: () => mockMe,
  usePosts: () => mockPosts,
}));

import CommunityTodayScreen from '../CommunityTodayScreen';
import CommunitySpaceScreen from '../CommunitySpaceScreen';

beforeEach(() => {
  mockNavigate.mockReset();
  mockFlags.communityDm = false;
  mockUser = { id: 'me-1', firstName: 'Dana', name: 'Dana', coach_id: 'coach-1' };
});

describe('Community Today "Send your coach a message" (C-F6-1)', () => {
  it('with community DMs off, opens the 1:1 coach Messages screen', async () => {
    await render(<CommunityTodayScreen />);
    expect(screen.getByText('No cohort yet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('community-today-empty-action'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  });

  it('with community DMs on, still opens the community DM inbox', async () => {
    mockFlags.communityDm = true;
    await render(<CommunityTodayScreen />);
    await fireEvent.press(screen.getByTestId('community-today-empty-action'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityDmList');
  });

  it('a client with no coach sees no message button', async () => {
    mockUser = { id: 'me-1', firstName: 'Dana', name: 'Dana' };
    await render(<CommunityTodayScreen />);
    expect(screen.getByText('No cohort yet')).toBeTruthy();
    expect(screen.queryByTestId('community-today-empty-action')).toBeNull();
    expect(screen.queryByText('Send your coach a message')).toBeNull();
  });
});

describe('Community no-workspace state "Send your coach a message" (C-F6-1)', () => {
  it('a client with a coach opens the 1:1 coach Messages screen', async () => {
    await render(<CommunitySpaceScreen space="hall" />);
    await fireEvent.press(screen.getByTestId('community-space-no-workspace-action'));
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  });

  it('a client with no coach sees no message button', async () => {
    mockUser = { id: 'me-1', firstName: 'Dana', name: 'Dana' };
    await render(<CommunitySpaceScreen space="hall" />);
    expect(screen.getByTestId('community-space-no-workspace')).toBeTruthy();
    expect(screen.queryByTestId('community-space-no-workspace-action')).toBeNull();
    expect(screen.queryByText('Send your coach a message')).toBeNull();
  });
});
