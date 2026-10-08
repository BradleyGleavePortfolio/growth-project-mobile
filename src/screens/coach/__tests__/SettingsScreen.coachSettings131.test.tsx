/**
 * COACH-SETTINGS-131 (agent 131): coach Settings states that are true.
 *
 * Real installed navigators (bottom tabs + native stack) and the real coach
 * SettingsScreen with its real SettingsToggles. NotificationPreferences is
 * registered only in ClientsStack (CoachNavigator.tsx); on main the Settings
 * row called navigate('NotificationPreferences') from the Settings stack,
 * which React Navigation 7 hands to no navigator, so the row did nothing.
 *
 * Also: "Active Clients" reads "—" while loading and after a failed load
 * (main showed 0), and the AI credits row (GET /coach/ai/budget through
 * useAIBudget) shows percent left, the renewal day and a low-credit note.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationState,
  type ParamListBase,
  type PartialState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { featureFlags } from '../../../config/featureFlags';
import type { CoachAIBudgetResponse } from '../../../api/types/coachAIBudget';
import { coachApi } from '../../../services/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn(), delete: jest.fn() },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  notificationsApi: {
    getPreferences: jest.fn(async () => ({ data: {} })),
    updatePreferences: jest.fn(async () => ({ data: {} })),
  },
  deletionApi: {
    getDeletionStatus: jest.fn(async () => ({ data: { state: 'none' } })),
    cancelDeletion: jest.fn(async () => ({ data: {} })),
  },
  AccountStatus: {},
}));

jest.mock('../../../services/authActions', () => ({
  signOut: jest.fn(async () => undefined),
  refreshProfile: jest.fn(async () => undefined),
}));

jest.mock('../../../utils/haptics', () => ({
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

jest.mock('../../../utils/supabaseAuth', () => ({
  updateSupabasePassword: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../../utils/authEvents', () => ({
  authEvents: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

jest.mock('../../../config/env', () => ({
  helpUrl: () => 'https://example.com/help',
}));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      border: '#222',
      primary: '#0af',
      primaryDark: '#08c',
      textPrimary: '#fff',
      textSecondary: '#ccc',
      textMuted: '#888',
      textOnPrimary: '#000',
      error: '#f33',
      success: '#3f3',
    },
    appearanceOverride: 'system',
    setAppearanceOverride: jest.fn(),
    tokens: {},
  }),
  ThemeColors: {},
  AppearanceOverride: {},
}));

let mockRole: string | undefined = 'coach';
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'me', email: 'me@example.com', role: mockRole }),
}));

type BudgetState = {
  data?: CoachAIBudgetResponse;
  isError: boolean;
  refetch: jest.Mock;
};
let mockBudget: BudgetState;
const mockUseAIBudget = jest.fn((_opts?: { enabled?: boolean }) => mockBudget);
jest.mock('../../../hooks/useAIBudget', () => ({
  useAIBudget: (opts?: { enabled?: boolean }) => mockUseAIBudget(opts),
}));

jest.mock('../../../components/BiometricUnlockSetting', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../settings/BookingOptionsEntry', () => ({ BookingOptionsEntry: () => null }));
jest.mock('../settings/ProfileSection', () => ({ ProfileSection: () => null }));
jest.mock('../settings/BillingSection', () => ({ BillingSection: () => null }));
jest.mock('../settings/DangerZone', () => ({ DangerZone: () => null }));

import CoachSettings from '../SettingsScreen';
import { AI_CREDITS_LOAD_FAILED, AI_CREDITS_USED_BY } from '../settings/AICreditsRow';

const getClients = coachApi.getClients as jest.Mock;

function budget(pct_used: number): CoachAIBudgetResponse {
  return {
    period_start: '2026-10-01T00:00:00.000Z',
    period_end: '2026-11-01T00:00:00.000Z',
    base_displayed_cents: 12500,
    pack_displayed_cents: 0,
    total_displayed_cents: 12500,
    used_displayed_cents: Math.round(12500 * (pct_used / 100)),
    remaining_displayed_cents: Math.max(0, 12500 - Math.round(12500 * (pct_used / 100))),
    pct_used,
    base_actual_cents: 4000,
    value_multiplier: '3.125',
    actual_used_cents: 0,
    pack_options_cents: [1000, 2500, 9900],
    custom_pack_bounds_cents: { min: 1000, max: 50000 },
  };
}

const Tab = createBottomTabNavigator();
const Clients = createNativeStackNavigator();
const Settings = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();

const ClientsList = () => <Text>Clients list</Text>;
function PrefsStub({ navigation }: { navigation: { goBack: () => void } }) {
  return (
    <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button">
      <Text>Notification preferences screen</Text>
    </TouchableOpacity>
  );
}

function ClientsStack() {
  return (
    <Clients.Navigator screenOptions={{ headerShown: false }}>
      <Clients.Screen name="ClientsList" component={ClientsList} />
      <Clients.Screen name="NotificationPreferences" component={PrefsStub} />
    </Clients.Navigator>
  );
}
function SettingsStack() {
  return (
    <Settings.Navigator screenOptions={{ headerShown: false }}>
      <Settings.Screen name="SettingsHome" component={CoachSettings} />
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
function clientsRoutes(): string[] {
  const root = ref.getRootState() as AnyState;
  const tab = root?.routes.find((x) => x.name === 'ClientsStack');
  const st = tab?.state as AnyState;
  return (st?.routes ?? []).map((x) => x.name);
}

beforeEach(() => {
  mockRole = 'coach';
  mockBudget = { data: undefined, isError: false, refetch: jest.fn(async () => undefined) };
  mockUseAIBudget.mockReset();
  mockUseAIBudget.mockImplementation(() => mockBudget);
  getClients.mockReset();
  getClients.mockImplementation(async () => ({ data: [] }));
  jest.replaceProperty(featureFlags, 'romanChat', false);
});

afterEach(() => jest.restoreAllMocks());

describe('Notification preferences row', () => {
  it('opens the coach NotificationPreferences screen, with the Clients list below it', async () => {
    const r = await mount();
    await act(async () => {
      fireEvent.press(r.getByLabelText('Notification preferences'));
    });
    await waitFor(() => expect(r.getByText('Notification preferences screen')).toBeTruthy());
    expect(ref.getCurrentRoute()?.name).toBe('NotificationPreferences');
    expect(clientsRoutes()).toEqual(['ClientsList', 'NotificationPreferences']);
  });
});

describe('Active Clients', () => {
  it('reads "—" while the roster loads, never 0', async () => {
    getClients.mockImplementation(() => new Promise(() => undefined));
    const r = await mount();
    expect(r.queryByText('0')).toBeNull();
    expect(r.getByTestId('settings-active-clients-value').props.children).toBe('—');
    expect(r.getByLabelText('Active clients, not loaded')).toBeTruthy();
  });

  it('reads "—" after a failed load, never 0', async () => {
    getClients.mockImplementation(async () => {
      throw new Error('Network Error');
    });
    const r = await mount();
    await waitFor(() => expect(getClients).toHaveBeenCalled());
    await act(async () => undefined);
    expect(r.queryByText('0')).toBeNull();
    expect(r.getByTestId('settings-active-clients-value').props.children).toBe('—');
  });

  it('shows the active count from one 50-row page', async () => {
    getClients.mockImplementation(async () => ({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
    const r = await mount();
    await waitFor(() =>
      expect(r.getByTestId('settings-active-clients-value').props.children).toBe('3'),
    );
    expect(getClients).toHaveBeenCalledWith('active', undefined, 50);
    expect(r.getByLabelText('Active clients, 3')).toBeTruthy();
  });

  it('says 50+ when the page is full instead of a capped number', async () => {
    getClients.mockImplementation(async () => ({
      data: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` })),
    }));
    const r = await mount();
    await waitFor(() =>
      expect(r.getByTestId('settings-active-clients-value').props.children).toBe('50+'),
    );
  });
});

describe('AI credits row', () => {
  it('shows "—" and what uses the credits while the balance loads', async () => {
    const r = await mount();
    expect(r.getByTestId('settings-ai-credits-value').props.children).toBe('—');
    expect(r.getByText(AI_CREDITS_USED_BY)).toBeTruthy();
    expect(r.queryByTestId('settings-ai-credits-note')).toBeNull();
    expect(mockUseAIBudget).toHaveBeenCalledWith({ enabled: true });
  });

  it('shows percent left and the renewal day, text only', async () => {
    mockBudget = { ...mockBudget, data: budget(37.4) };
    const r = await mount();
    expect(r.getByTestId('settings-ai-credits-value').props.children).toBe('62% left');
    expect(r.getByText(`${AI_CREDITS_USED_BY} Renews Nov 1.`)).toBeTruthy();
    expect(r.queryByTestId('settings-ai-credits-note')).toBeNull();
    const row = r.getByTestId('settings-ai-credits');
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.onPress).toBeUndefined();
  });

  it('adds a low-credit note from 80 percent used', async () => {
    mockBudget = { ...mockBudget, data: budget(85) };
    const r = await mount();
    expect(r.getByTestId('settings-ai-credits-value').props.children).toBe('15% left');
    expect(r.getByTestId('settings-ai-credits-note').props.children).toBe(
      'Running low. AI features pause when credits run out.',
    );
  });

  it('says none are left and AI features are paused until the renewal day', async () => {
    mockBudget = { ...mockBudget, data: budget(100.2) };
    const r = await mount();
    expect(r.getByTestId('settings-ai-credits-value').props.children).toBe('None left');
    expect(r.getByTestId('settings-ai-credits-note').props.children).toBe(
      'AI features are paused until Nov 1.',
    );
  });

  it('says the balance did not load and tries again on tap', async () => {
    mockBudget = { ...mockBudget, isError: true };
    const r = await mount();
    expect(r.getByText(AI_CREDITS_LOAD_FAILED)).toBeTruthy();
    expect(r.getByTestId('settings-ai-credits-value').props.children).toBe('—');
    await act(async () => {
      fireEvent.press(r.getByTestId('settings-ai-credits'));
    });
    expect(mockBudget.refetch).toHaveBeenCalledTimes(1);
  });

  it('is hidden for a sub_coach (the budget route answers 403)', async () => {
    mockRole = 'sub_coach';
    const r = await mount();
    expect(r.queryByTestId('settings-ai-credits')).toBeNull();
    expect(mockUseAIBudget).not.toHaveBeenCalled();
  });
});
