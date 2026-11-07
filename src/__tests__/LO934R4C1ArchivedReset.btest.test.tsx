/** LO-934R4 C1 (not a B): the Archived-to-Active reset on the Home Needs you tap races the stale focus reload. Fails at cbb4edcb. */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
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

const listeners: Record<string, Array<() => void>> = {};
const navigation = {
  navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true, getParent: () => undefined,
  addListener: (ev: string, f: () => void) => {
    (listeners[ev] ??= []).push(f);
    return () => { listeners[ev] = listeners[ev].filter((g) => g !== f); };
  },
};
const wire = (id: string, archived = false) => ({
  id, name: `${id} Client`, role: 'client', coach_id: 'coach-1',
  created_at: '2026-06-09T10:00:00Z', archived_at: archived ? '2026-11-01T10:00:00Z' : null,
  activity: { shared: true, last_active_on: '2026-01-01', check_ins_to_review: 0 },
});
const focus = () => (listeners.focus ?? []).forEach((f) => f());

/** The lookup left on Archived, the Clients tab already focused once; then the Home's Needs you tap. */
async function tapFromArchived(hold: 'active' | 'archived') {
  const held: Array<() => void> = [];
  let holding = false;
  mockClients.mockImplementation((status: string) => {
    const reply = { data: [status === 'archived' ? wire('arch', true) : wire('act')] };
    if (holding && status === hold) return new Promise((res) => { held.push(() => res(reply)); });
    return Promise.resolve(reply);
  });
  await useCoachStore.getState().loadClients('coach-1', 'active');
  const view = await render(<ClientLookupScreen navigation={navigation as never} route={{ params: {} } as never} />);
  await act(async () => { focus(); }); // the mount's own focus
  await act(async () => { useCoachStore.getState().setFilterStatus('archived'); });
  await waitFor(() => expect(useCoachStore.getState().clients.map((c) => c.id)).toEqual(['arch']));
  holding = true;
  // CommandCenterScreen.tsx:130: params { view: 'needs' } and the tab's focus arrive in one navigation.
  await act(async () => {
    view.rerender(<ClientLookupScreen navigation={navigation as never} route={{ params: { view: 'needs' } } as never} />);
    focus();
  });
  return { view, release: async () => { await act(async () => { held.splice(0).forEach((r) => r()); }); } };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(listeners)) delete listeners[k];
  useCoachStore.getState().reset();
});

it('C1a: while the Active read is on its way, Needs you never lists the archived client', async () => {
  const { view, release } = await tapFromArchived('active');
  expect(useCoachStore.getState().filterStatus).toBe('active');
  expect(view.queryByTestId('needs-row-arch')).toBeNull();
  await release();
});

it('C1b: when the stale Archived reply lands last, Needs you still lists the Active roster', async () => {
  const { view, release } = await tapFromArchived('archived');
  await release();
  await waitFor(() => expect(view.queryByTestId('needs-loading')).toBeNull());
  expect(useCoachStore.getState().clients.map((c) => c.id)).toEqual(['act']);
  expect(view.queryByTestId('needs-row-arch')).toBeNull();
});

it('control: with no Archived detour the tap lists the Active roster only', async () => {
  mockClients.mockImplementation((status: string) => Promise.resolve({ data: [status === 'archived' ? wire('arch', true) : wire('act')] }));
  await useCoachStore.getState().loadClients('coach-1', 'active');
  const view = await render(<ClientLookupScreen navigation={navigation as never} route={{ params: { view: 'needs' } } as never} />);
  await waitFor(() => expect(view.queryByTestId('needs-row-act')).toBeTruthy());
  expect(view.queryByTestId('needs-row-arch')).toBeNull();
});
