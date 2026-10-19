/**
 * SAFETY-CHAT-ROUTE (agent 159; owner COACH-CHAT-BACK op 1, #CARD-MESSAGE-DEST op 1): a coach answering a Roman safety
 * alert, or sending the check-in a weekly insight drafted, lands in that client's chat, and Back goes where they came
 * from. The real CoachSafetyAlertScreen and ClientInsightScreen in real tabs and stacks shaped like CoachNavigator's
 * (both screens live in Clients; Messages is the inbox and the chat; Back between tabs is `history` with the six tabs,
 * as CoachNavigator sets it), both coachTabsV2 states. Which alerts a coach can read is the server's rule (backend
 * test/rls/open-safety-alert-rls.spec.ts); here the chat is always the alert's or the insight's own client.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import CoachSafetyAlertScreen from '../screens/coach/CoachSafetyAlertScreen';
import ClientInsightScreen from '../screens/coach/ClientInsightScreen';
import type { ClientsStackParamList, CoachTabParamList, MessagesStackParamList } from '../navigation/CoachNavigator';
import { commandCenterApi } from '../services/commandCenterApi';
import coachAiApi from '../api/coachAi';
import { featureFlags } from '../config/featureFlags';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachTabsV2: true } }));
const mockFlags = featureFlags as Record<string, boolean>;
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn(), warning: jest.fn(), error: jest.fn(),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  commandCenterApi: { getSafetyAlert: jest.fn() },
}));
jest.mock('../api/coachAi', () => ({ __esModule: true, default: { getDraft: jest.fn() } }));

const JANE = { clientId: 'client-1', clientName: 'Jane Doe' };
const OTHER = { clientId: 'client-2', clientName: 'Ben Ode' };
const SENT = '2026-10-18T09:00:00.000Z';
// The weekly insight's own check-in, prefilled in the chat's composer (buildCheckInTemplate, unchanged).
const DRAFT = 'Hey Jane — quick check-in.\n\nWins I noticed: Four workouts.\n\nHow are you feeling about the week ahead?';
const ENTRIES = [
  ["a safety alert from its card (Overview's Actions)", 'CoachSafetyAlert',
    { alertType: 'roman_crisis_reply', ...JANE, quote: null, sentAt: SENT }, 'coach-safety-alert-message', JANE],
  ['a safety alert by id (its push or inbox row)', 'CoachSafetyAlert', { alertId: 'alert-1' }, 'coach-safety-alert-message', JANE],
  ["a weekly insight's Send check-in", 'ClientInsight', { draftId: 'draft-1', ...JANE }, 'insight-send-checkin',
    { ...JANE, initialDraft: DRAFT }],
] as const;
type Entry = (typeof ENTRIES)[number];
const BOTH = [true, false];

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
    <Clients.Screen name="CoachSafetyAlert" component={CoachSafetyAlertScreen} />
    <Clients.Screen name="ClientInsight" component={ClientInsightScreen} />
    <Clients.Screen name="ClientMessages" component={Nothing} />
  </Clients.Navigator>
);
// The coach is on the alert or the insight in Clients, over the client list (as every entry opens them).
const mount = (screen: Entry[1], params: Entry[2]) => render(
  <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
    <NavigationContainer ref={ref} initialState={{ index: 1, routes: [
      { name: 'Messages' },
      { name: 'ClientsStack', state: { index: 1, routes: [{ name: 'ClientsList' }, { name: screen, params }] } },
    ] }}>
      <Tab.Navigator backBehavior={mockFlags.coachTabsV2 ? 'history' : undefined} screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Messages" component={MessagesTab} />
        <Tab.Screen name="ClientsStack" component={ClientsTab} />
      </Tab.Navigator>
    </NavigationContainer>
  </SafeAreaInsetsContext.Provider>,
);
const root = () => ref.getRootState();
const focusedTab = () => root().routes[root().index].name;
const stackOf = (tab: string) => root().routes.find((r) => r.name === tab)?.state?.routes;
const namesOf = (tab: string) => stackOf(tab)?.map((r) => r.name);
const here = () => [focusedTab(), ref.getCurrentRoute()?.name];

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.coachTabsV2 = true;
  (commandCenterApi.getSafetyAlert as jest.Mock).mockReset().mockResolvedValue({ data: {
    alert_id: 'alert-1', client_id: JANE.clientId, client_name: JANE.clientName, alert_type: 'roman_crisis_reply',
    created_at: SENT, dismissed_at: null, quote: null, sent_at: SENT,
  } });
  (coachAiApi.getDraft as jest.Mock).mockReset().mockResolvedValue({ data: {
    id: 'draft-1',
    generatedPayload: { summary: 'A steady week', wins: ['Four workouts'], concerns: [], suggested_actions: [], questions_for_coach: [] },
    modelUsed: 'model', tokensIn: 1, tokensOut: 1, costCents: 0,
  } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  const overlaps = jest.mocked(console.error).mock.calls.filter(([m]) => String(m).includes('overlapping act()'));
  jest.restoreAllMocks();
  expect(overlaps).toEqual([]); // TEST-LEAK: acts out of order leave React's act scope stuck for every later test
});

it.each(BOTH.flatMap((on) => ENTRIES.map((entry) => [on, ...entry] as const)))(
  "coachTabsV2 %s: %s opens that client's chat (on: in Messages over the inbox, the screen kept in Clients; off: over it); Back lands there",
  async (on, _label, screen, params, button, chat) => {
    mockFlags.coachTabsV2 = on;
    const view = await mount(screen, params);
    await fireEvent.press(await view.findByTestId(button));
    expect([...here(), ref.getCurrentRoute()?.params]).toEqual([on ? 'Messages' : 'ClientsStack', 'ClientMessages', chat]);
    expect([namesOf('Messages'), namesOf('ClientsStack')]).toEqual(on
      ? [['MessagesInbox', 'ClientMessages'], ['ClientsList', screen]]
      : [undefined, ['ClientsList', screen, 'ClientMessages']]);
    await act(async () => ref.goBack());
    expect(here()).toEqual(on ? ['Messages', 'MessagesInbox'] : ['ClientsStack', screen]);
    if (on) {
      await act(async () => ref.goBack()); // the inbox is Messages' root: Back returns to the tab the coach came from
      expect(here()).toEqual(['ClientsStack', screen]);
    }
    expect(ref.getCurrentRoute()?.params).toEqual(params); // the same alert or insight, as the coach left it
  },
);

it.each(ENTRIES)(
  "flag on: %s with another client's chat left open in Messages replaces it with this client's, over the same inbox",
  async (_label, screen, params, button, chat) => {
    const view = await mount(screen, params);
    await act(async () => ref.navigate('Messages', { screen: 'ClientMessages', params: OTHER, initial: false }));
    const [inbox, other] = stackOf('Messages') ?? [];
    expect([inbox?.name, other?.params]).toEqual(['MessagesInbox', OTHER]);
    await act(async () => ref.navigate('ClientsStack'));
    expect(here()).toEqual(['ClientsStack', screen]);
    await fireEvent.press(await view.findByTestId(button));
    const [inboxNow, chatNow] = stackOf('Messages') ?? [];
    expect([focusedTab(), stackOf('Messages')?.length, inboxNow?.key, chatNow?.name, chatNow?.params])
      .toEqual(['Messages', 2, inbox?.key, 'ClientMessages', chat]);
    expect(chatNow?.key).not.toBe(other?.key); // a fresh chat for this client, never the other one's screen
    await act(async () => ref.goBack());
    expect(here()).toEqual(['Messages', 'MessagesInbox']);
  },
);
