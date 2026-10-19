/**
 * The rings Home's notice slot and refresh on open (agent 155/156 findings before the flag goes on):
 * today's Home notices, one at a time at the foot (the failed payment alone under the dials); every read again on a refocus and on a return
 * to the foreground; Health on this phone on first open and on each return to the app.
 */
import React from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';

let mockFocused = true;
const mockVisits = new Set<() => void>();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  // Focus as React Navigation runs it: the effect runs while focused and cleans up on blur.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const R = require('react');
    const [visit, setVisit] = R.useState(0);
    R.useEffect(() => {
      const bump = () => setVisit((n: number) => n + 1);
      mockVisits.add(bump);
      return () => { mockVisits.delete(bump); };
    }, []);
    R.useEffect(() => (mockFocused ? cb() : undefined), [cb, visit]);
  },
}));
const appState = new Set<(s: AppStateStatus) => void>();
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
  appState.add(handler as (s: AppStateStatus) => void);
  return { remove: () => appState.delete(handler as (s: AppStateStatus) => void) } as ReturnType<typeof AppState.addEventListener>;
});

const mockRefetch = {
  sleep: jest.fn(), fitness: jest.fn(), checkIn: jest.fn(), connections: jest.fn(), weight: jest.fn(), habits: jest.fn(), habitLogs: jest.fn(),
};
const mockRead = (refetch: jest.Mock) => ({ data: undefined, isSuccess: true, isError: false, refetch });
const mockConnectionsData = [{ id: 'conn1', provider: 'APPLE_HEALTHKIT', status: 'connected' }];
const mockInvalidate = jest.fn();
const mockRefreshOnDevice = jest.fn();
const mockUser = { id: 'u1', coach_id: 'c1', profile: { workout_days_per_week: 3 } };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useApi', () => ({
  useTodayCheckIn: () => mockRead(mockRefetch.checkIn),
  useWeightHistory: () => mockRead(mockRefetch.weight),
  useHabits: () => mockRead(mockRefetch.habits),
  useHabitLogs: () => mockRead(mockRefetch.habitLogs),
}));
jest.mock('../../../hooks/useWearableSamples', () => ({
  useWearableSamples: (args: { bucket: string }) => mockRead(args.bucket === 'HEALTH_FITNESS' ? mockRefetch.fitness : mockRefetch.sleep),
}));
jest.mock('../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => ({ ...mockRead(mockRefetch.connections), data: mockConnectionsData }),
  useInvalidateWearableConnections: () => mockInvalidate,
}));
jest.mock('../../../services/health/onDeviceSync', () => ({
  deviceSourceForPlatform: () => 'APPLE_HEALTHKIT',
  refreshOnDevice: (...args: unknown[]) => mockRefreshOnDevice(...args),
}));
let mockGeneration = 1;
jest.mock('../../../services/health/sessionFence', () => ({ currentAuthGeneration: () => mockGeneration }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => ({ logWater: jest.fn() }) }));
jest.mock('../../../components/home/HomeHeaderActions', () => () => null);
jest.mock('../../../components/coachless/CoachlessHomeSlot', () => () => null);
jest.mock('../../../components/home/rings/HomeRomanLine', () => () => null);

// Each of today's notices as a stand-in that asks the slot (due while its id is in mockDue) and prints its props.
const mockDue = new Set<NoticeId | 'dunning'>();
function MockNotice({ id, ...props }: { id: NoticeId }) {
  const shown = useNoticeSlot(id, mockDue.has(id));
  return shown ? <Text>{`${id} ${JSON.stringify(props)}`}</Text> : null;
}
function mockNotice(id: NoticeId, props: object) {
  return <MockNotice id={id} {...props} />;
}
const mockDunning = (p: object) => (mockDue.has('dunning') ? <Text>{`dunning ${JSON.stringify(p)}`}</Text> : null); // outside the slot
jest.mock('../../../entitlements/dunning/DunningBanner', () => ({ DunningBanner: (p: object) => mockDunning(p) }));
jest.mock('../../../components/PendingInviteBanner', () => (p: object) => mockNotice('invite', p));
jest.mock('../../../components/join/FinishJoining', () => (p: object) => mockNotice('finishJoining', p));
jest.mock('../../../components/home/ProfileNudge', () => (p: object) => mockNotice('profile', p));
jest.mock('../../../components/home/PushPermissionCard', () => (p: object) => mockNotice('push', p));
jest.mock('../../../components/home/CoachIntroductionBanner', () => (p: object) => mockNotice('coachIntro', p));
jest.mock('../../../components/home/FullMacrosIntroCard', () => (p: object) => mockNotice('fullMacros', p));
jest.mock('../../../components/tutorial/TutorialHomeSlot', () => (p: object) => mockNotice('tourReoffer', p));

import RingsHomeScreen, { type RingsHomeScreenProps } from '../home/RingsHomeScreen';
import { NOTICE_RANK, useNoticeSlot, type NoticeId } from '../../../components/home/HomeNoticeSlot';
import { logger } from '../../../utils/logger';

const onRefresh = jest.fn(async () => undefined);
const props: RingsHomeScreenProps = {
  day: {
    ready: true, error: null, retrying: false, calories: 1030, calorieTarget: 1850, carbsTarget: 200, fatTarget: 60,
    protein: 73, carbs: 100, fat: 38, proteinTarget: 150, simple: false, waterOz: 48,
  },
  workout: { history: [], assignments: [], exists: true, label: 'Start Full Body A', hint: '', onContinue: jest.fn(), hasCoachPlan: true },
  refreshing: false,
  onRefresh,
};
const focus = (on: boolean) => act(() => { mockFocused = on; mockVisits.forEach((bump) => bump()); });
const foreground = () => act(() => { appState.forEach((h) => h('background')); appState.forEach((h) => h('active')); });
const settle = () => act(async () => undefined); // a Health read finishes
const reads = () => Object.fromEntries(Object.entries(mockRefetch).map(([k, f]) => [k, f.mock.calls.length]));
const each = (n: number) => Object.fromEntries(Object.keys(mockRefetch).map((k) => [k, n]));

