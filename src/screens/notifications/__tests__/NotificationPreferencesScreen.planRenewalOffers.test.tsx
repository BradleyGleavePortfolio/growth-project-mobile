/**
 * FR-B2 B1 (STORE-B2, App Store 4.5.4): every client route to notification settings reaches the plan renewal offers
 * switch, which starts at the server's answer, is never on before the server says so, survives a failed first read
 * with Try again, stays hidden on an older server or for a coach, and leaves Mute all as it was.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }),
}));
let mockRole: string | null = 'student';
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => (mockRole === null ? null : { id: 'person-a', role: mockRole }),
}));
let mockRenewal: unknown = { state: 'none' };
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ renewal: mockRenewal }),
}));
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
jest.mock('../../../services/api', () => ({
  notificationsApi: { getPreferences: jest.fn(), updatePreferences: jest.fn() },
}));
jest.mock('../../../services/notificationsApi', () => ({
  KIND_PREFS_PREFIX: { message: 'message' },
  fetchNotificationPreferences: jest.fn(),
  saveNotificationPreferences: jest.fn(),
}));

const { notificationsApi } = require('../../../services/api') as {
  notificationsApi: { getPreferences: jest.Mock; updatePreferences: jest.Mock };
};
const kinds = require('../../../services/notificationsApi') as {
  fetchNotificationPreferences: jest.Mock;
  saveNotificationPreferences: jest.Mock;
};
const Screen = require('../NotificationPreferencesScreen').default as React.ComponentType;

const OFFERS = 'Plan renewal offers';
const PREFS = {
  muteAll: false,
  quietHours: { enabled: true, startTime: '21:00', endTime: '08:00' },
  channels: { message: { push: true, email: false, in_app: true } },
};
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'student';
  mockRenewal = { state: 'none' };
  kinds.fetchNotificationPreferences.mockResolvedValue(PREFS);
  notificationsApi.getPreferences.mockResolvedValue({ data: { plan_renewal_offers_opt_in_at: null } });
});

// ─── Each real client route reaches this screen ───────────────────────────────

const NAV = path.resolve(__dirname, '../../../navigation/ClientNavigator.tsx');
const navSource = fs.readFileSync(NAV, 'utf8');
const SCREENS = path.resolve(__dirname, '../../..');

/** The component a stack registers for a route name, resolved to its file. */
function routeFile(stack: 'HomeStackNav' | 'MoreStackNav', name: string): string {
  const re = new RegExp(`<${stack}\\.Screen\\s+name="${name}"\\s+component=\\{(?:[^}?]*\\?\\s*)?(\\w+)`);
  const route = re.exec(navSource);
  if (!route) throw new Error(`${stack} ${name} is not registered`);
  const imported = [...navSource.matchAll(/import (\w+) from '([^']+)'/g)].find((m) => m[1] === route[1]);
  if (!imported) throw new Error(`${route[1]} is not imported`);
  return path.resolve(path.dirname(NAV), imported[2]);
}

const ROUTES: Array<{ caller: string; stack: 'HomeStackNav' | 'MoreStackNav'; callerRoute: string; route: string }> = [
  { caller: 'screens/client/YouScreen.tsx', stack: 'MoreStackNav', callerRoute: 'MoreIndex', route: 'NotificationSettings' },
  { caller: 'screens/client/SettingsScreen.tsx', stack: 'MoreStackNav', callerRoute: 'Settings', route: 'NotificationSettings' },
  { caller: 'screens/client/PreferencesScreen.tsx', stack: 'MoreStackNav', callerRoute: 'Preferences', route: 'NotificationSettings' },
  { caller: 'screens/notifications/NotificationCenterScreen.tsx', stack: 'HomeStackNav', callerRoute: 'NotificationCenter', route: 'NotificationPreferences' },
];

describe.each(ROUTES)('$caller > $route', ({ caller, stack, callerRoute, route }) => {
  it('opens this screen, which shows the plan renewal offers switch', async () => {
    const callerFile = path.join(SCREENS, caller);
    expect(routeFile(stack, callerRoute)).toBe(callerFile.replace(/\.tsx$/, ''));
    expect(fs.readFileSync(callerFile, 'utf8')).toContain(`navigation.navigate('${route}')`);
    const target = routeFile(stack, route);
    expect(target).toBe(path.join(SCREENS, 'screens/notifications/NotificationPreferencesScreen'));
    const Routed = require(target).default as React.ComponentType;
    const screen = await render(<Routed />);
    expect((await screen.findByLabelText(OFFERS)).props.value).toBe(false);
  });
});

// ─── Server truth ─────────────────────────────────────────────────────────────

