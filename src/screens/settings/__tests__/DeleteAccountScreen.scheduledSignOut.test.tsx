/**
 * JOINOFFER-DEL (LO-898R4 C-1): a coach schedules the deletion, taps "Sign out" on the scheduled
 * view and never signs in on this phone again; the server completes the deletion later and the
 * phone never hears of it. Signing out while the deletion is scheduled therefore removes that
 * account's kept marks (first-payment shown, Roman join offer). Another account's marks stay, the
 * rest of the sign-out sweep still runs, and with nothing scheduled (none, or cancelled) an
 * ordinary sign-out keeps every mark.
 *
 * Real DeleteAccountScreen, real api.ts deletionApi, real authActions.signOut, firstPaymentGate
 * and AsyncStorage. Only the network (axios), secure storage and native services are mocked.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('axios', () => {
  const instance = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __instance: instance };
});
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../../../services/realtime', () => ({ refreshRealtimeAuth: jest.fn() }));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-leaving', role: 'coach', name: 'Coach' }),
}));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'coach-leaving' }),
  readUserCache: async () => ({ id: 'coach-leaving' }),
  clearUserCache: async () => undefined,
}));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../../offline/sync/sync-engine', () => ({
  countQueuedWorkouts: jest.fn(async () => 0),
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));
jest.mock('../../../utils/googleReauth', () => ({ reauthenticateWithGoogle: jest.fn() }));
jest.mock('../../../utils/authProviders', () => ({ getSignInProviders: jest.fn(async () => ['email']) }));
jest.mock('../../../utils/appleAuth', () => ({
  isAppleAuthAvailable: jest.fn(async () => false),
  reauthenticateWithApple: jest.fn(),
}));
jest.mock('../../../utils/haptics', () => ({ warningTap: jest.fn(), successTap: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  const colors = jest.requireActual('../../../constants/colors').default;
  return {
    useTheme: () => ({ colors, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light' }),
  };
});

import DeleteAccountScreen from '../DeleteAccountScreen';
import { deletionApi } from '../../../services/api';
import { signOut } from '../../../services/authActions';
import { holdSessionFence, sessionGeneration } from '../../../services/sessionFence';
import { authEvents } from '../../../utils/authEvents';
import { markFirstPaymentSeen } from '../../coach/ed/firstPaymentGate';

const axiosMock = jest.requireMock('axios') as { __instance: { get: jest.Mock; post: jest.Mock } };
const SCHEDULED = {
  state: 'confirmed',
  confirmed_at: '2026-10-29T10:00:00.000Z',
  grace_days: 30,
  purge_after: '2026-11-28T10:00:00.000Z',
  cancellable: true,
};
const seen = (id: string) => `roman.ed3.first-payment-seen.${id}`;
const offer = (id: string) => `roman_join_offer:${id}`;
const navigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
} as unknown as React.ComponentProps<typeof DeleteAccountScreen>['navigation'];

async function seedMarks(): Promise<void> {
  await markFirstPaymentSeen('coach-leaving');
  await markFirstPaymentSeen('coach-other');
  await AsyncStorage.setItem(offer('coach-leaving'), 'done');
  await AsyncStorage.setItem(offer('coach-other'), 'due');
  await AsyncStorage.setItem('pending_invite_code', 'private');
}

function serveStatus(status: Record<string, unknown>): void {
  axiosMock.__instance.get.mockImplementation(async (url: string) =>
    url === '/me/delete-account/status' ? { data: status } : { data: {} },
  );
}

async function expectOthersKeptAndSweepRan(): Promise<void> {
  expect(await AsyncStorage.getItem(seen('coach-other'))).toBe('true');
  expect(await AsyncStorage.getItem(offer('coach-other'))).toBe('due');
  expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  axiosMock.__instance.get.mockReset();
  axiosMock.__instance.post.mockReset();
  axiosMock.__instance.post.mockResolvedValue({ data: { message: 'ok' } });
});

it('C-1: "Sign out" on the scheduled view removes only this account\'s kept marks', async () => {
  await seedMarks();
  serveStatus(SCHEDULED);
  const loggedOut = jest.fn();
  authEvents.on('logout', loggedOut);
  try {
    const screen = await render(<DeleteAccountScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByTestId('deletion-scheduled-banner')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('sign-out-button'));
    await waitFor(() => expect(loggedOut).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem(seen('coach-leaving'))).toBeNull();
    expect(await AsyncStorage.getItem(offer('coach-leaving'))).toBeNull();
    await expectOthersKeptAndSweepRan();
    await screen.unmount();
  } finally {
    authEvents.off('logout', loggedOut);
  }
});

it('a deletion scheduled from the request (no status read yet) counts the same', async () => {
  await seedMarks();
  axiosMock.__instance.post.mockResolvedValue({ data: { ...SCHEDULED, already_scheduled: false, message: 'ok' } });
  await deletionApi.requestDeletion('recent-auth');
  await signOut();
  expect(await AsyncStorage.getItem(seen('coach-leaving'))).toBeNull();
  expect(await AsyncStorage.getItem(offer('coach-leaving'))).toBeNull();
  await expectOthersKeptAndSweepRan();
});

it('control: with no deletion scheduled, "Sign out" keeps every mark', async () => {
  await seedMarks();
  serveStatus({ state: 'none' });
  await deletionApi.getDeletionStatus();
  await signOut();
  expect(await AsyncStorage.getItem(seen('coach-leaving'))).toBe('true');
  expect(await AsyncStorage.getItem(offer('coach-leaving'))).toBe('done');
  await expectOthersKeptAndSweepRan();
});

it('control: a cancelled deletion (Keep my account) is an ordinary sign-out again', async () => {
  await seedMarks();
  serveStatus(SCHEDULED);
  await deletionApi.getDeletionStatus();
  await deletionApi.cancelDeletion();
  await signOut();
  expect(await AsyncStorage.getItem(seen('coach-leaving'))).toBe('true');
  expect(await AsyncStorage.getItem(offer('coach-leaving'))).toBe('done');
});

it('control: a schedule seen in an earlier session does not apply after a new sign-in', async () => {
  await seedMarks();
  serveStatus(SCHEDULED);
  await deletionApi.getDeletionStatus();
  // A sign-in writes its tokens under the fence and moves the generation.
  holdSessionFence(sessionGeneration())!.release(true);
  await signOut();
  expect(await AsyncStorage.getItem(seen('coach-leaving'))).toBe('true');
  expect(await AsyncStorage.getItem(offer('coach-leaving'))).toBe('done');
});
