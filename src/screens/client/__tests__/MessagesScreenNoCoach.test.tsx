/**
 * Client Messages without a coach (#306 r5, owner 2026-10-01 13:28): a
 * coachless client is a complete state, so this screen says what is
 * missing and offers a working next step (Contact support) instead of
 * "use it when you sign up", which a signed-up client cannot do.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
  ThemeColors: {},
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
  },
  prefsStorage: {
    getString: () => undefined,
    getStringAsync: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
  },
}));
const mockList = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: [] })), post: jest.fn(), delete: jest.fn() },
  messagesApi: {
    list: (...a: unknown[]) => mockList(...a),
    coachReview: jest.fn(async () => ({ data: { coachReviewedAt: null } })),
    send: jest.fn(),
    markRead: jest.fn(async () => ({ data: {} })),
  },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1' }) }));
jest.mock('../../../hooks/useBlockedUsersHydration', () => ({
  useBlockedUsersHydration: () => ({ serverHydrationComplete: true }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));

const mockParentNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: mockGoBack,
      navigate: jest.fn(),
      getParent: () => ({ navigate: mockParentNavigate }),
    }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const React = jest.requireActual('react');
      React.useEffect(() => cb(), [cb]);
    },
  };
});

import MessagesScreen from '../MessagesScreen';

describe('client MessagesScreen with no coach', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockRejectedValue({ response: { status: 409, data: { code: 'NO_COACH_ASSIGNED' } } });
  });

  it('explains the state truthfully and Contact support opens the support inbox', async () => {
    const utils = await render(<MessagesScreen />);
    expect(await utils.findByText('No coach connected')).toBeTruthy();
    expect(utils.queryByText(/when you sign up/)).toBeNull();
    expect(utils.queryByText(/No coach yet/)).toBeNull();
    await fireEvent.press(utils.getByTestId('messages-no-coach-support'));
    expect(mockParentNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'SupportInbox' });
  });
});
