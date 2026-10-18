import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { lightTokens, typography } from '../../theme/tokens';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockFlags = { coachCommunity: true, mwbPrograms: true, teamMode: true };
const mockTeam = { role: 'head_coach', hasSubCoaches: false };
let mockUnreadCount = 0;
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../hooks/useCoachRoleType', () => ({ useCoachTeamStatus: () => mockTeam }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens }),
}));
jest.mock('../../services/api', () => ({ coachApi: { getUnreadCounts: async () => ({ data: { total: mockUnreadCount } }) } }));
jest.mock('../../services/notificationsApi', () => ({ fetchUnreadCount: async () => 0 }));
jest.mock('../../services/commandCenterApi', () => ({ __USING_MOCK_DATA: true }));
jest.mock('../../components/NotificationBadge', () => () => null);
jest.mock('../../components/purchases/withNonP2PPurchaseGate', () => ({
  withNonP2PPurchaseGate: (screen: unknown) => screen,
}));
jest.mock('../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').Text, { testID: name }, name),
}));

// Keep real tab/stack registrations, with only destination contents replaced.
const navSource = fs.readFileSync(path.join(__dirname, '..', 'CoachNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  jest.doMock(`../${modulePath}`, () => ({
    __esModule: true, default: () => <Text>{modulePath}</Text>,
  }));
}
jest.doMock('../../screens/coach/ed/FirstPaymentWowHost', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
for (const name of ['ProgramsStackNavigator', 'CoachCommunityNavigator']) {
  jest.doMock(`../${name}`, () => ({ __esModule: true, default: () => <Text>{name}</Text> }));
}
const CoachNavigator = require('../CoachNavigator').default;
const { HapticService } = require('../../ui/haptics/haptics.service');
const originalOS = Platform.OS;

beforeEach(() => {
  mockFlags.mwbPrograms = true;
  mockFlags.coachCommunity = true;
  mockTeam.hasSubCoaches = false;
  mockUnreadCount = 0;
  HapticService.selection.mockClear();
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
});

it('renders every coach label through the fitted renderer and preserves all six destinations and selection haptics', async () => {
  const view = await render(<NavigationContainer><CoachNavigator /></NavigationContainer>);
  const tabs = [
    ['Overview', '../screens/coach/command-center/CommandCenterScreen'],
    ['Clients', '../screens/coach/ClientsListScreen'],
    ['Programs', 'ProgramsStackNavigator'],
    ['Messages', '../screens/coach/MessagesScreen'],
    ['Community', 'CoachCommunityNavigator'],
    ['Settings', '../screens/coach/SettingsScreen'],
  ];
  for (const [label, destination] of tabs) {
    await fireEvent.press(view.getByLabelText(new RegExp(`^${label}(, tab, \\d of \\d)?$`)));
    expect(await view.findByText(destination)).toBeTruthy();
    const text = view.getByText(label);
    expect(text.props).toMatchObject({
      numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8, maxFontSizeMultiplier: 1.3,
    });
    expect(StyleSheet.flatten(text.props.style)).toMatchObject({
      ...typography.tabLabelActive, marginHorizontal: -5, alignSelf: 'stretch', textAlign: 'center',
    });
  }
  expect(HapticService.selection).toHaveBeenCalledTimes(tabs.length);
  expect(StyleSheet.flatten(view.getByText('Overview').props.style)).toMatchObject({
    ...typography.tabLabel, color: lightTokens.textMuted,
  });
});

it('keeps the legacy Templates and optional Team labels and destinations', async () => {
  mockFlags.mwbPrograms = false;
  mockTeam.hasSubCoaches = true;
  const view = await render(<NavigationContainer><CoachNavigator /></NavigationContainer>);
  for (const [label, destination] of [
    ['Templates', '../screens/coach/ProgramTemplatesScreen'],
    ['Team', '../screens/coach/TeamManagementScreen'],
  ]) {
    await fireEvent.press(view.getByLabelText(new RegExp(`^${label}(, tab, \\d of \\d)?$`)));
    expect(await view.findByText(destination)).toBeTruthy();
    expect(view.getByText(label).props.adjustsFontSizeToFit).toBe(true);
  }
});

describe.each(['ios', 'android'] as const)('%s tab accessibility', (os) => {
  it.each([0, 7, 105])('retains every tab role, position and Messages badge at %i unread', async (unread) => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
    mockFlags.coachCommunity = false; // launch bar: five tabs
    mockUnreadCount = unread;
    const view = await render(<NavigationContainer><CoachNavigator /></NavigationContainer>);
    const badge = unread > 99 ? '99+' : unread;
    const names = ['Overview', 'Clients', 'Programs', unread ? `Messages, ${badge}` : 'Messages', 'Settings'];
    expect(view.getByLabelText(os === 'ios' ? `${names[3]}, tab, 4 of 5` : names[3])).toBeTruthy();
    const tabs = view.getAllByRole('tab');
    expect(tabs).toHaveLength(names.length);
    for (const [index, name] of names.entries()) {
      const label = os === 'ios' ? `${name}, tab, ${index + 1} of 5` : name;
      expect(view.getByRole('tab', { name: label })).toBe(tabs[index]);
      expect(tabs[index].props.accessibilityRole).toBe('tab');
    }
    const messages = view.getByRole('tab', { name: os === 'ios' ? `${names[3]}, tab, 4 of 5` : names[3] });
    await fireEvent.press(messages);
    expect(view.getByRole('tab', { name: os === 'ios' ? `${names[3]}, tab, 4 of 5` : names[3] })).toBeSelected();
    expect(await view.findByText('../screens/coach/MessagesScreen')).toBeTruthy();
    expect(view.getByText('Overview').props.adjustsFontSizeToFit).toBe(true);
  });
});