beforeEach(() => {
  jest.clearAllMocks();
  mockDue.clear();
  mockFocused = true;
  mockRefreshOnDevice.mockResolvedValue({ kind: 'imported', postedCount: 0, complete: true });
});

it.each<[NoticeId, string]>([
  ['invite', '{}'],
  ['finishJoining', '{}'],
  ['profile', '{"hasCoachPlan":true,"hasTargets":true}'],
  ['push', '{"presentation":"section"}'],
  ['coachIntro', '{}'],
  ['fullMacros', '{"carbsG":200,"fatG":60}'],
  ['tourReoffer', '{"part":"reoffer"}'],
])("%s, when due, shows in the slot at the foot, under the tiles, with today's Home props", async (id, given) => {
  mockDue.add(id);
  await render(<RingsHomeScreen {...props} />);
  expect(await screen.findByText(`${id} ${given}`)).toBeTruthy();
  const tree = JSON.stringify(screen.toJSON(), (k, v) => (k === 'refreshControl' ? undefined : v)); // an element, not a node
  const at = (testID: string) => tree.indexOf(`"${testID}"`);
  expect(at('home-tiles')).toBeGreaterThan(0);
  expect(at('home-notice-slot')).toBeGreaterThan(at('home-tiles'));
});

it('with every notice due, the failed payment shows alone under the dials and the invite in the slot at the foot (#RINGS-PAY-SLOT)', async () => {
  ['dunning' as const, ...NOTICE_RANK].reverse().forEach((id) => mockDue.add(id));
  await render(<RingsHomeScreen {...props} />);
  expect(await screen.findByText(/^invite /)).toBeTruthy();
  expect(screen.getAllByText(/^\w+ \{/).map((t) => String(t.props.children).split(' ')[0])).toEqual(['dunning', 'invite']);
  const tree = JSON.stringify(screen.toJSON(), (k, v) => (k === 'refreshControl' ? undefined : v));
  const at = ['"home-dials"', '"dunning {', '"home-tiles"', '"home-notice-slot"', '"invite {'].map((id) => tree.indexOf(id));
  expect(at.every((i, n) => i > (n ? at[n - 1] : 0))).toBe(true); // the dials, the payment, the tiles, then the slot with the invite
  expect(screen.getByText(/^dunning /).props.children).toContain('"surface":"HomeScreen","presentation":"section"');
});

it('Finish joining shows ahead of the notifications ask, and Finish your profile waits behind both (#RINGS-JOIN-FIRST)', async () => {
  (['profile', 'push', 'finishJoining'] as const).forEach((id) => mockDue.add(id));
  await render(<RingsHomeScreen {...props} />);
  expect(await screen.findByText(/^finishJoining /)).toBeTruthy();
  expect(screen.queryByText(/^push /)).toBeNull();
  expect(screen.queryByText(/^profile /)).toBeNull();
});

it('refreshes on open: a refocus and a return to the foreground re-read every dial and tile; Health on this phone on each return to the app', async () => {
  mockRefreshOnDevice.mockResolvedValueOnce({ kind: 'imported', postedCount: 3, complete: true });
  await render(<RingsHomeScreen {...props} />);
  // First open: Health on this phone once, and the new samples refetch the wearable reads.
  await waitFor(() => expect(mockInvalidate).toHaveBeenCalledTimes(1));
  expect(mockRefreshOnDevice).toHaveBeenCalledWith('APPLE_HEALTHKIT', mockConnectionsData);
  expect(reads()).toEqual(each(0));
  await settle();
  // Back to the app on another tab: Health on this phone is read; nothing re-reads behind the other screen.
  await focus(false);
  await foreground();
  expect(mockRefreshOnDevice).toHaveBeenCalledTimes(2);
  expect(reads()).toEqual(each(0));
  await settle();
  await focus(true);
  expect(reads()).toEqual(each(1));
  await foreground();
  expect(reads()).toEqual(each(2));
  expect(mockRefreshOnDevice).toHaveBeenCalledTimes(3);
  await settle();
  expect(mockInvalidate).toHaveBeenCalledTimes(1); // nothing new posted: nothing refetched
  expect(onRefresh).not.toHaveBeenCalled(); // quiet: no pull spinner
});

it('a Health read that settles after a sign-out or account switch refetches nothing (C-317-a)', async () => {
  let posted: (o: object) => void = () => undefined;
  mockRefreshOnDevice.mockReturnValueOnce(new Promise((resolve) => { posted = resolve; }));
  await render(<RingsHomeScreen {...props} />);
  mockGeneration += 1;
  await act(async () => posted({ kind: 'imported', postedCount: 3, complete: true }));
  await settle();
  expect(mockInvalidate).not.toHaveBeenCalled();
});

it('one Health read at a time, and a failed one logs nothing it carries', async () => {
  let fail: (e: Error) => void = () => undefined;
  mockRefreshOnDevice.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
  await render(<RingsHomeScreen {...props} />);
  await foreground();
  expect(mockRefreshOnDevice).toHaveBeenCalledTimes(1); // the first is still reading
  await act(async () => fail(new Error('HealthKit said something private')));
  await waitFor(() => expect(logger.warn).toHaveBeenCalledWith('[home] on-device refresh failed'));
  expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('private');
  await settle();
  await foreground();
  expect(mockRefreshOnDevice).toHaveBeenCalledTimes(2);
});
