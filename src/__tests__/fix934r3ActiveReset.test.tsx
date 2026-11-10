/** FIX-934R3 C2: independently prove Needs you retires Archived and renders the Active client rows. */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import ClientLookupScreen from '../screens/coach/lookup/ClientLookupScreen';
import { useCoachStore } from '../store/coachStore';

const mockClients = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: () => Promise.resolve({ data: {} }) },
  coachApi: {
    getClients: (...args: unknown[]) => mockClients(...args),
    getUnreadCounts: () => Promise.resolve({ data: { by_client: {} } }),
    sendNudge: jest.fn(),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({ readOpenAlerts: () => Promise.resolve([]) }));
jest.mock('../screens/coach/home-v11/blockList', () => ({
  needsYouReason: jest.requireActual('../screens/coach/home-v11/blockList').needsYouReason,
  useCoachBlockList: () => ({ blockedIds: [], known: true, loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../screens/coach/lookup/ClientPeekSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { lightImpact: jest.fn(), softImpact: jest.fn(), selection: jest.fn() },
}));
jest.mock('../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const navigation = {
  navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true,
  addListener: () => () => undefined, getParent: () => undefined,
};
const wire = (id: string, archived = false) => ({
  id, name: `${id} Client`, role: 'client', coach_id: 'coach-1',
  created_at: '2026-06-09T10:00:00Z', archived_at: archived ? '2026-11-01T10:00:00Z' : null,
  activity: { shared: true, last_active_on: '2026-01-01', check_ins_to_review: 0 },
});

beforeEach(() => {
  jest.clearAllMocks();
  useCoachStore.getState().reset();
  mockClients.mockImplementation((status) => Promise.resolve({ data: [wire(status === 'archived' ? 'archived' : 'active', status === 'archived')] }));
});

it.each(['active', 'archived'] as const)('entering Needs you from %s renders Active, never Archived or endless loading', async (status) => {
  await useCoachStore.getState().loadClients('coach-1', status);
  useCoachStore.getState().setFilterStatus(status);
  const view = await render(<ClientLookupScreen navigation={navigation as never}
    route={{ params: { view: 'needs' } } as never} />);
  await waitFor(() => {
    expect(useCoachStore.getState().filterStatus).toBe('active');
    expect(useCoachStore.getState().clients.map((client) => client.id)).toEqual(['active']);
    expect(view.queryByTestId('needs-row-active')).toBeTruthy();
    expect(view.queryByTestId('needs-row-archived')).toBeNull();
    expect(view.queryByTestId('needs-loading')).toBeNull();
    expect(view.getByTestId('needs-title').props.children).toBe('Needs you, 1');
  });
  expect(mockClients).toHaveBeenCalledWith('active', undefined, 50);
});
