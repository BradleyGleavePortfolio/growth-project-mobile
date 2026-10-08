import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationState,
  type ParamListBase,
  type PartialState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import CanonicalColors from '../../../constants/colors';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { TeamProfile } from '../../../api/coachTeamApi';

const mockGet = jest.fn();
const mockPut = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (url: string) => mockGet(url),
    put: (url: string, payload: unknown) => mockPut(url, payload),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockColors: ThemeColors = {
  ...CanonicalColors,
  dark: CanonicalColors.textPrimary,
  white: CanonicalColors.textOnPrimary,
  gold: CanonicalColors.warning,
  orange: CanonicalColors.error,
};
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: mockColors }),
}));
jest.mock('../../../components/coach/setup/InviteShareCard', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ testID }: { testID?: string }) => ReactModule.createElement(View, { testID }),
  };
});

import CoachTeamProfileScreen from '../CoachTeamProfileScreen';
import { coachTeamApi } from '../../../api/coachTeamApi';
import { BillingSection } from '../settings/BillingSection';
import { makeStyles as settingsStyles } from '../settings/styles';

const profile: TeamProfile = {
  id: 'test-profile',
  business_name: 'Example Coaching',
  team_code: 'test-code-not-for-joining',
  client_capacity: 50,
  clients_assigned: 12,
  payouts_enabled: true,
};
const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const notConfigured = { response: { status: 404 } };
const Tab = createBottomTabNavigator();
const Clients = createNativeStackNavigator();
const Settings = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();
const ClientsList = () => <Text>Clients list</Text>;
const InviteCodes = () => <Text>Invite codes screen</Text>;
const SettingsHome = () => <Text>Settings home</Text>;
const Money = () => <Text>Money screen</Text>;
const Setup = () => <Text>Payout setup screen</Text>;

function ClientsStack() {
  return (
    <Clients.Navigator screenOptions={{ headerShown: false }}>
      <Clients.Screen name="ClientsList" component={ClientsList} />
      <Clients.Screen name="InviteCodes" component={InviteCodes} />
    </Clients.Navigator>
  );
}
function SettingsStack() {
  return (
    <Settings.Navigator initialRouteName="CoachTeamProfile" screenOptions={{ headerShown: false }}>
      <Settings.Screen name="SettingsHome" component={SettingsHome} />
      <Settings.Screen name="CoachTeamProfile" component={CoachTeamProfileScreen} />
      <Settings.Screen name="CoachMoney" component={Money} />
      <Settings.Screen name="CoachSetup" component={Setup} />
    </Settings.Navigator>
  );
}
async function mount() {
  return render(
    <NavigationContainer ref={ref}>
      <Tab.Navigator initialRouteName="SettingsStack" screenOptions={{ headerShown: false }}>
        <Tab.Screen name="ClientsStack" component={ClientsStack} />
        <Tab.Screen name="SettingsStack" component={SettingsStack} />
      </Tab.Navigator>
    </NavigationContainer>,
  );
}
type AnyState = NavigationState | PartialState<NavigationState> | undefined;
function clientsRoutes() {
  const root = ref.getRootState();
  const clients = root.routes.find((route) => route.name === 'ClientsStack');
  const state = clients?.state as AnyState;
  return state?.routes.map((route) => route.name);
}
async function openSetup() {
  mockGet.mockRejectedValueOnce(notConfigured);
  const view = await mount();
  await view.findByText('Set up your business profile');
  await act(async () => {
    await fireEvent.press(view.getByLabelText('Set up business profile'));
  });
  return view;
}
beforeEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
});

