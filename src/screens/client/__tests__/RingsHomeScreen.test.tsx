import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getTodayString } from '../../../utils/date';

const mockNavigate = jest.fn();
const mockHistory = jest.fn();
const mockAssignments = jest.fn();
let mockRomanChat = true;
let mockRecovery: number | null = null;
let mockAsleep: number | null = null;
let mockSleepData: object | undefined;
let mockCheckIn: unknown = null;
let mockFitness: unknown;
const mockInsights = jest.fn((): { data?: unknown } => ({ data: undefined }));
const WATER_NOT_SAVED = '8 oz of water was not saved. Check the connection, then add it again.';
let mockSleepRead: 'ok' | 'failed' | 'pending' = 'ok';
let mockCheckInRead: 'ok' | 'failed' | 'pending' = 'ok';
const mockUser: { id: string; coach_id: string; profile: Record<string, unknown> } = { id: 'u1', coach_id: 'c1', profile: {} };
const mockDay = {
  foodLogs: [], dailyTotals: { calories: 1030, protein: 73, carbs: 100, fat: 38 }, waterOz: 48, selectedDate: getTodayString(),
  hasLoadedDay: true, loadDayData: jest.fn(), loadProfile: jest.fn(), isLoading: false, loadError: null as string | null,
  logWater: jest.fn(async () => undefined),
};
jest.mock('../../../config/featureFlags', () => {
  // A getter in the object literal would be read once by the spread helper; define it after.
  const flags = { ...jest.requireActual('../../../config/featureFlags').featureFlags, clientHomeRings: true };
  Object.defineProperty(flags, 'romanChat', { get: () => mockRomanChat });
  return { featureFlags: flags };
});
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 1850, protein: 150, carbs: 200, fat: 60 }) }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockDay, { getState: () => mockDay }) }));
jest.mock('../../../hooks/useWearableSamples', () => ({
  // Both Health reads (Sleep and Steps) answer, wait or fail together.
  useWearableSamples: (args: { bucket: string }) => ({
    data: args.bucket === 'HEALTH_FITNESS' ? mockFitness : mockSleepData,
    isSuccess: mockSleepRead === 'ok', isError: mockSleepRead === 'failed', refetch: jest.fn(),
  }),
}));
jest.mock('../../../hooks/useHolisticInsights', () => ({ useHolisticInsights: () => mockInsights() }));
const mockRead = (data: unknown) => ({ data, isSuccess: true, refetch: jest.fn() });
jest.mock('../../../hooks/useApi', () => ({
  ...jest.requireActual('../../../hooks/useApi'),
  useTodayCheckIn: () => ({ data: mockCheckIn, isSuccess: mockCheckInRead === 'ok', isError: mockCheckInRead === 'failed', refetch: jest.fn() }),
  useWeightHistory: () => mockRead({ logs: [
    { id: 'w1', weight_lbs: 169.6, date: '2026-09-14T00:00:00.000Z' },
    { id: 'w2', weight_lbs: 168.4, date: '2026-10-12T00:00:00.000Z' },
  ] }),
  useHabits: () => mockRead([{ id: 'h1', name: 'Water' }, { id: 'h2', name: 'Steps' }, { id: 'h3', name: 'Stretch' }]),
  useHabitLogs: () => mockRead([{ habit_id: 'h1', completed: true }, { habit_id: 'h2', completed: true }]),
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, confirmedActive: true, status: 'active' }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../wearables/recoveryData', () => ({
  DEFAULT_SLEEP_NEED_MIN: 480,
  recoveryScore: () => mockRecovery,
  sleepDeficit: () => (mockAsleep === null ? null : { asleepMinutes: mockAsleep }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async (url: string) => ({ data: url.includes('unread') ? { total: 1 } : { name: 'Jordan Lee' } }) },
  workoutApi: { getAll: () => mockHistory() },
}));
jest.mock('../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: () => mockAssignments() } }));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../components/coachless/CoachlessHomeSlot', () => ({
  __esModule: true,
  default: ({ part }: { part: string }) => require('react').createElement(require('react-native').Text, null, `coachless-slot-${part}`),
}));
// Today's Home sections (not rendered while the flag is on).
jest.mock('../../../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../../../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../../../components/home/FullMacrosIntroCard', () => () => null);
jest.mock('../../../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../../../components/PendingInviteBanner', () => () => null);
jest.mock('../../../components/join/FinishJoining', () => () => null);
import HomeScreen from '../HomeScreen';
import { HapticService } from '../../../ui/haptics/haptics.service';

