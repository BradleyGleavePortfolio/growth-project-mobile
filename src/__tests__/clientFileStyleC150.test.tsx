/** K1-OVERVIEW (agent 150): the Style C client file behind coachTabsV2; every tap lands somewhere real; flag off, unchanged. */
import React from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import ClientDetailScreen from '../screens/coach/ClientDetailScreen';
import { STATUS_BAR_BONE, StatusBarBand } from '../components/StatusBarBand';
import type { ClientsStackParamList } from '../navigation/CoachNavigator';
import { layout, lightTokens } from '../theme/tokens';
import { useCoachStore } from '../store/coachStore';
import { coachApi } from '../services/api';
import { macrosApi } from '../api/macrosApi';
import { HapticService } from '../ui/haptics/haptics.service';
import { bucketDateLocal, getTodayString } from '../utils/date';
import { featureFlags } from '../config/featureFlags';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachTabsV2: true } }));
const mockFlags = featureFlags as Record<string, boolean>;
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), mediumImpact: jest.fn(), error: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
  tokens: jest.requireActual('../theme/tokens').default,
  semanticColors: jest.requireActual('../theme/tokens').lightTokens,
}) }));
jest.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, `icons-${style}`) }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-test' }) }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isLoading: false, flags: {} }) }));
jest.mock('../services/api', () => ({ coachApi: {
  getClientSummary: jest.fn(), getClientTimeline: jest.fn(), getClientWeek: jest.fn(), getClients: jest.fn(), archiveClient: jest.fn(), unarchiveClient: jest.fn(),
} }));
jest.mock('../api/macrosApi', () => ({ macrosApi: { currentForClient: jest.fn() } }));
// A function declaration is hoisted with its body, so the factories below can use it.
function mockMarker(id: string) {
  return () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, id);
}
jest.mock('../screens/coach/client-detail/SummaryTab', () => ({ SummaryTab: mockMarker('summary-body') }));
jest.mock('../screens/coach/client-detail/WorkoutsTab', () => ({ WorkoutsTab: mockMarker('workouts-body') }));
jest.mock('../screens/coach/client-detail/FoodLogReviewSection', () => ({ FoodLogReviewSection: mockMarker('logs-body') }));
jest.mock('../screens/coach/client-detail/TimelineTab', () => ({ TimelineTab: mockMarker('timeline-body') }));
jest.mock('../screens/coach/client-detail/ProgressTab', () => ({ ProgressTab: mockMarker('progress-body') }));
jest.mock('../screens/coach/client-detail/HealthFitnessTab', () => ({ HealthFitnessTab: () => null }));
jest.mock('../screens/coach/client-detail/SleepRecoveryTab', () => ({ SleepRecoveryTab: () => null }));
jest.mock('../screens/coach/client-detail/WeeklySummaryTab', () => ({ WeeklySummaryTab: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));
jest.mock('../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: () => null }));

const now = new Date();
const monday = bucketDateLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
const today = `${getTodayString()}T00:00:00.000Z`;
const yesterday = `${bucketDateLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))}T00:00:00.000Z`;
let summary: Record<string, unknown>;
let timeline: Record<string, unknown>;
let clientWeek: { week_start: string; today: string; assignments: unknown[] };
const params = { clientId: 'client-test', clientName: 'Test client' };
const TABS = ['week', 'summary', 'logs', 'progress', 'healthFitness', 'sleepRecovery', 'workouts', 'timeline', 'weekly'];
// Every render is the app's real stack (Clients, the file, the thread) under the app's status band, on a 47 pt notch.
const Stack = createNativeStackNavigator<ClientsStackParamList>();
const ref = createNavigationContainerRef<ClientsStackParamList>();
const file = () => (
  <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
    <NavigationContainer ref={ref} initialState={{ index: 1, routes: [{ name: 'ClientsList' }, { name: 'ClientDetail', params }] }}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="ClientsList">{() => null}</Stack.Screen>
        <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
        <Stack.Screen name="ClientMessages">{() => null}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
    <StatusBarBand />
  </SafeAreaInsetsContext.Provider>
);
// B1 (FIXK1OV): the band's colour and whether it asks for light icons. Forest only while the Style C file is focused.
const band = (v: Awaited<ReturnType<typeof render>>) =>
  [StyleSheet.flatten(v.getByTestId('status-bar-band').props.style).backgroundColor, !!v.queryByText('icons-light')];
const FOREST = [lightTokens.surface.masthead, true];
const BONE = [STATUS_BAR_BONE, false];
const read = coachApi.getClientSummary as jest.Mock;
const week = coachApi.getClientTimeline as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.coachTabsV2 = true;
  useCoachStore.getState().reset();
  summary = { client_name: 'Test client', profile: { macro_target_calories: 2100 }, today: {} };
  clientWeek = { week_start: monday, today: getTodayString(), assignments: [{ id: 'a1', day: monday, completed_at: today, skipped_at: null }] };
  timeline = { // #FOODAVG: yesterday's 1,800 is the average; today's 500 is still being logged
    meals: [{ id: 'm1', date: today, quantity_multiplier: 1, food_item: { calories: 500 } }, { id: 'm0', date: yesterday, quantity_multiplier: 1, food_item: { calories: 1800 } }],
    checkIns: [{ date: today, reviewed_by_coach: false }], weights: [],
  };
  read.mockReset().mockImplementation(async () => ({ data: summary }));
  week.mockReset().mockImplementation(async () => ({ data: timeline }));
  (coachApi.getClientWeek as jest.Mock).mockReset().mockImplementation(async () => ({ data: clientWeek }));
  (macrosApi.currentForClient as jest.Mock).mockReset().mockResolvedValue({ data: null }); // no coach target yet: every new client
  (coachApi.getClients as jest.Mock).mockReset().mockResolvedValue({ data: [{ id: 'client-test', name: 'Test client', role: 'student', archived_at: null }] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('flag off: the file is unchanged (Summary first, the old header, no masthead)', async () => {
  mockFlags.coachTabsV2 = false;
  const view = await render(file());
  expect(await view.findByText('summary-body')).toBeTruthy();
  expect(view.getByLabelText('Summary').props.accessibilityState).toEqual({ selected: true });
  expect(view.queryByTestId('file-masthead')).toBeNull();
  expect(view.queryByText('This week')).toBeNull();
  for (const m of [week, coachApi.getClientWeek]) expect(m).not.toHaveBeenCalled();
  expect(band(view)).toEqual(BONE);
});

it('flag on: opens on This week with the name, the ring, the day strip and the four cards (Food: the client\'s own target, LO-739 B1; today out of the average)', async () => {
  const view = await render(file());
  expect(await view.findByText('Logged 2 of 7 days · Average 1,800 kcal · target 2,100')).toBeTruthy();
  expect(view.getByLabelText('This week').props.accessibilityState).toEqual({ selected: true });
  expect(view.getByRole('header').props.children).toBe('Test client');
  expect(view.getByLabelText('1 of 1 done')).toBeTruthy();
  expect(view.getAllByText('1 of 1 done').length).toBe(2); // headline and Workouts card
  expect(view.getByTestId('file-day-0').props.accessibilityLabel).toMatch(/^Mon \d+ done$/);
  expect(view.getByText('1 this week · 1 to review')).toBeTruthy();
  expect(view.getByText('Message Test')).toBeTruthy();
  // B3 (Opus, FIX739): the coach tab bar under the file owns the 34 pt inset, so Message sits one gutter above it.
  expect(StyleSheet.flatten(view.getByTestId('file-footer').props.style).paddingBottom).toBe(layout.gutter);
  expect(coachApi.getClientWeek).toHaveBeenCalledWith('client-test');
  expect(view.getAllByRole('tab').map((t) => t.props.testID)).toEqual(TABS.map((k) => `file-tab-${k}`));
  expect(band(view)).toEqual(FOREST);
});

// B1 (Opus, FIX739): the ring is the server's week, so a delivered program's later weeks cannot hide it.
// Opus N1 and N4: an archived client with nothing planned this week reads both, with no ring.
it('nothing planned and archived: no ring, the Workouts card and the masthead say so', async () => {
  clientWeek.assignments = [];
  (coachApi.getClients as jest.Mock).mockResolvedValue({ data: [{ id: 'client-test', name: 'Test client', role: 'student', archived_at: today }] });
  const view = await render(file());
  expect(await view.findByText('Nothing planned this week')).toBeTruthy();
  expect(await view.findByText('Archived client')).toBeTruthy();
  expect(view.queryByTestId('file-week')).toBeNull();
});

// B1 (GPT, FIX739): This week reads again each time it opens, so work done on another tab shows on return. A coach target wins over the client's own (LO-739 B1).
it.each<[string, string, () => void, string]>([
  ['a check-in marked reviewed', 'timeline', () => { timeline.checkIns = [{ date: today, reviewed_by_coach: true }]; }, '1 this week · 0 to review'],
  ['a coach calorie target', 'summary', () => { jest.mocked(macrosApi.currentForClient).mockResolvedValue({ data: { calories_kcal: 1900 } } as never); }, 'Logged 2 of 7 days · Average 1,800 kcal · target 1,900'],
])('after %s on the %s tab, This week shows it on return', async (_name, tab, change, line) => {
  const view = await render(file());
  await view.findByText('1 this week · 1 to review');
  await fireEvent.press(view.getByTestId(`file-tab-${tab}`));
  change();
  await fireEvent.press(view.getByTestId('file-tab-week'));
  expect(await view.findByText(line)).toBeTruthy();
});

// N1 (GPT, FIX739): the open tab scrolls into view, here after a card opens a tab off the right edge.
it('the open tab scrolls into view', async () => {
  const view = await render(file());
  await view.findByText('1 this week · 1 to review');
  await fireEvent(view.getByTestId('file-tab-workouts'), 'layout', { nativeEvent: { layout: { x: 600 } } });
  await fireEvent.press(view.getByTestId('file-card-workouts'));
  expect(ScrollView.prototype.scrollTo).toHaveBeenLastCalledWith({ x: 600 - layout.gutter, animated: true });
});

// Tap map: every tap lands somewhere real.
it.each<[string, string, (v: Awaited<ReturnType<typeof render>>) => void]>([
  ['Workouts card', 'file-card-workouts', (v) => expect(v.getByText('workouts-body')).toBeTruthy()],
  ['Food card', 'file-card-food', (v) => expect(v.getByText('logs-body')).toBeTruthy()],
  ['Check-ins card', 'file-card-checkins', (v) => expect(v.getByText('timeline-body')).toBeTruthy()],
  ['Weigh-ins card', 'file-card-weighins', (v) => expect(v.getByText('progress-body')).toBeTruthy()],
  ['Summary tab', 'file-tab-summary', (v) => expect(v.getByText('summary-body')).toBeTruthy()],
  ['Back', 'file-back', () => expect(ref.getCurrentRoute()?.name).toBe('ClientsList')],
  ['More', 'file-more', () => expect(jest.mocked(Alert.alert).mock.calls[0][2]?.map((b) => b.text)).toEqual(['Archive client', 'Cancel'])],
])('%s lands on its destination', async (_name, id, landed) => {
  const view = await render(file());
  await view.findByText('1 this week · 1 to review');
  await fireEvent.press(await view.findByTestId(id));
  landed(view);
});

// Sol B1 (FIX739D, #FOODAVG): a client who has logged only today has no finished day, so the card shows no average yet.
it('a client who has logged only today reads Logged 1 of 7 days, with no average', async () => {
  timeline.meals = [{ id: 'm1', date: today, quantity_multiplier: 1, food_item: { calories: 500 } }];
  const view = await render(file());
  expect(await view.findByText('Logged 1 of 7 days')).toBeTruthy();
});

it('the file error names the client, keeps the masthead and Message, buzzes once, and Try again reloads', async () => {
  read.mockRejectedValueOnce(new Error('offline'));
  const view = await render(file());
  expect(await view.findByText("Test's file did not load. Check the connection and try again.")).toBeTruthy();
  expect(view.getByTestId('file-masthead')).toBeTruthy();
  expect(view.getByText('Message Test')).toBeTruthy();
  expect(HapticService.error).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('1 this week · 1 to review')).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(2);
});

it('while the file loads, the masthead keeps the name over static placeholders', async () => {
  read.mockImplementationOnce(() => new Promise(() => undefined));
  const view = await render(file());
  expect(view.getByLabelText("Loading Test's file")).toBeTruthy();
  expect(view.getByText('Test client')).toBeTruthy();
  expect(band(view)).toEqual(FOREST);
});

it('a failed This week read offers Try again in place', async () => {
  week.mockRejectedValueOnce(new Error('offline'));
  const view = await render(file());
  expect(await view.findByText("Test's file did not load. Check the connection and try again.")).toBeTruthy();
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('1 this week · 1 to review')).toBeTruthy();
  expect(week).toHaveBeenCalledTimes(2);
});

// B2 (FIXK1OV): the old header's message icon is gone with the flag on, so Message {first} is pinned on every section.
it.each(TABS)('Message stays pinned on the %s tab and opens the thread', async (key) => {
  const view = await render(file());
  await view.findByText('1 this week · 1 to review');
  await fireEvent.press(view.getByTestId(`file-tab-${key}`));
  expect(view.getByTestId(`file-tab-${key}`).props.accessibilityState).toEqual({ selected: true });
  await fireEvent.press(view.getByTestId('file-message'));
  expect([ref.getCurrentRoute(), band(view)]).toMatchObject([{ name: 'ClientMessages', params }, BONE]);
  await act(async () => ref.goBack());
  expect(band(view)).toEqual(FOREST);
});
