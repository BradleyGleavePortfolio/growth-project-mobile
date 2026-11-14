/**
 * 908-W1B-M (owner 185-W1, 10-30 08:53; FR908R2-W1 B): when only the plan read fails (an offline launch:
 * EntitlementProvider status 'unavailable', no `renewal`), Settings > Notifications has loaded every row, so the line
 * under "Notification types" names the renewal offers setting instead of saying the preferences failed. Try again is
 * main's: it reads the plan again, then the settings. When the settings themselves fail, the full-screen words stay
 * (FR-B2-W1), and the category screen's notice is not this line.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }),
}));
let mockRole = 'student';
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'person-a', role: mockRole }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
jest.mock('../../../services/api', () => ({
  notificationsApi: { getPreferences: jest.fn(), updatePreferences: jest.fn() },
}));
jest.mock('../../../services/notificationsApi', () => ({
  KIND_PREFS_PREFIX: { message: 'message' },
  fetchNotificationPreferences: jest.fn(),
  saveNotificationPreferences: jest.fn(),
}));

// The plan read, with real React state as in EntitlementProvider (planRenewalGate.bothScreens.test.tsx): the launch read
// failed; each refreshEntitlement takes the next answer.
const mockAnswers: Array<'fail' | 'renewal'> = [];
const mockRefresh = jest.fn();
jest.mock('../../../entitlements/EntitlementProvider', () => {
  const ReactLocal = require('react');
  const Ctx = ReactLocal.createContext(null);
  function FakeEntitlementProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = ReactLocal.useState({ renewal: undefined, status: 'unavailable' });
    const refreshEntitlement = ReactLocal.useCallback(async () => {
      mockRefresh();
      setState((s: object) => ({ ...s, status: 'checking' }));
      await Promise.resolve();
      const answer = mockAnswers.shift() ?? 'fail';
      setState(answer === 'renewal' ? { renewal: { state: 'none' }, status: 'inactive' } : { renewal: undefined, status: 'unavailable' });
      return false;
    }, []);
    return ReactLocal.createElement(Ctx.Provider, { value: { ...state, refreshEntitlement } }, children);
  }
  return { FakeEntitlementProvider, useEntitlement: () => ReactLocal.useContext(Ctx) };
});

const { notificationsApi } = require('../../../services/api') as {
  notificationsApi: { getPreferences: jest.Mock; updatePreferences: jest.Mock };
};
const kinds = require('../../../services/notificationsApi') as {
  fetchNotificationPreferences: jest.Mock;
  saveNotificationPreferences: jest.Mock;
};
const { FakeEntitlementProvider } = require('../../../entitlements/EntitlementProvider') as {
  FakeEntitlementProvider: React.ComponentType<{ children: React.ReactNode }>;
};
const Screen = require('../NotificationPreferencesScreen').default as React.ComponentType;
const CategoryScreen = require('../../settings/NotificationPreferencesScreen').default as React.ComponentType<{
  navigation: unknown;
  role: () => string;
}>;

const NEW = 'Your plan renewal offers setting could not load. Check your connection, then try again.';
const OLD = 'Notification preferences could not be loaded. Check your connection, then try again.';
const OFFERS = 'Plan renewal offers';
const LINE = 'plan-renewal-offers-read-failed';
const YES = { data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z' } };
const PREFS = {
  muteAll: false,
  quietHours: { enabled: true, startTime: '21:00', endTime: '08:00' },
  channels: { message: { push: true, email: false, in_app: true } },
};
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true });

const open = () => render(<FakeEntitlementProvider><Screen /></FakeEntitlementProvider>);

/** The line under "Notification types": exactly NEW, OLD nowhere, no switch, one Try again, live region kept. */
function expectNewLine(screen: Awaited<ReturnType<typeof render>>) {
  const line = screen.getByTestId(LINE);
  expect(within(line).getByText(NEW)).toBeTruthy();
  expect(screen.queryByText(OLD)).toBeNull();
  expect(screen.queryByLabelText(OFFERS)).toBeNull();
  const retries = screen.getAllByRole('button', { name: 'Try again' });
  expect(retries).toHaveLength(1);
  expect(within(line).getByRole('button', { name: 'Try again' })).toBe(retries[0]);
  expect(line.props.accessibilityLiveRegion).toBe('polite');
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockAnswers.length = 0;
  mockRole = 'student';
  await AsyncStorage.clear();
  kinds.fetchNotificationPreferences.mockResolvedValue(PREFS);
  notificationsApi.getPreferences.mockResolvedValue(YES);
});