describe('TEAMPROFILE-132', () => {
  it('normalizes offline API errors instead of returning raw transport text', async () => {
    mockGet.mockRejectedValueOnce(networkError);
    await expect(coachTeamApi.getProfile()).resolves.toEqual({
      ok: false,
      reason: 'error',
      message: 'The service could not be reached. Check your connection and try again.',
    });
  });

  it('shows plain offline copy and retries the actual profile read', async () => {
    mockGet.mockRejectedValueOnce(networkError).mockResolvedValueOnce({ data: profile });
    const view = await mount();
    await view.findByText('The service could not be reached. Check your connection and try again.');
    expect(view.queryByText(/Network Error/)).toBeNull();
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Try again'));
    });
    await view.findByText(profile.business_name);
    expect(mockGet).toHaveBeenNthCalledWith(1, '/coach/team');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/coach/team');
  });

  it('does not present a server failure as an offline connection failure', async () => {
    mockGet.mockRejectedValueOnce({
      message: 'Request failed with status code 503',
      response: { status: 503, data: 'upstream unavailable' },
    });
    const view = await mount();
    await view.findByText('The service is temporarily unavailable. Try again in a moment.');
    expect(view.queryByText(/Check your connection|status code|upstream/)).toBeNull();
  });

  it('names only the business profile and keeps the input bounded and required', async () => {
    const view = await openSetup();
    expect(view.getByLabelText('Business name').props.maxLength).toBe(120);
    expect(view.queryByText('Team')).toBeNull();
    await fireEvent.changeText(view.getByLabelText('Business name'), '   ');
    await fireEvent.press(view.getByLabelText('Save business profile'));
    expect(view.getByText('Business name is required.')).toBeTruthy();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('keeps Cancel reachable and clears the unsaved setup draft without saving', async () => {
    const view = await openSetup();
    await fireEvent.changeText(view.getByLabelText('Business name'), 'Draft name');
    await fireEvent.press(view.getByLabelText('Cancel'));
    expect(view.queryByLabelText('Business name')).toBeNull();
    await fireEvent.press(view.getByLabelText('Set up business profile'));
    expect(view.getByLabelText('Business name').props.value).toBe('');
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('rejects an over-limit submission locally and accepts exactly 120 characters', async () => {
    const view = await openSetup();
    await fireEvent.changeText(view.getByLabelText('Business name'), 'A'.repeat(121));
    await fireEvent.press(view.getByLabelText('Save business profile'));
    expect(view.getByText('Use 120 characters or fewer for the business name.')).toBeTruthy();
    expect(mockPut).not.toHaveBeenCalled();
    const name = 'A'.repeat(120);
    mockPut.mockResolvedValueOnce({ data: { ...profile, business_name: name } });
    await fireEvent.changeText(view.getByLabelText('Business name'), name);
    await fireEvent.press(view.getByLabelText('Save business profile'));
    await view.findByText(name);
    expect(mockPut).toHaveBeenCalledWith('/coach/team', { business_name: name });
    expect(view.queryByLabelText('Business name')).toBeNull();
  });

  it('keeps an unsaved name after an offline save and allows a successful retry', async () => {
    const view = await openSetup();
    mockPut.mockRejectedValueOnce(networkError);
    await fireEvent.changeText(view.getByLabelText('Business name'), '  Example Coaching  ');
    await fireEvent.press(view.getByLabelText('Save business profile'));
    await view.findByText('The service could not be reached. Check your connection and try again.');
    expect(view.getByLabelText('Business name').props.value).toBe('  Example Coaching  ');
    mockPut.mockResolvedValueOnce({ data: profile });
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Save business profile'));
    });
    await view.findByText(profile.business_name);
    expect(mockPut).toHaveBeenLastCalledWith('/coach/team', { business_name: profile.business_name });
  });

  it('opens Invite codes on the real Clients stack with the roster below it', async () => {
    mockGet.mockResolvedValueOnce({ data: profile });
    const view = await mount();
    await view.findByText(profile.business_name);
    expect(view.getByText('Business profile')).toBeTruthy();
    expect(view.getByText('12')).toBeTruthy();
    expect(view.getByTestId('team-invite-share')).toBeTruthy();
    expect(view.queryByText(profile.team_code)).toBeNull();
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Open invite codes'));
    });
    await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('InviteCodes'));
    expect(clientsRoutes()).toEqual(['ClientsList', 'InviteCodes']);
  });

  it.each<[string, string, Record<string, string> | undefined]>([
    ['Open Money', 'CoachMoney', undefined],
    ['Payouts are not enabled. Connect Stripe', 'CoachSetup', { section: 'get_paid' }],
  ])('preserves %s and its existing destination', async (label, destination, params) => {
    mockGet.mockResolvedValueOnce({ data: { ...profile, payouts_enabled: false } });
    const view = await mount();
    await view.findByText(profile.business_name);
    await act(async () => {
      await fireEvent.press(view.getByLabelText(label));
    });
    await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe(destination));
    expect(ref.getCurrentRoute()?.params).toEqual(params);
  });

  it('keeps the Settings entry functional without promising a team feature', async () => {
    const open = jest.fn();
    const view = await render(
      <BillingSection onOpenTeamProfile={open} colors={mockColors} styles={settingsStyles(mockColors)} />,
    );
    expect(view.getByText('Business profile')).toBeTruthy();
    expect(view.queryByText('Team / Gym profile')).toBeNull();
    await fireEvent.press(view.getByLabelText('Open business profile'));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
