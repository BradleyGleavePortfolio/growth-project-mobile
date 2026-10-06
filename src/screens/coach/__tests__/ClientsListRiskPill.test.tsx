/**
 * S-REACH: the risk board (GET /coach/clients/risk-board) had its only entry
 * on the retired Dashboard screen, which nothing opens. The Clients header
 * now carries an "At risk" pill for the roles the route serves (coach,
 * owner); other roles never see a pill that would lead to a refusal.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

let mockUser: { id: string; role?: string } | null = { id: 'c1', role: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../store/coachStore', () => ({
  useCoachStore: () => ({
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
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
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

type Nav = React.ComponentProps<typeof ClientsListScreen>['navigation'];
const navigate = jest.fn();
async function mount() {
  // Only navigate() is read by the header.
  const navigation: Pick<Nav, 'navigate'> = { navigate };
  return await render(<ClientsListScreen navigation={navigation as Nav} />);
}

beforeEach(() => navigate.mockReset());

it.each(['coach', 'owner'])('%s: the At risk pill opens the risk board', async (role) => {
  mockUser = { id: 'c1', role };
  await mount();
  await fireEvent.press(screen.getByTestId('clients-risk-pill'));
  expect(navigate).toHaveBeenCalledWith('RiskBoard');
});

it.each(['sub_coach', 'student', undefined])('role %s: no At risk pill', async (role) => {
  mockUser = { id: 'c1', role };
  await mount();
  expect(screen.queryByTestId('clients-risk-pill')).toBeNull();
  expect(screen.getByTestId('clients-invite-pill')).toBeTruthy();
});