it('shows the server yes, with the approved words', async () => {
  notificationsApi.getPreferences.mockResolvedValue({ data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z' } });
  const screen = await render(<Screen />);
  expect((await screen.findByLabelText(OFFERS)).props.value).toBe(true);
  expect(screen.getByText('A note the day after your plan ends and a week later, with plans you can choose.')).toBeTruthy();
});

it('a failed first read never shows the switch on; Try again shows the server yes', async () => {
  notificationsApi.getPreferences
    .mockRejectedValueOnce(offline())
    .mockResolvedValueOnce({ data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z' } });
  const screen = await render(<Screen />);
  const retry = await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByLabelText(OFFERS)).toBeNull();
  expect(screen.getByText('Notification preferences could not be loaded. Check your connection, then try again.')).toBeTruthy();
  fireEvent.press(retry);
  expect((await screen.findByLabelText(OFFERS)).props.value).toBe(true);
  expect(kinds.fetchNotificationPreferences).toHaveBeenCalledTimes(2);
});

it('a failed read of the other settings also keeps the switch away until Try again', async () => {
  kinds.fetchNotificationPreferences.mockRejectedValueOnce(offline());
  const screen = await render(<Screen />);
  fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
  expect((await screen.findByLabelText(OFFERS)).props.value).toBe(false);
});

it('an older server (no field) keeps the switch hidden', async () => {
  notificationsApi.getPreferences.mockResolvedValue({ data: { plan_renewal_push: true } });
  const screen = await render(<Screen />);
  await screen.findByLabelText('Mute all notifications');
  expect(screen.queryByLabelText(OFFERS)).toBeNull();
});

it('a coach never sees the switch and the extra read is not made', async () => {
  mockRole = 'coach';
  const screen = await render(<Screen />);
  await screen.findByLabelText('Mute all notifications');
  expect(screen.queryByLabelText(OFFERS)).toBeNull();
  expect(notificationsApi.getPreferences).not.toHaveBeenCalled();
});

it('with renewal off on the server (no renewal block) the switch is hidden', async () => {
  mockRenewal = undefined;
  const screen = await render(<Screen />);
  await screen.findByLabelText('Mute all notifications');
  expect(screen.queryByLabelText(OFFERS)).toBeNull();
  expect(notificationsApi.getPreferences).not.toHaveBeenCalled();
});

// ─── Saving ───────────────────────────────────────────────────────────────────

it('turning it on writes only plan_renewal_offers and shows what the server saved', async () => {
  notificationsApi.updatePreferences.mockResolvedValue({ data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z' } });
  const screen = await render(<Screen />);
  await fireEvent(await screen.findByLabelText(OFFERS), 'valueChange', true);
  expect(notificationsApi.updatePreferences).toHaveBeenCalledTimes(1);
  expect(notificationsApi.updatePreferences).toHaveBeenCalledWith({ plan_renewal_offers: true });
  expect(kinds.saveNotificationPreferences).not.toHaveBeenCalled();
  expect((await screen.findByLabelText(OFFERS)).props.value).toBe(true);
});

it('a save with no answer puts the switch back, says so, and reads the server again', async () => {
  notificationsApi.updatePreferences.mockRejectedValue(offline());
  const screen = await render(<Screen />);
  await fireEvent(await screen.findByLabelText(OFFERS), 'valueChange', true);
  await waitFor(() => expect(screen.getByLabelText(OFFERS).props.value).toBe(false));
  expect(screen.getByTestId('plan-renewal-offers-save-failed').props.children).toBe(
    'Your plan renewal offers setting was not saved because the app could not reach the server, so it was left as it was. Check your connection, then try again.',
  );
  expect(notificationsApi.getPreferences).toHaveBeenCalledTimes(2);
});

it('a second change while a save is in flight is not sent', async () => {
  let finish: (v: unknown) => void = () => undefined;
  notificationsApi.updatePreferences.mockReturnValueOnce(new Promise((r) => { finish = r; }));
  const screen = await render(<Screen />);
  // v14: never await a fireEvent held open by a deferred save; two microtask turns let its act() settle.
  const settled: Promise<unknown> = fireEvent(await screen.findByLabelText(OFFERS), 'valueChange', true);
  await Promise.resolve();
  await Promise.resolve();
  await waitFor(() => expect(notificationsApi.updatePreferences).toHaveBeenCalledTimes(1));
  const busy = await screen.findByLabelText(OFFERS);
  expect(busy.props.value).toBe(true);
  expect(busy.props.disabled).toBe(true);
  await act(async () => {
    finish({ data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z' } });
    await settled;
  });
  await waitFor(() => expect(screen.getByLabelText(OFFERS).props.disabled).toBe(false));
  expect(notificationsApi.updatePreferences).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(OFFERS).props.value).toBe(true);
});

it('Mute all is unchanged: it writes only muteAll and leaves the offers switch as the server has it', async () => {
  notificationsApi.getPreferences.mockResolvedValue({ data: { plan_renewal_offers_opt_in_at: '2026-10-29T00:00:00Z' } });
  kinds.saveNotificationPreferences.mockResolvedValue({ ...PREFS, muteAll: true });
  const screen = await render(<Screen />);
  await screen.findByLabelText(OFFERS);
  await fireEvent(screen.getByLabelText('Mute all notifications'), 'valueChange', true);
  await waitFor(() => expect(screen.getByLabelText('Mute all notifications').props.value).toBe(true));
  await waitFor(() => expect(screen.getByLabelText(OFFERS).props.disabled).toBe(false));
  expect(kinds.saveNotificationPreferences).toHaveBeenCalledTimes(1);
  expect(kinds.saveNotificationPreferences).toHaveBeenCalledWith({ muteAll: true });
  expect(notificationsApi.updatePreferences).not.toHaveBeenCalled();
  const offers = screen.getByLabelText(OFFERS);
  expect(offers.props.value).toBe(true);
  expect(offers.props.disabled).toBeFalsy();
});
