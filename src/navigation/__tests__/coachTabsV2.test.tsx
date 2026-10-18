/**
 * COACHTABS (owner 10-15: "its overview, programs, money, calendar, messages,
 * and clients - team is a switch to flip under clients in v1.1"). The real
 * CoachNavigator with screen contents replaced. Flag on: six tabs in that
 * order; Settings, Community and Team stay registered and open from entries.
 * Flag off: today's bar. Either way every navigate() target found by search
 * (rg "navigate\('(SettingsStack|ClientsStack|...)'") and every coach push
 * target lands.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import {
  NavigationContainer, createNavigationContainerRef, useNavigation, type NavigationProp, type ParamListBase,
} from '@react-navigation/native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockFlags = { coachCommunity: true, mwbPrograms: true, teamMode: true, coachBrief: true, coachTabsV2: true };
const mockTeam = { role: 'head_coach', hasSubCoaches: true };
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../hooks/useCoachRoleType', () => ({ useCoachTeamStatus: () => mockTeam }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens }),
}));
jest.mock('../../services/api', () => ({ coachApi: { getUnreadCounts: async () => ({ data: { total: 0 } }) } }));
jest.mock('../../services/notificationsApi', () => ({ fetchUnreadCount: async () => 0 }));
const mockCommandCenter = { __USING_MOCK_DATA: true };
jest.mock('../../services/commandCenterApi', () => mockCommandCenter);
jest.mock('../../components/NotificationBadge', () => () => null);
jest.mock('../../components/purchases/withNonP2PPurchaseGate', () => ({
  withNonP2PPurchaseGate: (screen: unknown) => screen,
}));
jest.mock('../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').Text, { testID: name }, name),
}));

const navSource = fs.readFileSync(path.join(__dirname, '..', 'CoachNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: () => <Text>{modulePath}</Text> }));
}
// Clients shows whether the navigator offers its Team entry.
function ClientsListProbe() {
  const team = React.useContext(require('../coachTeamEntry').CoachTeamEntryContext);
  return <Text>{`ClientsList team:${team}`}</Text>;
}
jest.doMock('../../screens/coach/ClientsListScreen', () => ({ __esModule: true, default: ClientsListProbe }));
// COACHTABS-NAV: the inbox, a client's file and a chat open the next screen the way the real ones do.
function probe(label: string, go: (navigation: NavigationProp<ParamListBase>) => void) {
  return function Probe() {
    const navigation = useNavigation<NavigationProp<ParamListBase>>();
    return <Text onPress={() => go(navigation)}>{label}</Text>;
  };
}
const CHAT = { clientId: 'client-1', clientName: 'Sam' };
type Tap = (navigation: NavigationProp<ParamListBase>) => void;
const chatTap: Tap = (n) => require('../coachInbox').openInboxChat(n, CHAT.clientId, CHAT.clientName);
let inboxTap = chatTap; // the inbox's chat row; the header-entry rows swap in Broadcasts or Community reports
const PROBES: [string, Tap][] = [
  ['MessagesScreen', (n) => inboxTap(n)],
  ['ClientDetailScreen', (n) => n.navigate('ClientMessages', CHAT)],
  ['ClientMessagesScreen', (n) => n.navigate('ContactView', { contactId: CHAT.clientId, displayName: CHAT.clientName })],
];
for (const [name, go] of PROBES) {
  jest.doMock(`../../screens/coach/${name}`, () => ({ __esModule: true, default: probe(`../screens/coach/${name}`, go) }));
}
jest.doMock('../../screens/coach/ed/FirstPaymentWowHost', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
for (const name of ['ProgramsStackNavigator', 'CoachCommunityNavigator']) {
  jest.doMock(`../${name}`, () => ({ __esModule: true, default: () => <Text>{name}</Text> }));
}
const CoachNavigator = require('../CoachNavigator').default;
const { HapticService } = require('../../ui/haptics/haptics.service');
const { COACH_PUSH_ROUTES, resolvePushTarget, attachPushNavigator, setPushSession, routePushTap } = require('../../services/pushTapRouter');

const ref = createNavigationContainerRef<ParamListBase>();
const mount = () => render(<NavigationContainer ref={ref}><CoachNavigator /></NavigationContainer>);
const focusedTab = () => ref.getRootState().routes[ref.getRootState().index].name;
const tabName = (label: string, at: number) => `${label}, tab, ${at} of 6`;
const originalOS = Platform.OS;

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockFlags.coachTabsV2 = true;
  mockCommandCenter.__USING_MOCK_DATA = true;
  mockTeam.hasSubCoaches = true;
  HapticService.selection.mockClear();
  inboxTap = chatTap;
});
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }));

const SIX = [
  ['Overview', 'grid-outline', '../screens/coach/command-center/CommandCenterScreen'],
  ['Programs', 'barbell-outline', 'ProgramsStackNavigator'],
  ['Money', 'logo-usd', '../screens/coach/money/MoneyScreen'],
  ['Calendar', 'calendar-outline', '../screens/coach/CoachBookingInboxScreen'],
  ['Messages', 'chatbubble-outline', '../screens/coach/MessagesScreen'],
  ['Clients', 'people-outline', 'ClientsList team:true'],
] as const;

it('flag on: six tabs in the owner order with their icons, labels capped at 110%, the selection haptic and a selected state', async () => {
  const view = await mount();
  expect(view.getAllByRole('tab')).toHaveLength(6);
  for (const [i, [label, icon, destination]] of SIX.entries()) {
    const tab = view.getByRole('tab', { name: tabName(label, i + 1) });
    expect(view.getAllByRole('tab')[i]).toBe(tab);
    expect(within(tab).getAllByTestId(icon).length).toBeGreaterThan(0);
    expect(within(tab).getByText(label).props).toMatchObject({ numberOfLines: 1, maxFontSizeMultiplier: 1.1 });
    await fireEvent.press(tab);
    expect(view.getByRole('tab', { name: tabName(label, i + 1) })).toBeSelected();
    expect(await view.findByText(destination)).toBeTruthy();
  }
  expect(HapticService.selection).toHaveBeenCalledTimes(6);
  for (const gone of ['Settings', 'Community', 'Team', 'Templates']) expect(view.queryByRole('tab', { name: new RegExp(`^${gone}`) })).toBeNull();
});

it('flag off: the bar is today\'s, with no Money or Calendar route and no Team entry in Clients', async () => {
  mockFlags.coachTabsV2 = false;
  const view = await mount();
  const tabs = view.getAllByRole('tab');
  expect(tabs).toHaveLength(7);
  for (const [i, n] of ['Overview', 'Clients', 'Programs', 'Messages', 'Team', 'Community', 'Settings'].entries()) {
    expect(view.getByRole('tab', { name: `${n}, tab, ${i + 1} of 7` })).toBe(tabs[i]);
  }
  expect(ref.getRootState().routeNames).not.toContain('MoneyStack');
  expect(ref.getRootState().routeNames).not.toContain('CalendarStack');
  expect(view.getByText('Clients').props.maxFontSizeMultiplier).toBe(1.3);
  await fireEvent.press(view.getByRole('tab', { name: 'Clients, tab, 2 of 7' }));
  expect(await view.findByText('ClientsList team:false')).toBeTruthy();
});

it('flag on: a coach without Team Mode has no Team route and no Team entry', async () => {
  mockTeam.hasSubCoaches = false;
  const view = await mount();
  expect(ref.getRootState().routeNames).not.toContain('TeamStack');
  await fireEvent.press(view.getByRole('tab', { name: tabName('Clients', 6) }));
  expect(await view.findByText('ClientsList team:false')).toBeTruthy();
});

it.each([
  ['SettingsStack', 'Overview', 1, 'CommandCenter'],
  ['CommunityStack', 'Messages', 5, 'Messages'],
  ['TeamStack', 'Clients', 6, 'ClientsStack'],
])('flag on: while %s is open %s stays selected, Back returns to the last tab and a tap on %s goes back to it', async (entry, label, at, tab) => {
  const view = await mount();
  await act(async () => ref.navigate('CalendarStack'));
  await act(async () => ref.navigate(entry));
  expect(focusedTab()).toBe(entry);
  expect(view.getByRole('tab', { name: tabName(label, at) })).toBeSelected();
  await act(async () => ref.goBack());
  expect(focusedTab()).toBe('CalendarStack');
  await act(async () => ref.navigate(entry));
  await fireEvent.press(view.getByRole('tab', { name: tabName(label, at) }));
  expect(focusedTab()).toBe(tab);
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
});

it('flag on: the Calendar gear opens Hours and rules with Back to the inbox', async () => {
  const view = await mount();
  await fireEvent.press(view.getByRole('tab', { name: tabName('Calendar', 4) }));
  await fireEvent.press(view.getByLabelText('Hours and rules'));
  expect(HapticService.softImpact).toHaveBeenCalled();
  expect(ref.getCurrentRoute()?.name).toBe('CoachHours');
  await act(async () => ref.goBack());
  expect(ref.getCurrentRoute()?.name).toBe('CoachBookingInbox');
});

const SETTINGS = ['SettingsHome', 'Billing', 'SupportInbox', 'CreditPackCheckout', 'CoachBrief', 'CoachSetup', 'CoachPackagesList', 'CoachMoney'];
const CLIENTS = [
  'ClientsList', 'ClientDetail', 'ClientMessages', 'InviteCodes', 'RiskBoard', 'CoachSafetyAlert', 'ClientConsultation',
  'NotificationCenter', 'NotificationPreferences', 'FeaturedCoachEditor', 'CoachWorkoutBuilder', 'CoachInvites', 'BulkInvite',
  'CoachCommunityModeration', 'CoachBroadcasts', 'CoachBookingInbox', 'CoachAvailabilityEditor', 'CoachBookingOptions',
  'CoachAppointmentTypes', 'CoachTimeOff',
];
const CALENDAR = ['CoachBookingInbox', 'CoachHours', 'CoachAvailabilityEditor', 'CoachBookingOptions', 'CoachAppointmentTypes', 'CoachTimeOff'];
type Target = [root: string, screen?: string];
const NEW_TABS: Target[] = [['MoneyStack'], ['MoneyStack', 'CoachMoney'], ['CalendarStack'], ...CALENDAR.map((s): Target => ['CalendarStack', s])];
const targets = (on: boolean): Target[] => [
  ...SETTINGS.map((s): Target => ['SettingsStack', s]),
  ...CLIENTS.map((s): Target => ['ClientsStack', s]),
  ...['SettingsStack', 'ClientsStack', 'CommandCenter', 'Templates', 'Messages', 'TeamStack', 'CommunityStack'].map((r): Target => [r]),
  ...(on ? NEW_TABS : []),
  ...Object.keys(COACH_PUSH_ROUTES).map((key): Target => {
    const t = resolvePushTarget('coach', key);
    return [t.root, t.screen];
  }),
];

it.each([true, false])('coachTabsV2 %s: every navigate() and push target lands on its tab and screen', async (on) => {
  mockFlags.coachTabsV2 = on;
  await mount();
  for (const [root, screen] of targets(on)) {
    await act(async () => ref.navigate(root, screen ? { screen, params: {}, initial: false } : undefined));
    const landed = { root, screen, tab: focusedTab(), route: screen && ref.getCurrentRoute()?.name };
    expect(landed).toEqual({ root, screen, tab: root, route: screen });
  }
});

// COACHTABS-CLIENTS-ROOT: Clients is a tab and, with the six tabs, coaches land on Overview, so Clients is not open
// yet. Every jump into a Clients screen must still open on top of the client list: Back and the Clients tab land on it.
// Rows: every navigate('ClientsStack', { screen }) in src (read here, so new ones join), sent with no `initial`, and
// every coach push into Clients through the real push router. Each row is a fresh launch, then Messages, then the jump.
// Flag off (real coaches land on Clients) behaves the same as today.
const SRC = path.join(__dirname, '..', '..');
const SOURCES = fs.readdirSync(SRC, { encoding: 'utf8', recursive: true })
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('__tests__'))
  .map((file) => [path.basename(file), fs.readFileSync(path.join(SRC, file), 'utf8')] as const);
const jumps = new Map<string, string>();
for (const [file, source] of SOURCES) {
  for (const [, screen] of source.matchAll(/navigate\(\s*["']ClientsStack["'],\s*\{\s*screen:\s*["'](\w+)["']/g)) {
    if (screen !== 'ClientsList') jumps.set(`${file} > ${screen}`, screen);
  }
}
const intoClients = (on: boolean) => {
  mockFlags.coachTabsV2 = on;
  const pushes = Object.keys(COACH_PUSH_ROUTES).filter((key) => resolvePushTarget('coach', key).root === 'ClientsStack');
  return [
    ...[...jumps].map(([entry, screen]) => [on, entry, screen, undefined] as const),
    ...pushes.map((key) => [on, `push ${key}`, resolvePushTarget('coach', key).screen as string, key] as const),
  ];
};

it.each([...intoClients(true), ...intoClients(false)])('coachTabsV2 %s: %s opens on top of the client list; Back and the Clients tab land on it', async (on, _entry, screen, push) => {
  mockFlags.coachTabsV2 = on;
  mockCommandCenter.__USING_MOCK_DATA = false; // what ships
  const view = await mount();
  expect(focusedTab()).toBe(on ? 'CommandCenter' : 'ClientsStack');
  await act(async () => ref.navigate('Messages'));
  await act(async () => {
    if (!push) return ref.navigate('ClientsStack', { screen, params: { clientId: 'client-1', clientName: 'Sam' } });
    attachPushNavigator(ref);
    setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' });
    routePushTap(push, { clientId: 'client-1' });
  });
  const clientsStack = () => ref.getRootState().routes.find((r) => r.name === 'ClientsStack')?.state?.routes.map((r) => r.name);
  expect([focusedTab(), clientsStack()]).toEqual(['ClientsStack', ['ClientsList', screen]]);
  await act(async () => ref.goBack());
  expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual(['ClientsStack', 'ClientsList']);
  await act(async () => ref.navigate('Messages'));
  await fireEvent.press(view.getByRole('tab', { name: /^Clients, tab/ }));
  expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual(['ClientsStack', 'ClientsList']);
});

// COACH-CHAT-BACK (owner op 1: "Chats get their own place in the Messages tab, like any inbox"). The inbox probe
// opens a chat with the real `openInboxChat` both inboxes use; a client's file opens it the way ClientDetail does.
const stackOf = (tab: string) => ref.getRootState().routes.find((r) => r.name === tab)?.state?.routes.map((r) => r.name);
const MESSAGES_TAB = tabName('Messages', 5);

it('flag on: a chat opened from Messages opens in Messages; Back (also from its contact page) and the Messages tab return to the inbox', async () => {
  mockCommandCenter.__USING_MOCK_DATA = false; // what ships: the coach lands on Overview
  const view = await mount();
  await fireEvent.press(view.getByRole('tab', { name: MESSAGES_TAB }));
  await fireEvent.press(view.getByText('../screens/coach/MessagesScreen'));
  expect([focusedTab(), stackOf('Messages'), stackOf('ClientsStack')]).toEqual(['Messages', ['MessagesInbox', 'ClientMessages'], ['ClientsList']]);
  expect(view.getByRole('tab', { name: MESSAGES_TAB })).toBeSelected();
  await fireEvent.press(view.getByText('../screens/coach/ClientMessagesScreen'));
  expect(stackOf('Messages')).toEqual(['MessagesInbox', 'ClientMessages', 'ContactView']);
  await act(async () => ref.goBack());
  expect(ref.getCurrentRoute()?.name).toBe('ClientMessages');
  await act(async () => ref.goBack());
  expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual(['Messages', 'MessagesInbox']);
  await fireEvent.press(view.getByText('../screens/coach/MessagesScreen'));
  await fireEvent.press(view.getByRole('tab', { name: MESSAGES_TAB }));
  await waitFor(() => expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual(['Messages', 'MessagesInbox']));
});

it("flag on: a chat opened from a client's file stays in Clients; Back returns to the file", async () => {
  const view = await mount();
  await act(async () => ref.navigate('ClientsStack', { screen: 'ClientDetail', params: CHAT }));
  await fireEvent.press(view.getByText('../screens/coach/ClientDetailScreen'));
  expect([focusedTab(), stackOf('ClientsStack'), stackOf('Messages')]).toEqual(['ClientsStack', ['ClientsList', 'ClientDetail', 'ClientMessages'], undefined]);
  await act(async () => ref.goBack());
  expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual(['ClientsStack', 'ClientDetail']);
});

it("flag off: Messages is today's single screen; its chat opens in Clients and Back lands on the client list", async () => {
  mockFlags.coachTabsV2 = false;
  mockCommandCenter.__USING_MOCK_DATA = false;
  const view = await mount();
  await fireEvent.press(view.getByRole('tab', { name: 'Messages, tab, 4 of 7' }));
  await fireEvent.press(view.getByText('../screens/coach/MessagesScreen'));
  expect([focusedTab(), stackOf('ClientsStack'), stackOf('Messages')]).toEqual(['ClientsStack', ['ClientsList', 'ClientMessages'], undefined]);
  await act(async () => ref.goBack());
  expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual(['ClientsStack', 'ClientsList']);
});

it.each([true, false].flatMap((on) => [[on, 'CoachBroadcasts', 'CoachBroadcastComposer'], [on, 'CoachCommunityModeration', 'CoachCommunityPostDetail']] as const))(
  'coachTabsV2 %s: the Messages header opens %s (then %s) where Back returns to the inbox, or off to the client list as today', async (on, screen, next) => {
    mockFlags.coachTabsV2 = on;
    mockCommandCenter.__USING_MOCK_DATA = false;
    inboxTap = (n) => require('../coachInbox').openInboxScreen(n, screen);
    const [tab, root] = on ? ['Messages', 'MessagesInbox'] : ['ClientsStack', 'ClientsList'];
    const view = await mount();
    await fireEvent.press(view.getByRole('tab', { name: on ? MESSAGES_TAB : 'Messages, tab, 4 of 7' }));
    await fireEvent.press(view.getByText('../screens/coach/MessagesScreen'));
    await act(async () => ref.navigate(next, { postId: 'post-1' }));
    expect([focusedTab(), stackOf(tab)]).toEqual([tab, [root, screen, next]]);
    await act(async () => ref.goBack());
    await act(async () => ref.goBack());
    expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual([tab, root]);
  });

// COACHTABS-NAV (LO-773 N4 and the jumps into Settings). Rows: every navigate('<tab>Stack', { screen, ... }) in src
// that opens Settings or a tab's root, read here with its own `initial` / `pop` (comments skipped), so new calls join;
// and every coach push into Settings or to a tab's root through the real push router. Each row is a fresh launch.
// Into Settings: Settings home stays beneath, so Back lands on it. To a root: back to the one already open, never a
// second copy over the screen above it.
const ROOTS: Record<string, string> = {
  ClientsStack: 'ClientsList', SettingsStack: 'SettingsHome', MoneyStack: 'CoachMoney', CalendarStack: 'CoachBookingInbox', Messages: 'MessagesInbox',
};
const ABOVE: Record<string, string> = {
  ClientsStack: 'ClientDetail', SettingsStack: 'Billing', MoneyStack: 'Billing', CalendarStack: 'CoachHours', Messages: 'ClientMessages',
};
type Jump = { tab: string; screen?: string; initial?: false; pop?: true };
const CALLS = SOURCES.flatMap(([file, source]) =>
  [...source.matchAll(/navigate\(\s*["'](\w+Stack)["'],\s*\{/g)].flatMap((m) => {
    const start = Number(m.index);
    if (/\/\/|^\s*\*/.test(source.slice(source.lastIndexOf('\n', start) + 1, start))) return [];
    let end = start + m[0].length;
    for (let depth = 1; depth > 0 && end < source.length; end += 1) depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
    const call = source.slice(start, end);
    const jump: Jump = {
      tab: m[1],
      screen: /screen:\s*["'](\w+)["']/.exec(call)?.[1],
      ...(/initial:\s*false/.test(call) ? { initial: false as const } : {}),
      ...(/pop:\s*true/.test(call) ? { pop: true as const } : {}),
    };
    return [[`${file}:${source.slice(0, start).split('\n').length}`, jump] as const];
  }));