const { start: weekStart } = require('../../../components/home/rings/homeRings').weekBounds(new Date());

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.coach_id = 'c1'; mockUser.profile = { workout_days_per_week: 3 };
  mockRomanChat = true; mockRecovery = null; mockAsleep = null; mockSleepData = undefined; mockCheckIn = null; mockFitness = undefined;
  mockSleepRead = 'ok'; mockCheckInRead = 'ok';
  mockDay.loadError = null;
  mockInsights.mockReturnValue({ data: undefined });
  mockHistory.mockResolvedValue({ data: [] });
  mockAssignments.mockResolvedValue([
    { id: 'a1', scheduled_for: weekStart, completed_at: 'done', workout_plan: { name: 'Lower A' } },
    { id: 'a2', scheduled_for: weekStart, completed_at: null, workout_plan: { name: 'Full Body A' } },
  ]);
});

it('no build profile switches the flag on and it defaults off, so merging changes nothing for users', () => {
  const eas = require('../../../../eas.json') as { build: Record<string, { env?: Record<string, string> }> };
  for (const [name, profile] of Object.entries(eas.build)) {
    const value = String(profile.env?.EXPO_PUBLIC_FF_CLIENT_HOME_RINGS ?? '').trim().toLowerCase();
    expect([name, ['1', 'true', 'yes', 'on'].includes(value)]).toEqual([name, false]);
  }
  expect(jest.requireActual('../../../config/featureFlags').featureFlags.clientHomeRings).toBe(false);
});

it('coached: three dials with their own numbers and one forest button', async () => {
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Start Full Body A')).toBeTruthy();
  expect(screen.getByText('Message Jordan')).toBeTruthy();
  expect(screen.getByLabelText('Food, 820 kcal left, 1,030 of 1,850')).toBeTruthy();
  expect(screen.getByLabelText('Train, 1 of 2 workouts, This week')).toBeTruthy();
  expect(screen.queryByText('Opens with a coach')).toBeNull();
  // The ring is a fixed 92 pt: its number and unit stop at 115% text; the label under it keeps growing.
  expect(screen.getByText('820').props.maxFontSizeMultiplier).toBe(1.15);
  expect(screen.getByText('kcal left').props.maxFontSizeMultiplier).toBe(1.15);
  expect(screen.getByText('Food').props.maxFontSizeMultiplier).toBeUndefined();
  await fireEvent.press(screen.getByLabelText('Start Full Body A'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', {
    screen: 'WorkoutAssignmentDetail', initial: false, params: { assignmentId: 'a2' },
  });
});

// Every tap lands on a real screen: navigate() from Home resolves in the Home stack, then the tab bar.
const NAV = readFileSync(join(__dirname, '../../../navigation/ClientNavigator.tsx'), 'utf8');
const screensIn = (nav: string): Record<string, string> => Object.fromEntries(
  [...NAV.slice(NAV.indexOf(`<${nav}.Navigator`), NAV.indexOf(`</${nav}.Navigator>`))
    .matchAll(new RegExp(`<${nav}\\.Screen\\s+name="(\\w+)"(?:\\s+component=\\{(\\w+)\\})?`, 'g'))].map((m) => [m[1], m[2] ?? '']));
