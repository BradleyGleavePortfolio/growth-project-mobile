/**
 * C-S-PUSH-3: a fresh coach install never saw the OS notification ask (the
 * opt-in card lived only on client Home), so client messages and new-client
 * alerts never reached the coach. The coach landing screen (Clients) now
 * mounts the same deferred card: shown once while the OS can still ask,
 * dismissible, and "Turn on" registers the token through the existing path.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGetPerms = jest.fn();
jest.mock('expo-notifications', () => ({ getPermissionsAsync: () => mockGetPerms() }));
const mockRegister = jest.fn();
jest.mock('../../../services/pushNotifications', () => ({
  registerForPushNotifications: (o: unknown) => mockRegister(o),
}));
const mockUpdate = jest.fn((_t: string) => Promise.resolve());
jest.mock('../../../services/api', () => ({ usersApi: { updatePushToken: (t: string) => mockUpdate(t) } }));
const mockStore = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => mockStore.get(k),
    set: async (k: string, v: string) => void mockStore.set(k, v),
  },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }),
}));
jest.mock('../../../store/coachStore', () => ({
  useCoachStore: () => ({
    clients: [],
    isLoading: false,
    loadError: null,
    searchQuery: '',
    filterStatus: 'all',
    loadClients: jest.fn(),
    setSearchQuery: jest.fn(),
    setFilterStatus: jest.fn(),
    getFilteredClients: () => [],
  }),
}));
jest.mock('../../../theme/ThemeProvider', () => {
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => {
  const { Pressable } = jest.requireActual('react-native');
  return Pressable;
});
jest.mock('../../../ui/skeletons', () => ({ SkeletonClientCard: () => null }));
jest.mock('../../../ui/empty-states', () => ({
  EmptyStateNoClients: () => null,
  EmptyStateNoResults: () => null,
}));

import ClientsListScreen from '../ClientsListScreen';
import { pushPrimerDismissedKey } from '../../../components/home/PushPermissionCard';

type Nav = React.ComponentProps<typeof ClientsListScreen>['navigation'];
async function mount() {
  const navigation: Pick<Nav, 'navigate' | 'addListener'> = {
    navigate: jest.fn(),
    addListener: () => () => undefined,
  };
  return await render(<ClientsListScreen navigation={navigation as Nav} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
});

it('a fresh coach install sees the notification ask; Turn on registers the push token', async () => {
  mockGetPerms.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  mockRegister.mockResolvedValue({ token: 'coach-tok', granted: true });
  await mount();
  await screen.findByTestId('push-permission-card');
  expect(screen.getByText('Turn on notifications so you see client messages and bookings as they arrive.')).toBeTruthy();
  // The OS prompt only comes from the tap.
  expect(mockRegister).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('push-permission-enable'));
  await waitFor(() => expect(mockRegister).toHaveBeenCalledWith({ requestPermission: true }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('coach-tok'));
  await waitFor(() => expect(screen.queryByTestId('push-permission-card')).toBeNull());
});

it('Not now hides it for good (once per account)', async () => {
  mockGetPerms.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  await mount();
  await fireEvent.press(await screen.findByTestId('push-permission-dismiss'));
  await waitFor(() => expect(screen.queryByTestId('push-permission-card')).toBeNull());
  expect(mockStore.get(pushPrimerDismissedKey('coach-1'))).toBe('true');
  expect(mockRegister).not.toHaveBeenCalled();

  await mount();
  await new Promise((r) => setTimeout(r, 10));
  expect(screen.queryByTestId('push-permission-card')).toBeNull();
});

it('a coach who already allowed notifications sees no card', async () => {
  mockGetPerms.mockResolvedValue({ status: 'granted', canAskAgain: true });
  await mount();
  await new Promise((r) => setTimeout(r, 10));
  expect(screen.queryByTestId('push-permission-card')).toBeNull();
});