const settingsOrRoot = (j: Jump) => j.screen !== undefined && (j.tab === 'SettingsStack' || j.screen === ROOTS[j.tab]);

it('every navigate() into Settings in src keeps Settings home beneath (`initial: false`), or is Settings home with `pop`', () => {
  const settings = CALLS.filter(([, j]) => j.tab === 'SettingsStack');
  expect(settings.length).toBeGreaterThanOrEqual(10);
  for (const [entry, j] of settings) {
    expect([entry, j.screen === 'SettingsHome' ? j.pop : j.initial]).toEqual([entry, j.screen === 'SettingsHome' ? true : false]);
  }
});

const settingsAndRootJumps = (on: boolean) => {
  mockFlags.coachTabsV2 = on;
  const tabs = on ? Object.keys(ROOTS) : ['ClientsStack', 'SettingsStack'];
  const pushes = Object.keys(COACH_PUSH_ROUTES).filter((key) => {
    const { root, ...t } = resolvePushTarget('coach', key);
    return tabs.includes(root) && settingsOrRoot({ tab: root, ...t });
  });
  return [
    ...CALLS.filter(([, j]) => tabs.includes(j.tab) && settingsOrRoot(j)).map(([entry, j]) => [on, entry, j, undefined] as const),
    ...pushes.map((key) => [on, `push ${key}`, undefined, key] as const),
  ];
};

