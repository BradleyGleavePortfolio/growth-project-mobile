/**
 * UX-COACHLOOKUP-124 — the coach's Clients list.
 *
 * B1: GET /coach/clients answers one page (20 rows by default). The roster
 *     read only that page, so a coach with more clients could not see,
 *     search or message anyone past the 20 newest, and the count said 20.
 * B2: loadClients() with no status (Home, Messages) read whatever filter the
 *     Clients list was left on, so after a look at Archived those screens
 *     listed archived clients only.
 * U:  each row showed only name, email and the word "active"; now it shows
 *     the last day the client logged anything shared, check-ins waiting for
 *     review and an Archived tag, sorted A to Z (or most recent log), with a
 *     count line, pull to refresh, refresh on return, a real All filter and
 *     an Archived empty state that does not offer the invite flow.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGetClients = jest.fn();
jest.mock('../../../services/api', () => ({
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a) },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }),
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
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../ui/empty-states', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    EmptyState: ({ headline }: { headline: string }) => <Text>{headline}</Text>,
    EmptyStateNoClients: () => <Text>Invite your first client</Text>,
    EmptyStateNoResults: () => <Text>No results</Text>,
    IconPeople: () => null,
  };
});

import ClientsListScreen from '../ClientsListScreen';
import { useCoachStore, ROSTER_PAGE_SIZE } from '../../../store/coachStore';
import {
  matchesRosterSearch,
  rosterActivityLine,
  rosterCountLine,
  sortRoster,
  type RosterClient,
} from '../../../utils/coach/clientRoster';

function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

type Activity = { shared: boolean; last_active_on: string | null; check_ins_to_review: number | null };
function wireRow(id: string, name: string, activity?: Activity, archived = false) {
  return {
    id,
    name,
    email: `${id}@example.test`,
    role: 'student',
    coach_id: 'coach-1',
    archived_at: archived ? '2026-09-20T00:00:00.000Z' : null,
    created_at: '2026-09-01T10:00:00.000Z',
    ...(activity ? { activity } : {}),
  };
}

type Nav = React.ComponentProps<typeof ClientsListScreen>['navigation'];
const navigate = jest.fn();
let focusListener: (() => void) | null = null;
async function mount() {
  // Only navigate() and the focus listener are read by the screen.
  const navigation = {
    navigate,
    addListener: (_type: string, cb: () => void) => {
      focusListener = cb;
      return () => undefined;
    },
  } as unknown as Nav;
  return await render(<ClientsListScreen navigation={navigation} />);
}

beforeEach(() => {
  mockGetClients.mockReset();
  navigate.mockReset();
  focusListener = null;
  useCoachStore.getState().reset();
});

describe('roster store', () => {
  it('B1: reads every page, so the 21st and later clients are listed and counted', async () => {
    const page1 = Array.from({ length: ROSTER_PAGE_SIZE }, (_, i) => wireRow(`c${i}`, `Client ${i}`));
    const page2 = Array.from({ length: 10 }, (_, i) => wireRow(`d${i}`, `Late ${i}`));
    mockGetClients.mockResolvedValueOnce({ data: page1 }).mockResolvedValueOnce({ data: page2 });

    await useCoachStore.getState().loadClients('coach-1');

    expect(useCoachStore.getState().clients).toHaveLength(ROSTER_PAGE_SIZE + 10);
    expect(mockGetClients).toHaveBeenNthCalledWith(1, 'active', undefined, ROSTER_PAGE_SIZE);
    expect(mockGetClients).toHaveBeenNthCalledWith(2, 'active', `c${ROSTER_PAGE_SIZE - 1}`, ROSTER_PAGE_SIZE);
    useCoachStore.getState().setSearchQuery('late 9');
    expect(useCoachStore.getState().getFilteredClients().map((c) => c.id)).toEqual(['d9']);
  });

  it('a page that fails fails the load: no partial roster shown as whole', async () => {
    const page1 = Array.from({ length: ROSTER_PAGE_SIZE }, (_, i) => wireRow(`c${i}`, `Client ${i}`));
    mockGetClients.mockResolvedValueOnce({ data: page1 }).mockRejectedValueOnce(new Error('offline'));
    await useCoachStore.getState().loadClients('coach-1');
    expect(useCoachStore.getState().clients).toHaveLength(0);
    expect(useCoachStore.getState().loadError).toBe('Clients did not load. Check the connection and try again.');
  });

  it('B2: no status reads active clients even after the list was left on Archived; All reads both', async () => {
    mockGetClients.mockResolvedValue({ data: [] });
    useCoachStore.getState().setFilterStatus('archived');
    await useCoachStore.getState().loadClients('coach-1');
    expect(mockGetClients).toHaveBeenLastCalledWith('active', undefined, ROSTER_PAGE_SIZE);
    await useCoachStore.getState().loadClients('coach-1', 'all');
    expect(mockGetClients).toHaveBeenLastCalledWith('all', undefined, ROSTER_PAGE_SIZE);
  });

  it('search matches every typed word across first name, last name and email', () => {
    const ana = { firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.test' };
    expect(matchesRosterSearch(ana, 'ana lo')).toBe(true);
    expect(matchesRosterSearch(ana, 'Ana ')).toBe(true);
    expect(matchesRosterSearch(ana, 'example')).toBe(true);
    expect(matchesRosterSearch(ana, 'ana smith')).toBe(false);
  });
});

describe('row helpers', () => {
  const base = {
    id: 'x',
    role: 'client' as const,
    email: 'x@example.test',
    passwordHash: '',
    firstName: 'Ana',
    lastName: 'Lopez',
    status: 'active' as const,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  };
  const client = (activity: RosterClient['activity'], extra: Partial<RosterClient> = {}): RosterClient => ({
    ...base,
    ...extra,
    activity,
  });

  it('says when the client last logged, and flags three quiet days', () => {
    expect(rosterActivityLine(client({ shared: true, lastActiveOn: localDay(0), checkInsToReview: 0 }))).toEqual({
      text: 'Logged today',
      tone: 'ok',
    });
    expect(rosterActivityLine(client({ shared: true, lastActiveOn: localDay(1), checkInsToReview: 0 })).text).toBe(
      'Logged yesterday',
    );
    expect(rosterActivityLine(client({ shared: true, lastActiveOn: localDay(4), checkInsToReview: 0 }))).toEqual({
      text: 'Last logged 4 days ago',
      tone: 'quiet',
    });
    expect(rosterActivityLine(client({ shared: true, lastActiveOn: null, checkInsToReview: 0 }))).toEqual({
      text: 'Joined Sep 1 · Nothing logged yet',
      tone: 'quiet',
    });
    expect(rosterActivityLine(client({ shared: false, lastActiveOn: null, checkInsToReview: null })).text).toBe(
      'Joined Sep 1 · Logs not shared',
    );
    // Older server: no activity block.
    expect(rosterActivityLine(client(null))).toEqual({ text: 'Joined Sep 1', tone: 'muted' });
  });

  it('sorts A to Z by default and by most recent log on request', () => {
    const rows = [
      client({ shared: true, lastActiveOn: localDay(5), checkInsToReview: 0 }, { id: 'b', firstName: 'Ben', lastName: 'Cho' }),
      client({ shared: true, lastActiveOn: localDay(0), checkInsToReview: 0 }, { id: 'z', firstName: 'Zoe', lastName: 'Park' }),
      client(null, { id: 'a', firstName: 'ana', lastName: 'Lopez' }),
    ];
    expect(sortRoster(rows, 'name').map((c) => c.id)).toEqual(['a', 'b', 'z']);
    expect(sortRoster(rows, 'recent').map((c) => c.id)).toEqual(['z', 'b', 'a']);
  });

  it('count line names the filter, the search narrowing and the check-ins waiting', () => {
    const rows = [
      client({ shared: true, lastActiveOn: null, checkInsToReview: 2 }),
      client({ shared: true, lastActiveOn: null, checkInsToReview: 1 }),
    ];
    expect(rosterCountLine(rows, 2, 'active', false)).toBe('2 active clients · 3 check-ins to review');
    expect(rosterCountLine(rows.slice(1), 12, 'all', true)).toBe('1 of 12 clients · 1 check-in to review');
    expect(rosterCountLine([], 1, 'archived', false)).toBe('1 archived client');
  });
});

describe('Clients list screen', () => {
  it('each row shows name, last log, check-ins to review; tap opens the client by name', async () => {
    mockGetClients.mockResolvedValue({
      data: [
        wireRow('c2', 'Zoe Park', { shared: true, last_active_on: localDay(0), check_ins_to_review: 0 }),
        wireRow('c1', 'Ana Lopez', { shared: true, last_active_on: localDay(6), check_ins_to_review: 2 }),
      ],
    });
    await mount();
    await screen.findByText('Ana Lopez');
    expect(screen.getByText('Last logged 6 days ago')).toBeTruthy();
    expect(screen.getByText('2 to review')).toBeTruthy();
    expect(screen.getByText('Logged today')).toBeTruthy();
    expect(screen.getByTestId('clients-count').props.children).toBe('2 active clients · 2 check-ins to review');
    // The email and the word "active" no longer fill every row.
    expect(screen.queryByText('c1@example.test')).toBeNull();
    expect(screen.queryByText('active')).toBeNull();

    // A to Z: Ana before Zoe although the server sends newest first.
    const rows = screen.getAllByTestId(/^client-row-/).map((r) => r.props.testID);
    expect(rows).toEqual(['client-row-c1', 'client-row-c2']);
    await fireEvent.press(screen.getByTestId('client-row-c1'));
    expect(navigate).toHaveBeenCalledWith('ClientDetail', { clientId: 'c1', clientName: 'Ana Lopez' });

    // Recent: Zoe logged today, Ana six days ago.
    await fireEvent.press(screen.getByTestId('clients-sort'));
    expect(screen.getAllByTestId(/^client-row-/).map((r) => r.props.testID)).toEqual(['client-row-c2', 'client-row-c1']);
  });

  it('All reads active and archived clients and tags the archived ones', async () => {
    mockGetClients.mockResolvedValue({ data: [] });
    await mount();
    await waitFor(() => expect(mockGetClients).toHaveBeenCalledWith('active', undefined, ROSTER_PAGE_SIZE));
    mockGetClients.mockResolvedValue({
      data: [wireRow('c1', 'Ana Lopez'), wireRow('c3', 'Old Client', undefined, true)],
    });
    await fireEvent.press(screen.getByTestId('clients-filter-all'));
    await screen.findByText('Old Client');
    expect(mockGetClients).toHaveBeenLastCalledWith('all', undefined, ROSTER_PAGE_SIZE);
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(2); // chip + tag
  });

  it('Archived with none says so instead of offering the first-client invite', async () => {
    mockGetClients.mockResolvedValue({ data: [] });
    await mount();
    await fireEvent.press(screen.getByTestId('clients-filter-archived'));
    expect(await screen.findByText('No archived clients')).toBeTruthy();
    expect(screen.queryByText('Invite your first client')).toBeNull();
  });

  it('coming back to the list reloads it in place', async () => {
    mockGetClients.mockResolvedValue({ data: [wireRow('c1', 'Ana Lopez')] });
    await mount();
    await screen.findByText('Ana Lopez');
    expect(focusListener).not.toBeNull();
    await act(async () => focusListener?.()); // first focus = the mount
    const before = mockGetClients.mock.calls.length;
    mockGetClients.mockResolvedValue({
      data: [wireRow('c1', 'Ana Lopez', { shared: true, last_active_on: localDay(0), check_ins_to_review: 1 })],
    });
    await act(async () => focusListener?.());
    expect(mockGetClients.mock.calls.length).toBe(before + 1);
    expect(await screen.findByText('1 to review')).toBeTruthy();
  });
});
