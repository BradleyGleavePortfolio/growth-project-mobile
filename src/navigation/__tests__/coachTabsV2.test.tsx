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
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
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
jest.mock('../../services/commandCenterApi', () => ({ __USING_MOCK_DATA: true }));
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
jest.doMock('../../screens/coach/ed/FirstPaymentWowHost', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
for (const name of ['ProgramsStackNavigator', 'CoachCommunityNavigator']) {
  jest.doMock(`../${name}`, () => ({ __esModule: true, default: () => <Text>{name}</Text> }));
}
const CoachNavigator = require('../CoachNavigator').default;
const { HapticService } = require('../../ui/haptics/haptics.service');
const { COACH_PUSH_ROUTES, resolvePushTarget } = require('../../services/pushTapRouter');

const ref = createNavigationContainerRef<ParamListBase>();
const mount = () => render(<NavigationContainer ref={ref}><CoachNavigator /></NavigationContainer>);
const focusedTab = () => ref.getRootState().routes[ref.getRootState().index].name;
const tabName = (label: string, at: number) => `${label}, tab, ${at} of 6`;
const originalOS = Platform.OS;

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockFlags.coachTabsV2 = true;
  mockTeam.hasSubCoaches = true;
  HapticService.selection.mockClear();
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
    expect(within(tab).getByTestId(icon)).toBeTruthy();
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