it.each([...settingsAndRootJumps(true), ...settingsAndRootJumps(false)])('coachTabsV2 %s: %s keeps its tab root beneath, never a second copy', async (on, _entry, call, push) => {
  mockFlags.coachTabsV2 = on;
  mockCommandCenter.__USING_MOCK_DATA = false; // what ships
  const j: Jump = push ? (({ root, ...t }) => ({ tab: root, ...t }))(resolvePushTarget('coach', push)) : (call as Jump);
  const root = ROOTS[j.tab];
  const toRoot = j.screen === root;
  await mount();
  if (toRoot) await act(async () => ref.navigate(j.tab, { screen: ABOVE[j.tab], params: CHAT, initial: false }));
  if (toRoot) expect(stackOf(j.tab)).toEqual([root, ABOVE[j.tab]]);
  await act(async () => ref.navigate('Templates'));
  await act(async () => {
    if (!push) return ref.navigate(j.tab, { screen: j.screen, params: {}, ...(j.initial === false ? { initial: false } : {}), ...(j.pop ? { pop: true } : {}) });
    attachPushNavigator(ref);
    setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' });
    routePushTap(push);
  });
  expect([focusedTab(), stackOf(j.tab)]).toEqual([j.tab, toRoot ? [root] : [root, j.screen]]);
  if (toRoot) return;
  await act(async () => ref.goBack());
  expect([focusedTab(), ref.getCurrentRoute()?.name]).toEqual([j.tab, root]);
});