describe('Settings > Notifications, only the plan read failed (908-W1B-M)', () => {
  it('a. the settings load and the plan read fails at launch and on open: the line names the renewal offers setting', async () => {
    mockAnswers.push('fail');
    const screen = await open();
    await screen.findByTestId(LINE);
    await screen.findByLabelText('Mute all notifications');
    expectNewLine(screen);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('b. Try again with the plan read answering: the plan and the settings are read again, the line goes, the switch shows the server yes', async () => {
    mockAnswers.push('fail', 'renewal');
    const screen = await open();
    await screen.findByTestId(LINE);
    expectNewLine(screen);
    const readsBefore = kinds.fetchNotificationPreferences.mock.calls.length;
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByLabelText(OFFERS)).props.value).toBe(true);
    await waitFor(() => expect(screen.queryByTestId(LINE)).toBeNull());
    expect(screen.queryByText(NEW)).toBeNull();
    expect(screen.queryByText(OLD)).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    const readsAfter = kinds.fetchNotificationPreferences.mock.calls.length - readsBefore;
    // Reported in the PR: the answered plan read flips offersEligible, which re-runs the load effect, so 1 or 2 more.
    console.log(`908-W1B-M case b: fetchNotificationPreferences calls before ${readsBefore}, after the press ${readsAfter}`);
    expect(readsAfter).toBeGreaterThanOrEqual(1);
    expect(kinds.fetchNotificationPreferences.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(notificationsApi.updatePreferences).not.toHaveBeenCalled();
    expect(kinds.saveNotificationPreferences).not.toHaveBeenCalled();
  });

  it('c. Try again while the plan read still fails: the plan is read again and the line says the same', async () => {
    mockAnswers.push('fail', 'fail');
    const screen = await open();
    await screen.findByTestId(LINE);
    expectNewLine(screen);
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(kinds.fetchNotificationPreferences).toHaveBeenCalledTimes(2));
    await screen.findByTestId(LINE);
    expectNewLine(screen);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('negatives (908-W1B-M): what this job leaves as main has it', () => {
  it('d1. both reads fail: the full-screen failed-load state keeps its words (FR-B2-W1)', async () => {
    mockAnswers.push('fail');
    kinds.fetchNotificationPreferences.mockRejectedValue(offline());
    const screen = await open();
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText(OLD)).toBeTruthy();
    expect(screen.queryByText(NEW)).toBeNull();
    expect(screen.queryByTestId(LINE)).toBeNull();
    expect(screen.queryByLabelText('Mute all notifications')).toBeNull();
  });

  it('d2. a coach: no line, no switch, no plan read again', async () => {
    mockRole = 'coach';
    mockAnswers.push('renewal');
    const screen = await open();
    await screen.findByLabelText('Mute all notifications');
    expect(screen.queryByTestId(LINE)).toBeNull();
    expect(screen.queryByText(NEW)).toBeNull();
    expect(screen.queryByText(OLD)).toBeNull();
    expect(screen.queryByLabelText(OFFERS)).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('d3. the plan read answers on open: no line, the switch shows the server yes', async () => {
    mockAnswers.push('renewal');
    const screen = await open();
    expect((await screen.findByLabelText(OFFERS)).props.value).toBe(true);
    expect(screen.queryByTestId(LINE)).toBeNull();
    expect(screen.queryByText(NEW)).toBeNull();
    expect(screen.queryByText(OLD)).toBeNull();
  });

  it('d4. the category screen with only the plan read failing keeps its own notice word for word (not this job)', async () => {
    mockAnswers.push('fail');
    const screen = await render(
      <FakeEntitlementProvider>
        <CategoryScreen navigation={{ goBack: jest.fn() }} role={() => 'student'} />
      </FakeEntitlementProvider>,
    );
    await screen.findByLabelText('Coach Messages');
    const notice = await screen.findByTestId('notif-pref-read-error');
    expect(within(notice).getByText(OLD)).toBeTruthy();
    expect(screen.queryByText(NEW)).toBeNull();
  });
});
