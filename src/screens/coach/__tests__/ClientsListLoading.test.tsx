import React from 'react';
import { render, screen } from '@testing-library/react-native';

let mockIsLoading = true;

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => null,
}));

jest.mock('../../../store/coachStore', () => ({
  useCoachStore: () => ({
    clients: [],
    isLoading: mockIsLoading,
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

jest.mock('../../../navigation/coachLanding', () => ({
  coachLandingTab: () => 'Overview',
}));

jest.mock('../../../ui', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Overline: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    useScreenInsets: () => ({ top: 0 }),
  };
});

jest.mock('../../../ui/skeletons', () => {
  const { View: NativeView } = jest.requireActual('react-native');
  return {
    SkeletonClientCard: () => <NativeView testID="clients-loading-skeleton" />,
  };
});

jest.mock('../../../ui/empty-states', () => ({
  EmptyState: () => null,
  EmptyStateNoClients: () => null,
  EmptyStateNoResults: () => null,
  IconPeople: () => null,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => {
  const { Pressable } = jest.requireActual('react-native');
  return Pressable;
});
jest.mock('../../../components/home/PushPermissionCard', () => () => null);

import ClientsListScreen from '../ClientsListScreen';

type Nav = React.ComponentProps<typeof ClientsListScreen>['navigation'];

beforeEach(() => {
  mockIsLoading = true;
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('renders the loading skeletons without passing FlatList layout props to a Fragment', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const navigation = {
    navigate: jest.fn(),
    addListener: () => () => undefined,
    isFocused: () => true,
  } as unknown as Nav;

  render(<ClientsListScreen navigation={navigation} />);

  expect(screen.getAllByTestId('clients-loading-skeleton')).toHaveLength(5);
  const fragmentLayoutErrors = consoleError.mock.calls.filter((args) => {
    const message = args.map(String).join(' ');
    return (
      message.includes('Invalid prop') &&
      message.includes('React.Fragment') &&
      message.includes('onLayout')
    );
  });
  expect(fragmentLayoutErrors).toEqual([]);
});