const TAB_STACK: Record<string, string> = { Home: 'HomeStackNav', WorkoutTab: 'WorkoutStackNav', MoreTab: 'MoreStackNav' };
function lands([name, params]: readonly unknown[]): boolean {
  const nested = (params as { screen?: string } | undefined)?.screen;
  if (typeof name !== 'string') return false;
  if (name in screensIn('HomeStackNav')) return true;
  return name in screensIn('Tab') && (!nested || nested in screensIn(TAB_STACK[name] ?? ''));
}
const NO_SOURCE = { freshness: { providers: [] }, series: [] };
const A_SOURCE = { freshness: { providers: [] }, series: [{ metric: 'HRV_MS', sample_count: 1, samples: [] }] };
const STEPS_TODAY = {
  series: [{ metric: 'STEPS', provider_used: 'APPLE_HEALTHKIT', sample_count: 1, samples: [],
    buckets: [{ bucket_start: `${getTodayString()}T00:00:00.000Z`, agg: 6412 }] }],
  freshness: { providers: [{ provider: 'APPLE_HEALTHKIT' }] },
};
const HEALTH = ['Health', { bucket: 'recovery' }] as const;
const FITNESS = ['Health', { bucket: 'fitness' }] as const;
const CONNECTIONS = ['Connections'] as const;

// #HEALTH-PAGES: Health in every state; Connections only once Health answered with no source at all.
// [state, what Health returned, Health read, check-in hours, check-in read, the dial's or tile's spoken label, where the tap lands]
it.each([
  ['Food', 'nothing', 'ok', null, 'ok', 'Food, 820 kcal left, 1,030 of 1,850', ['Log']],
  ['Train', 'nothing', 'ok', null, 'ok', 'Train, 1 of 2 workouts, This week', ['WorkoutTab']],
  ['Sleep, last night from Health', 'last night', 'ok', null, 'ok', 'Sleep, 78% recovered, 7 h 20 m asleep', HEALTH],
  ['Sleep, a source but nothing for last night', 'a source', 'ok', null, 'ok', 'Sleep, —', HEALTH],
  ['Sleep, a source and the check-in', 'a source', 'ok', 7.5, 'ok', 'Sleep, 7.5 h asleep', HEALTH],
  ['Sleep, no source and the check-in', 'nothing', 'ok', 7.5, 'ok', 'Sleep, 7.5 h asleep', CONNECTIONS],
  ['Sleep, no source and no check-in', 'nothing', 'ok', null, 'ok', 'Sleep, Connect', CONNECTIONS],
  ['Sleep, no source, check-in loading', 'nothing', 'ok', null, 'pending', 'Sleep, —', CONNECTIONS],
  ['Sleep, no source, check-in failed', 'nothing', 'ok', null, 'failed', 'Sleep, —', CONNECTIONS],
  ['Sleep, Health loading', 'nothing', 'pending', null, 'ok', 'Sleep, —', HEALTH],
  ['Sleep, Health failed', 'nothing', 'failed', null, 'ok', 'Sleep, —', HEALTH],
  ['Sleep, Health failed and the check-in', 'nothing', 'failed', 6.5, 'ok', 'Sleep, 6.5 h asleep', HEALTH],
  ['Protein', 'nothing', 'ok', null, 'ok', 'Protein, 73 g of 150, Carbs 100 g, Fat 38 g', ['Log']],
  ['Water', 'nothing', 'ok', null, 'ok', 'Water, 48 of 100 oz', ['Log']],
  ['Weight', 'nothing', 'ok', null, 'ok', 'Weight, 168.4 lb, Down 1.2 lb in 30 days', ['MoreTab', { screen: 'Progress', initial: false }]],
  ['Habits', 'nothing', 'ok', null, 'ok', 'Habits, 2 of 3, Water and Steps done. Stretch open.', ['Habits']],
  ['Steps today', 'steps today', 'ok', null, 'ok', 'Steps, 6,412, Of 5,000, Apple Health', FITNESS],
  ['Steps, a source but no steps today', 'a source', 'ok', null, 'ok', 'Steps, —', FITNESS],
  ['Steps, no source', 'nothing', 'ok', null, 'ok', 'Steps, Connect', CONNECTIONS],
  ['Steps, Health loading', 'nothing', 'pending', null, 'ok', 'Steps, —', FITNESS],
  ['Steps, Health failed', 'nothing', 'failed', null, 'ok', 'Steps, —', FITNESS],
  ['Check-in', 'nothing', 'ok', null, 'ok', 'Check-in, —', ['Habits', { tab: 'checkin' }]],
] as const)('%s: the tap lands on a real screen, with a light haptic', async (_, health, healthRead, hours, checkInRead, label, to) => {
  mockSleepData = healthRead !== 'ok' ? undefined : health === 'nothing' ? NO_SOURCE : A_SOURCE;
  mockFitness = health === 'steps today' ? STEPS_TODAY : mockSleepData;
  if (health === 'last night') { mockRecovery = 78; mockAsleep = 440; }
  mockSleepRead = healthRead; mockCheckInRead = checkInRead; mockCheckIn = hours ? { sleep_hours: hours } : null;
  await render(<HomeScreen />);
  await screen.findByLabelText('Start Full Body A');
  await fireEvent.press(await screen.findByLabelText(label));
  expect(mockNavigate).toHaveBeenLastCalledWith(...to);
  expect(lands(to)).toBe(true);
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/coming soon/i)).toBeNull();
});

