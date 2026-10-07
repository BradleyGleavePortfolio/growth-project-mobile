/**
 * Client Messages without a coach (#306 r5, owner 2026-10-01 13:28): a
 * coachless client is a complete state, so this screen says what is
 * missing and offers a working next step (Contact support) instead of
 * "use it when you sign up", which a signed-up client cannot do.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CoachCodeSheetProps } from '../../../components/coachless/CoachCodeSheet';

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
let mockCoachlessEnabled = true;
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { messaging_core_v2: false, coachless_home: mockCoachlessEnabled } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1' }) }));
jest.mock('../../../hooks/useBlockedUsersHydration', () => ({
  useBlockedUsersHydration: () => ({ serverHydrationComplete: true }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
let mockSheetProps: CoachCodeSheetProps;
jest.mock('../../../components/coachless/CoachCodeSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return (props: CoachCodeSheetProps) => {
    mockSheetProps = props;
    return <Text testID="mock-coach-code-sheet">Coach code sheet</Text>;
  };
});

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
    mockCoachlessEnabled = true;
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

  it('opens the existing code sheet and refreshes the thread after connecting', async () => {
    const utils = await render(<MessagesScreen />);
    await utils.findByText('No coach connected');
    expect(utils.queryByText(/code from a coach, contact support/)).toBeNull();
    await fireEvent.press(utils.getByTestId('messages-no-coach-code'));
    expect(utils.getByTestId('mock-coach-code-sheet')).toBeTruthy();
    mockList.mockResolvedValue({ data: [] });
    await act(async () => mockSheetProps.onAttached({
      status: 'attached',
      already_attached: false,
      coach: { id: 'coach-2', name: 'Coach Two', photo_url: null, business_name: null, bio: null },
      next: { featured_package: null, packages_available: 0 },
      grant: null,
      replayed: false,
    }));
    await waitFor(() => expect(utils.queryByText('No coach connected')).toBeNull());
    expect(utils.getByTestId('mock-coach-code-sheet')).toBeTruthy();
  });

  it('retains the support fallback when coach codes are unavailable', async () => {
    mockCoachlessEnabled = false;
    const utils = await render(<MessagesScreen />);
    await utils.findByText('No coach connected');
    expect(utils.queryByTestId('messages-no-coach-code')).toBeNull();
    expect(utils.getByTestId('messages-no-coach-support')).toBeTruthy();
  });

  it('hands the sheet plan action to the existing coaching-plan screen', async () => {
    const utils = await render(<MessagesScreen />);
    await utils.findByText('No coach connected');
    await fireEvent.press(utils.getByTestId('messages-no-coach-code'));
    await act(async () => mockSheetProps.onChoosePlan(null));
    expect(mockParentNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'ClientPackages' });
  });
});
