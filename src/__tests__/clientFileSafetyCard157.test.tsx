/**
 * SAFETY-CARD (agent 157): a client's open Roman safety alert on their file (summary `open_safety_alert`, b#1075).
 * The real ClientDetailScreen in real tabs and stacks shaped like CoachNavigator's (Messages: the inbox and the chat;
 * Clients: the list, the file and the chat), both coachTabsV2 states. Who gets an alert is the server's rule, tested
 * there: backend test/rls/open-safety-alert-rls.spec.ts (another coach's summary is "Client not found" and reads 0
 * alert rows; a sub-coach and the owner read null) and test/coach-alerts.service.spec.ts (Dismiss refuses a client
 * outside the coach's scope). Here the app shows exactly what the server sends.
 * CLIENTFILE-FIX (agent 157): a reused file never shows a late read for the client before, and both Message {first}
 * buttons open the chat in Messages (#CARD-MESSAGE-DEST op 1).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import ClientDetailScreen from '../screens/coach/ClientDetailScreen';
import type { ClientsStackParamList, CoachTabParamList, MessagesStackParamList } from '../navigation/CoachNavigator';
import { coachApi } from '../services/api';
import { commandCenterApi } from '../services/commandCenterApi';
import { macrosApi } from '../api/macrosApi';
import { HapticService } from '../ui/haptics/haptics.service';
import { useCoachStore } from '../store/coachStore';
import { bucketDateLocal, getTodayString } from '../utils/date';
import { featureFlags } from '../config/featureFlags';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachTabsV2: true } }));
const mockFlags = featureFlags as Record<string, boolean>;
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), mediumImpact: jest.fn(), softImpact: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
  tokens: jest.requireActual('../theme/tokens').default,
  semanticColors: jest.requireActual('../theme/tokens').lightTokens,
}) }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-test' }) }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isLoading: false, flags: {} }) }));
jest.mock('../services/api', () => ({ coachApi: {
  getClientSummary: jest.fn(), getClientTimeline: jest.fn(), getClientWeek: jest.fn(), getClients: jest.fn(),
} }));
jest.mock('../services/commandCenterApi', () => ({ commandCenterApi: { dismissAlert: jest.fn() } }));
jest.mock('../api/macrosApi', () => ({ macrosApi: { currentForClient: jest.fn() } }));
function mockMarker(id: string) {
  return () => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, id);
}
jest.mock('../screens/coach/client-detail/SummaryTab', () => ({ SummaryTab: ({ profile, totals }: { profile: { name?: string } | null; totals: { calories: number } }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, `summary-body ${profile?.name} ${totals.calories}`) }));
jest.mock('../screens/coach/client-detail/WorkoutsTab', () => ({ WorkoutsTab: mockMarker('workouts-body') }));
jest.mock('../screens/coach/client-detail/FoodLogReviewSection', () => ({ FoodLogReviewSection: mockMarker('logs-body') }));
jest.mock('../screens/coach/client-detail/TimelineTab', () => ({ TimelineTab: mockMarker('timeline-body') }));
jest.mock('../screens/coach/client-detail/ProgressTab', () => ({ ProgressTab: mockMarker('progress-body') }));
jest.mock('../screens/coach/client-detail/HealthFitnessTab', () => ({ HealthFitnessTab: () => null }));
jest.mock('../screens/coach/client-detail/SleepRecoveryTab', () => ({ SleepRecoveryTab: () => null }));
jest.mock('../screens/coach/client-detail/WeeklySummaryTab', () => ({ WeeklySummaryTab: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../components/coach/ai-execution/AskAiActionSheet', () => ({ AskAiActionSheet: () => null }));
jest.mock('../components/coach/DisputePausedPlansCard', () => ({ DisputePausedPlansCard: mockMarker('paused-plans') }));

const params = { clientId: 'client-test', clientName: 'Sam Rivera' };
const CHAT = { clientId: params.clientId, clientName: params.clientName };
const alertOf = (alert_type: string) => ({ alert_id: `alert-${alert_type}`, alert_type, created_at: '2026-10-18T09:00:00.000Z' });
const CHECK = 'Please check in with them today.';
const LINES = [
  ['roman_crisis_reply', `Roman sent Sam a crisis safety reply. ${CHECK}`], // #ROMAN-CRISIS-ALERT, word for word
  ['roman_urgent_reply', 'Urgent: Roman sent Sam a medical safety reply. Roman told them to contact their doctor or prescriber '
    + `today, and to call 911 if symptoms are severe. ${CHECK}`],
  ['roman_eating_disorder_reply', `Roman sent Sam an eating-disorder safety reply. ${CHECK}`],
] as const;
const BOTH = [true, false];

// The app's two places for a chat: Messages over its inbox, and Clients over the list and the file.
const Tab = createBottomTabNavigator<CoachTabParamList>();
const Clients = createNativeStackNavigator<ClientsStackParamList>();
const Inbox = createNativeStackNavigator<MessagesStackParamList>();
const ref = createNavigationContainerRef<CoachTabParamList>();
const Nothing = () => null;
const MessagesTab = () => (
  <Inbox.Navigator screenOptions={{ headerShown: false }}>
    <Inbox.Screen name="MessagesInbox" component={Nothing} />
    <Inbox.Screen name="ClientMessages" component={Nothing} />
  </Inbox.Navigator>
);
const ClientsTab = () => (
  <Clients.Navigator screenOptions={{ headerShown: false }}>
    <Clients.Screen name="ClientsList" component={Nothing} />
    <Clients.Screen name="ClientDetail" component={ClientDetailScreen} />
    <Clients.Screen name="ClientMessages" component={Nothing} />
  </Clients.Navigator>
);
const mount = () => render(
  <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
    <NavigationContainer ref={ref} initialState={{ index: 1, routes: [
      { name: 'Messages' },
      { name: 'ClientsStack', state: { index: 1, routes: [{ name: 'ClientsList' }, { name: 'ClientDetail', params }] } },
    ] }}>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Messages" component={MessagesTab} />
        <Tab.Screen name="ClientsStack" component={ClientsTab} />
      </Tab.Navigator>
    </NavigationContainer>
  </SafeAreaInsetsContext.Provider>,
);
const root = () => ref.getRootState();
const stackOf = (tab: string) => root().routes.find((r) => r.name === tab)?.state?.routes.map((r) => r.name);

const summaryRead = coachApi.getClientSummary as jest.Mock;
const dismiss = commandCenterApi.dismissAlert as jest.Mock;
let openAlert: unknown;

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.coachTabsV2 = true;
  useCoachStore.getState().reset();
  const now = new Date();
  const monday = bucketDateLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
  openAlert = alertOf('roman_crisis_reply');
  summaryRead.mockReset().mockImplementation(async () => ({
    data: { client_name: 'Sam Rivera', profile: {}, today: {}, open_safety_alert: openAlert },
  }));
  (coachApi.getClientTimeline as jest.Mock).mockReset().mockResolvedValue({ data: { meals: [], checkIns: [], weights: [] } });
  (coachApi.getClientWeek as jest.Mock).mockReset().mockResolvedValue({ data: { week_start: monday, today: getTodayString(), assignments: [] } });
  (macrosApi.currentForClient as jest.Mock).mockReset().mockResolvedValue({ data: null });
  (coachApi.getClients as jest.Mock).mockReset().mockResolvedValue({ data: [{ id: 'client-test', name: 'Sam Rivera', role: 'student', archived_at: null }] });
  dismiss.mockReset().mockResolvedValue({ data: { ok: true } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each(BOTH.flatMap((on) => LINES.map(([type, line]) => [on, type, line] as const)))(
  'coachTabsV2 %s: an open %s shows one calm card at the top of the file, on every tab: the approved line, Message and Dismiss, nothing else',
  async (on, type, line) => {
    mockFlags.coachTabsV2 = on;
    openAlert = alertOf(type);
    const view = await mount();
    const card = await view.findByTestId('file-safety-alert');
    const words = within(card).getAllByText(/./).map((t) => t.props.children);
    expect(words).toEqual([line, 'Message Sam', 'Dismiss']);
    expect(within(card).getByRole('button', { name: 'Dismiss alert for Sam Rivera' })).toBeTruthy();
    expect(card.props['ph-no-capture']).toBe(true); // out of analytics capture, as in Actions
    const texts = view.getAllByText(/./).map((t) => t.props.children); // screen order
    expect(texts.indexOf(line)).toBeLessThan(texts.indexOf('paused-plans')); // above everything else in the file
    for (const tab of ['Summary', 'Logs', 'Progress']) {
      await fireEvent.press(view.getByLabelText(tab));
      expect(view.getByTestId('file-safety-alert')).toBeTruthy();
    }
    expect(HapticService.softImpact).not.toHaveBeenCalled(); // none on arrival
  },
);

it.each(BOTH.flatMap((on) => [[on, 'no open alert', null], [on, "another coach's client (Client not found)", 'gone']] as const))(
  'coachTabsV2 %s: %s shows no card', async (on, _case, read) => {
    mockFlags.coachTabsV2 = on;
    openAlert = null;
    if (read === 'gone') summaryRead.mockResolvedValue({ data: { error: 'Client not found', open_safety_alert: alertOf('roman_crisis_reply') } });
    const view = await mount();
    expect(await view.findByText('paused-plans')).toBeTruthy(); // the file, read and drawn
    expect(summaryRead).toHaveBeenCalledWith('client-test', getTodayString());
    expect(view.queryByTestId('file-safety-alert')).toBeNull();
  },
);

it.each(BOTH)('coachTabsV2 %s: Message Sam on the card opens the chat (on: in Messages over the inbox, the file kept in Clients; off: over the file)', async (on) => {
  mockFlags.coachTabsV2 = on;
  const view = await mount();
  await fireEvent.press(await view.findByTestId('file-safety-message'));
  expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
  const tab = root().routes[root().index].name;
  expect([tab, ref.getCurrentRoute()?.name, ref.getCurrentRoute()?.params]).toEqual([on ? 'Messages' : 'ClientsStack', 'ClientMessages', CHAT]);
  expect([stackOf('Messages'), stackOf('ClientsStack')]).toEqual(on
    ? [['MessagesInbox', 'ClientMessages'], ['ClientsList', 'ClientDetail']]
    : [undefined, ['ClientsList', 'ClientDetail', 'ClientMessages']]);
});

it('Dismiss clears the alert on the server, then the card shows the next open one, and hides when none is left', async () => {
  const view = await mount();
  await view.findByText(LINES[0][1]);
  openAlert = alertOf('roman_urgent_reply'); // the server's next open alert after the crisis one
  await fireEvent.press(view.getByTestId('file-safety-dismiss'));
  expect(dismiss).toHaveBeenLastCalledWith('alert-roman_crisis_reply');
  expect(await view.findByText(LINES[1][1])).toBeTruthy();
  expect(HapticService.success).toHaveBeenCalledTimes(1);
  openAlert = null;
  await fireEvent.press(view.getByTestId('file-safety-dismiss'));
  expect(dismiss).toHaveBeenLastCalledWith('alert-roman_urgent_reply');
  await waitFor(() => expect(view.queryByTestId('file-safety-alert')).toBeNull());
  await waitFor(() => expect([HapticService.success, HapticService.error].map((h) => (h as jest.Mock).mock.calls.length)).toEqual([2, 0]));
  await waitFor(() => expect(summaryRead).toHaveBeenCalledTimes(3)); // the file's read, then one after each Dismiss
  expect(view.queryByTestId('file-safety-alert')).toBeNull();
});

it('a failed Dismiss keeps the card and says so in the Actions queue words, with one error haptic', async () => {
  dismiss.mockRejectedValue(new Error('offline'));
  const view = await mount();
  await view.findByText(LINES[0][1]);
  await fireEvent.press(view.getByTestId('file-safety-dismiss'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
    'Could not dismiss alert', 'The alert for Sam Rivera could not be dismissed. Please try again.', [{ text: 'OK' }],
  ));
  expect([HapticService.error, HapticService.success].map((h) => (h as jest.Mock).mock.calls.length)).toEqual([1, 0]);
  expect(view.getByText(LINES[0][1])).toBeTruthy();
  await waitFor(() => expect(view.getByTestId('file-safety-dismiss').props.accessibilityState).toMatchObject({ disabled: false, busy: false }));
  expect(summaryRead).toHaveBeenCalledTimes(1); // no read after a failed Dismiss
});

it.each(BOTH)("coachTabsV2 %s: the file reused for B while A's first read is slow: A's late read changes nothing on B's file", async (on) => {
  mockFlags.coachTabsV2 = on;
  openAlert = null;
  const B = { clientId: 'client-b', clientName: 'Alex Kim' };
  const summary = (name: string, kcal: number) => ({ data: { client_name: name, profile: {}, today: { total_calories: kcal } } });
  let lateA: (v: unknown) => void = () => undefined;
  summaryRead.mockImplementation((id: string) => (id === B.clientId ? Promise.resolve(summary(B.clientName, 1400))
    : new Promise((r) => { lateA = r; })));
  const view = await mount();
  const key = ref.getCurrentRoute()?.key;
  await act(async () => ref.navigate('ClientsStack', { screen: 'ClientDetail', params: B })); // as Overview or a push opens it
  expect(ref.getCurrentRoute()?.key).toBe(key); // the same file, now B's
  await fireEvent.press(await view.findByLabelText('Summary'));
  expect(view.getByText('summary-body Alex Kim 1400')).toBeTruthy();
  await act(async () => lateA(summary('Sam Rivera', 2600)));
  expect([view.queryByText(/Sam Rivera/), view.getByText('summary-body Alex Kim 1400')]).toEqual([null, expect.anything()]);
});

it.each(BOTH)('coachTabsV2 %s: the pinned Message Sam opens the chat in Messages, as the card does (off: none pinned; the file opens it over itself, as on main)', async (on) => {
  mockFlags.coachTabsV2 = on;
  openAlert = null;
  const view = await mount();
  await view.findByText('paused-plans');
  if (on) await fireEvent.press(view.getByTestId('file-message'));
  else {
    expect(view.queryByTestId('file-message')).toBeNull();
    await fireEvent.press(view.getByLabelText('Open messages'));
  }
  expect([root().routes[root().index].name, ref.getCurrentRoute()?.name, ref.getCurrentRoute()?.params])
    .toEqual([on ? 'Messages' : 'ClientsStack', 'ClientMessages', CHAT]);
  expect([stackOf('Messages'), stackOf('ClientsStack')]).toEqual(on
    ? [['MessagesInbox', 'ClientMessages'], ['ClientsList', 'ClientDetail']]
    : [undefined, ['ClientsList', 'ClientDetail', 'ClientMessages']]);
});

it("the file reused for another client (as Overview opens it): A's late read or late Dismiss never touches B's card", async () => {
  const B = { clientId: 'client-b', clientName: 'Alex Kim' };
  const lineB = LINES[1][1].replace('Sam', 'Alex');
  const summary = (name: string, alert: unknown) => ({ data: { client_name: name, profile: {}, today: {}, open_safety_alert: alert } });
  let lateRead: (v: unknown) => void = () => undefined;
  let lateDismiss: (v: unknown) => void = () => undefined;
  let firstA = true;
  summaryRead.mockImplementation((id: string) => {
    if (id === B.clientId) return Promise.resolve(summary(B.clientName, alertOf('roman_urgent_reply')));
    if (firstA) { firstA = false; return new Promise((r) => { lateRead = r; }); }
    return Promise.resolve(summary('Sam Rivera', alertOf('roman_crisis_reply')));
  });
  dismiss.mockImplementation(() => new Promise((r) => { lateDismiss = r; }));
  const view = await mount();
  const key = ref.getCurrentRoute()?.key;
  const open = (to: typeof params) => act(async () => ref.navigate('ClientsStack', { screen: 'ClientDetail', params: to }));
  await open(B); // A's first read still in flight
  expect(ref.getCurrentRoute()?.key).toBe(key); // the same file, now B's
  expect(await view.findByText(lineB)).toBeTruthy();
  await act(async () => lateRead(summary('Sam Rivera', alertOf('roman_crisis_reply'))));
  expect([view.queryByText(LINES[0][1]), view.getAllByTestId('file-safety-alert').length]).toEqual([null, 1]);
  await open(params);
  // A's crisis alert; the server is slow (the press resolves when Dismiss does, so it is awaited at the end).
  const pressed = fireEvent.press(await view.findByTestId('file-safety-dismiss'));
  expect(dismiss).toHaveBeenCalledWith('alert-roman_crisis_reply');
  await open(B);
  expect(await view.findByText(lineB)).toBeTruthy();
  await act(async () => lateDismiss({ data: { ok: true } }));
  await pressed;
  expect(view.getByText(lineB)).toBeTruthy(); // B's alert stays
  expect(summaryRead.mock.calls.map(([id]) => id)).toEqual(['client-test', 'client-b', 'client-test', 'client-b']); // no re-read of A
  await fireEvent.press(view.getByTestId('file-safety-message'));
  expect([ref.getCurrentRoute()?.name, ref.getCurrentRoute()?.params]).toEqual(['ClientMessages', B]);
});