it('opened from Home, Back lands on Home: the Home stack holds the same Health page and inner routes as You', () => {
  const home = screensIn('HomeStackNav');
  const you = screensIn('MoreStackNav');
  for (const name of ['Health', 'WearableMetricDetail', 'Connections']) expect([name, home[name]]).toEqual([name, you[name]]);
  expect(home.Health).toBe('WearablesShell');
});

it.each([
  ['history', () => mockHistory.mockRejectedValue(new Error('offline'))],
  ['assignments', () => mockAssignments.mockRejectedValue(new Error('offline'))],
] as const)('Train shows "—", not a count, when the %s read failed', async (_, fail) => {
  mockAssignments.mockResolvedValue([]);
  mockHistory.mockResolvedValue({ data: [{ date: weekStart }] });
  fail();
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Train, — workouts, This week')).toBeTruthy();
});

it('coachless: Roman locked in the header opens his lock screen, not a chat; Join a coach under the dials', async () => {
  mockUser.coach_id = '';
  mockAssignments.mockResolvedValue([]);
  mockHistory.mockResolvedValue({ data: [{ date: weekStart }] });
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Open Train')).toBeTruthy();
  expect(screen.getByLabelText('Roman. Opens with a coach')).toBeTruthy();
  expect(screen.getByText('coachless-slot-join')).toBeTruthy();
  expect(screen.getByLabelText('Train, 1 of 3 workouts, This week')).toBeTruthy();
  expect(screen.queryByText('Ask Roman')).toBeNull();
  expect(screen.queryByLabelText('Chat with Roman')).toBeNull();
  expect(screen.queryByText(/^Message /)).toBeNull();
  expect(screen.getAllByTestId('roman-locked-avatar')).toHaveLength(2); // header and Roman's line
  // RomanChatScreen renders the lock (JoinCoachState) for a client with no coach before any session opens.
  await fireEvent.press(screen.getByLabelText('Roman. Opens with a coach'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
});

it('coachless with Roman chat off: no Roman at all, the same as a coached client, and no dead tap', async () => {
  mockUser.coach_id = ''; mockRomanChat = false;
  mockAssignments.mockResolvedValue([]);
  mockHistory.mockResolvedValue({ data: [{ date: weekStart }] });
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Open Train')).toBeTruthy();
  expect(screen.queryByLabelText('Roman. Opens with a coach')).toBeNull();
  expect(screen.queryByText('Opens with a coach')).toBeNull();
  expect(screen.queryByTestId('home-roman-locked')).toBeNull();
  expect(screen.getByTestId('home-leading-empty')).toBeTruthy();
});

it('a failed day read shows the quiet error with Try again and dashes, not zero totals', async () => {
  mockDay.loadError = 'Today could not load. Try again.';
  await render(<HomeScreen />);
  expect(await screen.findByText('Today could not load. Try again.')).toBeTruthy();
  expect(screen.getByLabelText('Food, — kcal left')).toBeTruthy();
  // Water is unknown, so its chip is off and looks off: no dead tap.
  const chip = screen.getByLabelText('Add 8 ounces of water');
  expect(chip.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  expect(StyleSheet.flatten(chip.props.style).opacity).toBe(0.4);
  await fireEvent.press(screen.getByTestId('home-day-data-error-retry'));
  expect(mockDay.loadDayData).toHaveBeenCalledTimes(2); // on mount, then Try again
  expect(mockDay.loadDayData).toHaveBeenLastCalledWith('u1', getTodayString());
});

it('tiles show the real numbers: protein with carbs and fat, water to the Food log goal, weight, habits, check-in', async () => {
  mockCheckIn = { mood: 4, energy: 3, sleep_hours: 7.5 };
  await render(<HomeScreen />);
  expect(await screen.findByLabelText('Water, 48 of 100 oz')).toBeTruthy();
  expect(screen.getByLabelText('Protein, 73 g of 150, Carbs 100 g, Fat 38 g')).toBeTruthy();
  expect(screen.getByLabelText('Weight, 168.4 lb, Down 1.2 lb in 30 days')).toBeTruthy();
  expect(screen.getByTestId('home-tile-weight-trend')).toBeTruthy();
  expect(screen.getByLabelText('Habits, 2 of 3, Water and Steps done. Stretch open.')).toBeTruthy();
  expect(screen.getByLabelText('Check-in, Good, Energy normal, slept 7.5 h')).toBeTruthy();
});

it('the water chip adds 8 oz with a success haptic, and an error haptic when it was not saved', async () => {
  await render(<HomeScreen />);
  await screen.findByLabelText('Water, 48 of 100 oz');
  expect(StyleSheet.flatten(screen.getByLabelText('Add 8 ounces of water').props.style).minHeight).toBe(44);
  await fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
  expect(mockDay.logWater).toHaveBeenCalledWith('u1', '', 8);
  await waitFor(() => expect(HapticService.success).toHaveBeenCalledTimes(1));
  expect(mockNavigate).not.toHaveBeenCalled();
  mockDay.logWater.mockImplementationOnce(async () => { mockDay.loadError = WATER_NOT_SAVED; });
  await fireEvent.press(screen.getByLabelText('Add 8 ounces of water'));
  await waitFor(() => expect(HapticService.error).toHaveBeenCalledTimes(1));
});

it("coached: Roman's line is the existing insight sentence, Ask Roman opens Roman, no header avatar", async () => {
  mockInsights.mockReturnValue({ data: { status: 'ok', insights: [{ text: 'Your protein held steady this week.' }] } });
  await render(<HomeScreen />);
  expect(await screen.findByText('Your protein held steady this week.')).toBeTruthy();
  expect(screen.queryByTestId('home-roman-avatar')).toBeNull();
  await fireEvent.press(screen.getByText('Ask Roman'));
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
});

it("coached with Roman chat off and no sentence: no Roman's line", async () => {
  mockRomanChat = false;
  await render(<HomeScreen />);
  await screen.findByLabelText('Start Full Body A');
  expect(screen.queryByTestId('home-roman-line')).toBeNull();
});

it("coachless: Roman's line is locked, makes no insights read and opens Roman's lock screen, not a chat", async () => {
  mockUser.coach_id = '';
  await render(<HomeScreen />);
  const locked = await screen.findByLabelText("Roman works with a coach. Roman reads your rings with a coach's guidance. Your own logging stays open.");
  expect(mockInsights).not.toHaveBeenCalled();
  await fireEvent.press(locked);
  expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
});
