/**
 * COACHTABS: the entries that replace the old tabs behind
 * featureFlags.coachTabsV2. Overview's gear opens Settings, Messages opens
 * Community (only while coachCommunity is on), Hours and rules opens the four
 * booking settings, and Money has no Back on its tab root. Flag off, none of
 * this renders. Where (as in InviteCtaWiring) mounting a whole screen drags in
 * too many providers, the wiring is read from source; coachTabsV2.test.tsx
 * proves each target lands in the real navigator.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';

const mockFlags = { coachTabsV2: true, coachCommunity: true };
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getState: jest.fn(() => ({ index: 0 })) };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../../../hooks/useCalendar', () => ({ useBookingOptions: () => ({ isError: false }), bookingOptionsUnavailable: () => false }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const insets = { top: 47, bottom: 0, left: 0, right: 0 };
  return { useSafeAreaInsets: () => insets, SafeAreaInsetsContext: R.createContext(insets) };
});
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: () => new Promise(() => undefined), post: jest.fn() } }));
jest.mock('../../../components/command-center/CoachLtvDashboard', () => () => null);
jest.mock('../command-center/CoachHomeCards', () => () => null);

// Required after the flag object exists (imports are hoisted above it).
const { HapticService } = require('../../../ui/haptics/haptics.service');
const { mediumTap } = require('../../../utils/haptics');
const { CommunityEntry } = require('../CommunityEntry');
const CoachHoursScreen = require('../CoachHoursScreen').default;
const CommandCenterScreen = require('../command-center/CommandCenterScreen').default;
const MoneyBack = require('../money/MoneyBack').default;

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.coachTabsV2 = true;
  mockFlags.coachCommunity = true;
  mockNav.getState.mockReturnValue({ index: 0 });
});

// FIX721 (Opus B1): beside the gear the five labels cap at 110% (as the bar) so all stay whole at 360 pt.
const caps = (v: Awaited<ReturnType<typeof render>>) =>
  ['overview', 'at-risk', 'win-streaks', 'inbox', 'action-queue'].map((k) => within(v.getByTestId(`command-center-tab-${k}`)).getByText(/\w/).props.maxFontSizeMultiplier);
it('Overview header: a 44 pt gear opens Settings with a soft haptic; flag off it is not there', async () => {
  const view = await render(<CommandCenterScreen />);
  expect(caps(view)).toEqual([1.1, 1.1, 1.1, 1.1, 1.1]);
  const gear = view.getByLabelText('Settings');
  expect(StyleSheet.flatten(gear.props.style)).toMatchObject({ width: 44, height: 44 });
  await fireEvent.press(gear);
  expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
  expect(mockNav.navigate).toHaveBeenCalledWith('SettingsStack', { screen: 'SettingsHome', pop: true });
  mockFlags.coachTabsV2 = false;
  const off = await render(<CommandCenterScreen />);
  expect(off.queryByLabelText('Settings')).toBeNull();
  expect(caps(off)).toEqual([1.2, 1.2, 1.2, 1.2, 1.2]);
});

it('Messages header: Community opens the Community stack only while both flags are on', async () => {
  const view = await render(<CommunityEntry />);
  await fireEvent.press(view.getByLabelText('Community'));
  expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
  expect(mockNav.navigate).toHaveBeenCalledWith('CommunityStack');
  mockFlags.coachCommunity = false;
  expect((await render(<CommunityEntry />)).toJSON()).toBeNull();
  mockFlags.coachCommunity = true;
  mockFlags.coachTabsV2 = false;
  expect((await render(<CommunityEntry />)).toJSON()).toBeNull();
});

it('Hours and rules: every row opens its booking screen in the Calendar stack', async () => {
  const view = await render(<CoachHoursScreen />);
  expect(view.getByText('Hours and rules')).toBeTruthy();
  const rows: [string, unknown[]][] = [
    ['Open availability editor', ['CoachAvailabilityEditor', { coachId: 'coach-1' }]],
    ['Open booking options', ['CoachBookingOptions']],
    ['Open appointment types', ['CoachAppointmentTypes', { coachId: 'coach-1' }]],
    ['Open time off', ['CoachTimeOff']],
  ];
  for (const [label, call] of rows) {
    await fireEvent.press(view.getByLabelText(label));
    expect(mockNav.navigate).toHaveBeenLastCalledWith(...call);
  }
  expect(mediumTap).toHaveBeenCalledTimes(rows.length);
});

it('Money: no Back on the Money tab root, Back above it, and flag off Back as today', async () => {
  expect((await render(<MoneyBack />)).queryByLabelText('Go back')).toBeNull();
  mockNav.getState.mockReturnValue({ index: 1 });
  expect((await render(<MoneyBack />)).getByLabelText('Go back')).toBeTruthy();
  mockFlags.coachTabsV2 = false;
  mockNav.getState.mockReturnValue({ index: 0 });
  expect((await render(<MoneyBack />)).getByLabelText('Go back')).toBeTruthy();
});

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');
it.each([
  ['Settings Back', 'screens/coach/SettingsScreen.tsx', /featureFlags\.coachTabsV2 && navigation\.canGoBack\(\) \?[\s\S]{0,80}onPress=\{\(\) => navigation\.goBack\(\)\}[\s\S]{0,80}accessibilityLabel="Back"/],
  ['Settings Money row', 'screens/coach/SettingsScreen.tsx', /if \(featureFlags\.coachTabsV2\) navigation\.navigate\('MoneyStack', \{ screen: 'CoachMoney', pop: true \}\);/],
  ['Settings booking rows', 'screens/coach/SettingsScreen.tsx', /const bookingTab = featureFlags\.coachTabsV2 \? 'CalendarStack' : 'ClientsStack';/],
  ['Home Money card', 'screens/coach/command-center/useSetupOpener.ts', /featureFlags\.coachTabsV2\s*\?\s*navigation\.navigate\('MoneyStack', \{ screen: 'CoachMoney', pop: true \}\)/],
  ['Overview Money', 'screens/coach/command-center/CommandCenterScreen.tsx', /featureFlags\.coachTabsV2\s*\?\s*navigation\.navigate\('MoneyStack', \{ screen: 'CoachMoney', pop: true \}\)/],
  ['Team Back', 'screens/coach/TeamManagementScreen.tsx', /featureFlags\.coachTabsV2 && navigation\.canGoBack\(\) \?[\s\S]{0,80}onPress=\{\(\) => navigation\.goBack\(\)\}/],
  ['Clients Team entry', 'screens/coach/ClientsListScreen.tsx', /teamEntry \? \([\s\S]{0,120}onPress=\{\(\) => navigation\.getParent\(\)\?\.navigate\('TeamStack'\)\}[\s\S]{0,120}accessibilityLabel="Team"/],
  ['Community Back', 'navigation/CoachCommunityNavigator.tsx', /featureFlags\.coachTabsV2 \? \{[\s\S]{0,120}onPress=\{\(\) => navigation\.goBack\(\)\}[\s\S]{0,160}accessibilityLabel="Back"/],
])('%s is wired behind the flag', (_name, file, wire) => {
  expect(read(file)).toMatch(wire);
});
