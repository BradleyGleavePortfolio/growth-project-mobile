import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { lightTokens, typography } from '../../theme/tokens';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockFlags = { coachCommunity: true, mwbPrograms: true, teamMode: true };
const mockTeam = { role: 'head_coach', hasSubCoaches: false };
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

beforeEach(() => {
  mockFlags.mwbPrograms = true;
  mockTeam.hasSubCoaches = false;
  HapticService.selection.mockClear();
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
    await fireEvent.press(view.getByLabelText(label));
    expect(await view.findByText(destination)).toBeTruthy();
    const text = view.getByText(label);
    expect(text.props).toMatchObject({
      numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8, maxFontSizeMultiplier: 1.3,
    });
    expect(StyleSheet.flatten(text.props.style)).toMatchObject({
      ...typography.tabLabelActive, marginHorizontal: -5, textAlign: 'center',
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
    await fireEvent.press(view.getByLabelText(label));
    expect(await view.findByText(destination)).toBeTruthy();
    expect(view.getByText(label).props.adjustsFontSizeToFit).toBe(true);
  }
});
