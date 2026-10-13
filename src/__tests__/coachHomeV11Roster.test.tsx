/**
 * UI-2 second PR (featureFlags.coachHomeV11): the chips filter the roster section with real counts, the Steady
 * wall draws a ring only from a shared log day, every face and tile opens that client, and the tiles carry the
 * client's unread messages and the Clients list's "Logged ..." words.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { RosterClient } from '../utils/coach/clientRoster';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('react-native-svg', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const El = ({ children, testID }: { children?: React.ReactNode; testID?: string }) => R.createElement(View, { testID }, children);
  return { __esModule: true, default: El, Circle: El };
});
const mockHaptics = { softImpact: jest.fn(), mediumImpact: jest.fn(), selection: jest.fn() };
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: mockHaptics }));
const mockOverview = jest.fn();
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  commandCenterApi: { getOverview: () => mockOverview() },
}));
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => Promise.resolve(0) }));
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => ({ data: { drafts: [] }, refetch: jest.fn() }) }));
jest.mock('../lib/userCache', () => ({ ...jest.requireActual('../lib/userCache'), readUserCache: () => Promise.resolve({ id: 'coach-b' }) }));

// Required after the mocks above exist (an import would be hoisted above them).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CoachHomeV11 = require('../screens/coach/home-v11/CoachHomeV11').default as React.ComponentType<Record<string, unknown>>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { localDay, wallRing, filterChips } = require('../screens/coach/home-v11/rosterWall') as typeof import('../screens/coach/home-v11/rosterWall');

const DAY = 86_400_000;
const dayAgo = (n: number) => localDay(new Date(Date.now() - n * DAY));
const client = (id: string, name: string, activity: RosterClient['activity'], status: 'active' | 'archived' = 'active'): RosterClient => {
  const [firstName, ...rest] = name.split(' ');
  return {
    id, role: 'client', email: '', passwordHash: '', firstName, lastName: rest.join(' '), status,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', activity,
  } as RosterClient;
};
const shared = (lastActiveOn: string | null) => ({ shared: true, lastActiveOn, checkInsToReview: null });
const entry = (id: string, name: string, factor: string) => ({
  user_id: id, display_name: name, bucket: 'amber', risk_score: null, last_active_at: new Date().toISOString(), top_factor: factor, days_since_checkin: 8,
});
const overview = { roster_size: 5, active_today: 2, check_in_rate_7day: 0.8, open_alerts: 0, at_risk_count: 2, win_streak_count: 9, unread_messages: 3, pending_actions: 0 };
const roster = () => [
  client('c1', 'Casey Lin', shared(dayAgo(8))),
  client('c2', 'Ana Ruiz', null),
  client('s1', 'Hana Mori', shared(dayAgo(0))),
  client('s2', 'Noah Kim', shared(dayAgo(1))),
  client('s3', 'Ivy Brook', { shared: false, lastActiveOn: null, checkInsToReview: null }),
  client('x1', 'Zed Archer', shared(dayAgo(0)), 'archived'),
];

const sources = { monthSoFar: jest.fn(), nextPayout: jest.fn(), ltv: jest.fn(), atRisk: jest.fn() };
const rosterSources = { clients: jest.fn(), winStreaks: jest.fn(), unreadByClient: jest.fn() };
const props = {
  onSelectClient: jest.fn(), onOpenClients: jest.fn(), onOpenMoney: jest.fn(), onOpenDrafts: jest.fn(), onOpenNotifications: jest.fn(),
  sources, rosterSources,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOverview.mockResolvedValue({ data: overview });
  sources.monthSoFar.mockResolvedValue({ currency: 'usd', changeCents: null, totals: { netCents: 0, chargeCount: 0 } });
  sources.nextPayout.mockResolvedValue(null);
  sources.ltv.mockResolvedValue(null);
  sources.atRisk.mockResolvedValue([entry('c1', 'Casey Lin', 'No check-in for 8 days'), entry('c2', 'Ana Ruiz', 'Payment failed')]);
  rosterSources.clients.mockResolvedValue(roster());
  rosterSources.winStreaks.mockResolvedValue([
    { user_id: 's1', display_name: 'Hana Mori', streak_days: 12, streak_type: 'workout', streak_started_at: '2026-10-01' },
  ]);
  rosterSources.unreadByClient.mockResolvedValue({ c1: 3 });
});

async function renderHome(waitFor_ = 'coach-home-v11-chips') {
  const view = await render(<CoachHomeV11 {...props} />);
  await waitFor(() => expect(view.getByTestId('coach-home-v11-dials')).toBeTruthy());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  if (waitFor_) await waitFor(() => expect(view.getByTestId(waitFor_)).toBeTruthy());
  return view;
}

describe('UI-2 roster section', () => {
  it('shows real counts on the chips, the needs-you tiles first, then the Steady wall', async () => {
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-chip-needs').props.accessibilityLabel).toBe('Needs you, 2');
    expect(v.getByTestId('coach-home-v11-chip-needs').props.accessibilityState).toEqual({ selected: true });
    expect(v.getByTestId('coach-home-v11-chip-steady').props.accessibilityLabel).toBe('Steady, 3');
    expect(v.getByTestId('coach-home-v11-chip-streaks').props.accessibilityLabel).toBe('Streaks, 9');
    expect(v.queryByText('New')).toBeNull();

    expect(v.getByTestId('coach-home-v11-client-c1').props.accessibilityLabel).toBe('Casey Lin. Last logged 8 days ago. No check-in for 8 days. 3 unread');
    expect(v.getByTestId('coach-home-v11-client-c1-unread')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-client-c2').props.accessibilityLabel).toBe('Ana Ruiz. Active today. Payment failed');
    expect(v.queryByTestId('coach-home-v11-client-c2-unread')).toBeNull();

    expect(v.getByText('Steady, 3')).toBeTruthy();
    expect(v.getByText('1 logged today')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-wall-legend')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-wall-s1-logged')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-wall-s2-notYet')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-wall-s3-unknown')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-wall-s1').props.accessibilityLabel).toBe('Hana Mori. Logged today');
    expect(v.getByTestId('coach-home-v11-wall-s3').props.accessibilityLabel).toBe('Ivy Brook');
    // Needs-you clients and archived clients are never on the wall.
    expect(v.queryByTestId('coach-home-v11-wall-c1')).toBeNull();
    expect(v.queryByTestId('coach-home-v11-wall-x1')).toBeNull();
  });

  it('Steady shows the wall alone, Streaks the streak tiles, with a selection haptic and every tap opening its client', async () => {
    const v = await renderHome();
    await fireEvent.press(v.getByTestId('coach-home-v11-wall-s2'));
    expect(props.onSelectClient).toHaveBeenCalledWith('s2', 'Noah Kim');
    expect(mockHaptics.softImpact).toHaveBeenCalled();

    await fireEvent.press(v.getByTestId('coach-home-v11-chip-steady'));
    expect(mockHaptics.selection).toHaveBeenCalledTimes(1);
    expect(v.getByTestId('coach-home-v11-chip-steady').props.accessibilityState).toEqual({ selected: true });
    expect(v.queryByTestId('coach-home-v11-client-c1')).toBeNull();
    expect(v.getByTestId('coach-home-v11-wall')).toBeTruthy();

    await fireEvent.press(v.getByTestId('coach-home-v11-chip-streaks'));
    expect(v.queryByTestId('coach-home-v11-wall')).toBeNull();
    expect(v.getByTestId('coach-home-v11-streak-s1').props.accessibilityLabel).toBe('Hana Mori. Training streak. 12 days');
    await fireEvent.press(v.getByTestId('coach-home-v11-streak-s1'));
    expect(props.onSelectClient).toHaveBeenCalledWith('s1', 'Hana Mori');
    await fireEvent.press(v.getByTestId('coach-home-v11-all-clients'));
    expect(props.onOpenClients).toHaveBeenCalled();

    // A second tap on the selected chip changes nothing.
    await fireEvent.press(v.getByTestId('coach-home-v11-chip-streaks'));
    expect(mockHaptics.selection).toHaveBeenCalledTimes(2);
  });

  it('a lone chip is a heading in the same pill, never a button that does nothing', async () => {
    mockOverview.mockResolvedValue({ data: { ...overview, at_risk_count: 0, win_streak_count: 0 } });
    sources.atRisk.mockResolvedValue([]);
    rosterSources.winStreaks.mockResolvedValue([]);
    const v = await renderHome();
    const chip = v.getByTestId('coach-home-v11-chip-steady');
    expect(chip.props.accessibilityRole).toBe('header');
    expect(chip.props.accessibilityLabel).toBe('Steady, 5');
    expect(v.queryByTestId('coach-home-v11-chip-needs')).toBeNull();
    expect(v.getByTestId('coach-home-v11-wall')).toBeTruthy();
  });

  it('leaves the wall and the Steady chip out when the roster does not load', async () => {
    rosterSources.clients.mockRejectedValue(new Error('offline'));
    const v = await renderHome();
    expect(v.queryByTestId('coach-home-v11-chip-steady')).toBeNull();
    expect(v.queryByTestId('coach-home-v11-wall')).toBeNull();
    expect(v.getByTestId('coach-home-v11-client-c1').props.accessibilityLabel).toBe('Casey Lin. Active today. No check-in for 8 days. 3 unread');
  });

  it('draws no ring, count or legend when no steady client shares logs', async () => {
    rosterSources.clients.mockResolvedValue([client('c1', 'Casey Lin', null), client('c2', 'Ana Ruiz', null), client('s1', 'Hana Mori', null)]);
    const v = await renderHome('coach-home-v11-wall');
    expect(v.getByTestId('coach-home-v11-wall-s1-unknown')).toBeTruthy();
    expect(v.queryByTestId('coach-home-v11-wall-legend')).toBeNull();
    expect(v.queryByText(/logged today/)).toBeNull();
  });

  it('shows no chips and no wall until the needs-you list answers', async () => {
    sources.atRisk.mockReturnValue(new Promise(() => undefined));
    const v = await renderHome('');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(v.queryByTestId('coach-home-v11-chips')).toBeNull();
    expect(v.queryByTestId('coach-home-v11-wall')).toBeNull();
    expect(v.getByTestId('coach-home-v11-all-clients')).toBeTruthy();
  });

  it('past 24 steady clients the last place shows how many more and opens Clients', async () => {
    const many = Array.from({ length: 30 }, (_, i) => client(`m${i}`, `Client ${String(i).padStart(2, '0')}`, shared(dayAgo(0))));
    rosterSources.clients.mockResolvedValue(many);
    mockOverview.mockResolvedValue({ data: { ...overview, roster_size: 32 } });
    const v = await renderHome('coach-home-v11-wall');
    expect(v.getByText('Steady, 30')).toBeTruthy();
    expect(v.getByText('+7')).toBeTruthy();
    expect(v.queryByTestId('coach-home-v11-wall-m23')).toBeNull();
    await fireEvent.press(v.getByTestId('coach-home-v11-wall-more'));
    expect(props.onOpenClients).toHaveBeenCalled();
    expect(v.getByTestId('coach-home-v11-wall-more').props.accessibilityLabel).toBe('All 32 clients. Open Clients');
  });
});

describe('UI-2 roster reads', () => {
  it('a failed roster read never hands the Home the rows already in the shared roster store', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useCoachStore } = require('../store/coachStore') as typeof import('../store/coachStore');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { coachApi } = require('../services/api') as typeof import('../services/api');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rosterSources: real } = require('../screens/coach/home-v11/rosterSources') as typeof import('../screens/coach/home-v11/rosterSources');
    useCoachStore.setState({ clients: roster(), loadError: null });
    const read = jest.spyOn(coachApi, 'getClients').mockRejectedValue(new Error('offline'));
    await expect(real.clients()).rejects.toThrow();
    expect(read).toHaveBeenCalled();
    // The store keeps its old rows for the Clients list; the Home's read refuses them.
    expect(useCoachStore.getState().clients).toHaveLength(6);
    read.mockRestore();
    useCoachStore.getState().reset();
  });

  it("a previous coach's late roster never reaches the next coach's store, whether the next read fails or loads", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useCoachStore } = require('../store/coachStore') as typeof import('../store/coachStore');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { coachApi } = require('../services/api') as typeof import('../services/api');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rosterSources: real } = require('../screens/coach/home-v11/rosterSources') as typeof import('../screens/coach/home-v11/rosterSources');
    const store = useCoachStore.getState;
    let answerA: (v: unknown) => void = () => undefined;
    let failA: (e: unknown) => void = () => undefined;
    const read = jest.spyOn(coachApi, 'getClients')
      .mockImplementationOnce((() => new Promise((ok) => { answerA = ok; })) as never)
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce((() => new Promise((_ok, no) => { failA = no; })) as never)
      .mockResolvedValueOnce({ data: [{ id: 'b-client-1', name: 'Client B' }] } as never);
    // Coach A's read is still out when A signs out (reset), and coach B's first read fails.
    const lateA = store().loadClients('coach-a', 'active', { silent: true });
    store().reset();
    await expect(real.clients()).rejects.toThrow();
    answerA({ data: [{ id: 'a-client-1', name: 'Client A' }] });
    await lateA;
    expect(store().clients).toEqual([]);
    expect(store().loadError).not.toBeNull();
    // A late failure from before a sign-out does not mark B's loaded roster as failed.
    const lateFail = store().loadClients('coach-a');
    store().reset();
    await expect(real.clients()).resolves.toHaveLength(1);
    failA(new Error('offline'));
    await lateFail;
    expect(store()).toMatchObject({ loadError: null, isLoading: false });
    expect(store().clients.map((c) => c.id)).toEqual(['b-client-1']);
    read.mockRestore();
    store().reset();
  });
});

describe('UI-2 roster rules', () => {
  it('rings from a shared log day only; a day ahead of the device (time zones) still reads as today', () => {
    const now = new Date();
    expect(wallRing(client('a', 'A B', shared(localDay(now))), now)).toBe('logged');
    expect(wallRing(client('a', 'A B', shared(localDay(new Date(now.getTime() + DAY)))), now)).toBe('logged');
    expect(wallRing(client('a', 'A B', shared(null)), now)).toBe('notYet');
    expect(wallRing(client('a', 'A B', { shared: false, lastActiveOn: localDay(now), checkInsToReview: null }), now)).toBe('unknown');
    expect(wallRing(client('a', 'A B', null), now)).toBe('unknown');
  });

  it('offers only chips with something behind them, in the mockup order', () => {
    expect(filterChips(7, 23, 9).map((c) => `${c.label} ${c.count}`)).toEqual(['Needs you 7', 'Steady 23', 'Streaks 9']);
    expect(filterChips(0, null, 0)).toEqual([]);
    expect(filterChips(0, 4, 0).map((c) => c.key)).toEqual(['steady']);
  });
});
