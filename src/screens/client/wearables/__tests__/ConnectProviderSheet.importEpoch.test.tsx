/**
 * B-MOB-B round 5 (agent 115) — builder finding B-317-11 at cfa99ce3.
 *
 * ConnectionsScreen keeps ONE ConnectProviderSheet mounted and only changes
 * `visible` / `provider`, so an on-device import that settles after the
 * sheet was closed must not act on the NEXT sheet. The REAL sheet drives the
 * REAL onDeviceSync orchestrator, session fence and local-authorization
 * storage; only the edges are doubles (Health Connect native module,
 * registration call, identity cache, the phone-store import held by the
 * test, and the Sentry reporter, spied).
 *
 * Every stale case asserts: no tutorial success, no onConnected, no close,
 * no message, no Sentry report, and the next sheet's Continue is not busy.
 * Controls: an unchanged attempt still connects, reports and messages.
 */

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { healthConnectEnabled: true } } },
}));

const mockInvalidate = jest.fn();
const mockStartOauth = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useStartOauth: () => ({ mutateAsync: mockStartOauth, isPending: false }),
  useInvalidateWearableConnections: () => mockInvalidate,
}));

// The in-app auth session: resolved by the test (B-317-10).
let mockResolveBrowser: (r: { type: string }) => void = () => undefined;
const mockOpenAuthSession = jest.fn(
  () =>
    new Promise<{ type: string }>((resolve) => {
      mockResolveBrowser = resolve;
    }),
);
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: () => mockOpenAuthSession(),
}));

// The Health Connect native module. `hold` makes getSdkStatus or initialize
// wait until the test releases it (B-317-9).
let mockHold: 'status' | 'init' | null = null;
const mockReleases: Array<() => void> = [];
const held = async () => {
  await new Promise<void>((r) => mockReleases.push(r));
};
const mockGetSdkStatus = jest.fn(async () => {
  if (mockHold === 'status') await held();
  return 3;
});
const mockInitialize = jest.fn(async () => {
  if (mockHold === 'init') await held();
  return true;
});
const mockRequestPermission = jest.fn(async (perms: unknown[]) => perms);
jest.mock('react-native-health-connect', () => ({
  __esModule: true,
  SdkAvailabilityStatus: {
    SDK_UNAVAILABLE: 1,
    SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
    SDK_AVAILABLE: 3,
  },
  getSdkStatus: () => mockGetSdkStatus(),
  initialize: () => mockInitialize(),
  openHealthConnectSettings: jest.fn(),
  requestPermission: (perms: unknown[]) => mockRequestPermission(perms),
}));

jest.mock('../../../../services/authActions', () => ({ signOut: jest.fn() }));

let mockCurrentUser: string | null = 'user-a';
jest.mock('../../../../lib/userCache', () => ({
  readUserCache: jest.fn(async () => (mockCurrentUser ? { id: mockCurrentUser } : null)),
}));

const mockRegister = jest.fn();
jest.mock('../../../../api/wearablesConnectionsApi', () => {
  const actual = jest.requireActual('../../../../api/wearablesConnectionsApi');
  return {
    ...actual,
    wearablesConnectionsApi: {
      ...actual.wearablesConnectionsApi,
      registerOnDevice: (...args: unknown[]) => mockRegister(...args),
    },
  };
});

const mockHealthConnectSync = jest.fn();
jest.mock('../../../../services/health/healthConnect', () => ({
  syncHealthConnect: (...args: unknown[]) => mockHealthConnectSync(...args),
}));
jest.mock('../../../../services/health/healthkit', () => ({
  healthKitSyncService: { sync: jest.fn() },
}));


const mockReport = jest.fn();
jest.mock('../../../../lib/consultation/report', () => ({
  reportUnexpected: (...args: unknown[]) => mockReport(...args),
}));

import ConnectProviderSheet from '../ConnectProviderSheet';
import { stopOnDeviceHealthWork } from '../../../../services/health/sessionFence';
import * as onDeviceConnectModule from '../../../../services/health/onDeviceConnect';
import { subscribeTutorialSignals } from '../../../../tutorial/tutorialEvents';
import type { TutorialSignal } from '../../../../tutorial/types';

const originalOS = Platform.OS;
const tutorialSignals: TutorialSignal[] = [];
let unsubscribeTutorial: () => void = () => undefined;

function registered(userId: string) {
  return {
    id: `conn-${userId}`,
    user_id: userId,
    provider: 'HEALTH_CONNECT',
    external_account_id: 'on-device',
    access_token_expires_at: null,
    scopes: [],
    webhook_subscription_id: null,
    channel_expires_at: null,
    status: 'connected',
    last_error: null,
    last_synced_at: null,
    backfilled_until: null,
    disconnected_at: null,
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
  };
}

beforeEach(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await AsyncStorage.clear();
  mockCurrentUser = 'user-a';
  mockHold = null;
  mockReleases.length = 0;
  mockRequestPermission.mockClear();
  mockRegister.mockReset();
  mockRegister.mockImplementation(async () => registered(mockCurrentUser ?? 'nobody'));
  mockHealthConnectSync.mockReset();
  mockHealthConnectSync.mockResolvedValue({ normalizedCount: 4, complete: true });
  mockInvalidate.mockReset();
  mockStartOauth.mockReset();
  mockStartOauth.mockResolvedValue({ authorizationUrl: 'https://provider.example/oauth', state: 's-1' });
  mockOpenAuthSession.mockClear();
  mockReport.mockReset();
  tutorialSignals.length = 0;
  unsubscribeTutorial = subscribeTutorialSignals((s) => tutorialSignals.push(s));
});

afterEach(() => {
  unsubscribeTutorial();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
});

type Held = { resolve: (v: { normalizedCount: number; complete: boolean }) => void; reject: (e: unknown) => void };

/** The next phone-store import waits until the test settles it. */
function holdNextImport(): Held {
  const held: Held = { resolve: () => undefined, reject: () => undefined };
  mockHealthConnectSync.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        held.resolve = resolve;
        held.reject = reject;
      }),
  );
  return held;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function ctaDisabled(label: string): boolean {
  return screen.getByLabelText(label).props.accessibilityState?.disabled === true;
}

const LATE_FAILURE_COPY = /history didn't finish coming in/;

type How = 'close and reopen for Oura' | 'provider change to Oura';

async function startHeldConnect(onClose: jest.Mock, onConnected: jest.Mock) {
  const held = holdNextImport();
  const view = await render(
    <ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={onClose} onConnected={onConnected} />,
  );
  const pressed = Promise.resolve(fireEvent.press(screen.getByLabelText('Continue connecting Health Connect')));
  await waitFor(() => expect(mockHealthConnectSync).toHaveBeenCalledTimes(1));
  return { held, view, pressed };
}

async function moveToOura(view: Awaited<ReturnType<typeof render>>, how: How, onClose: jest.Mock, onConnected: jest.Mock) {
  if (how === 'close and reopen for Oura') {
    await view.rerender(
      <ConnectProviderSheet provider="HEALTH_CONNECT" visible={false} onClose={onClose} onConnected={onConnected} />,
    );
  }
  await view.rerender(<ConnectProviderSheet provider="OURA" visible onClose={onClose} onConnected={onConnected} />);
}

function expectNothingVisible(onClose: jest.Mock, onConnected: jest.Mock) {
  expect(tutorialSignals).toEqual([]);
  expect(onConnected).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByText(LATE_FAILURE_COPY)).toBeNull();
  expect(screen.queryByText(/signed-in account changed/)).toBeNull();
  expect(mockReport).not.toHaveBeenCalled();
}

describe('B-317-11: a stale on-device import does nothing to the next sheet', () => {
  const HOW: How[] = ['close and reopen for Oura', 'provider change to Oura'];

  it.each(HOW)('%s, then the import SUCCEEDS: no success, onConnected or close on the Oura sheet', async (how) => {
    const onClose = jest.fn();
    const onConnected = jest.fn();
    const { held, view, pressed } = await startHeldConnect(onClose, onConnected);
    await moveToOura(view, how, onClose, onConnected);
    held.resolve({ normalizedCount: 4, complete: true });
    await pressed;
    await flush();
    expectNothingVisible(onClose, onConnected);
    expect(screen.getByLabelText('Connect Oura')).toBeTruthy();
    // Same session: the authoritative list is re-read (data may have arrived).
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it.each(HOW)('%s, then the import FAILS: no Health Connect error and no Sentry report on the Oura sheet', async (how) => {
    const onClose = jest.fn();
    const onConnected = jest.fn();
    const { held, view, pressed } = await startHeldConnect(onClose, onConnected);
    await moveToOura(view, how, onClose, onConnected);
    held.reject(new Error('phone store read failed'));
    await pressed;
    await flush();
    expectNothingVisible(onClose, onConnected);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it.each(HOW)('%s while the import is still running: the Oura Continue is ready, not busy', async (how) => {
    const onClose = jest.fn();
    const onConnected = jest.fn();
    const { held, view, pressed } = await startHeldConnect(onClose, onConnected);
    expect(ctaDisabled('Continue connecting Health Connect')).toBe(true);
    await moveToOura(view, how, onClose, onConnected);
    expect(ctaDisabled('Continue connecting Oura')).toBe(false);
    expect(screen.queryByText(/Bringing in your last 30 days/)).toBeNull();
    // And it works: Continue starts the Oura authorization right away.
    fireEvent.press(screen.getByLabelText('Continue connecting Oura'));
    await waitFor(() => expect(mockStartOauth).toHaveBeenCalledWith('OURA'));
    held.resolve({ normalizedCount: 4, complete: true });
    await pressed;
    await flush();
    expect(tutorialSignals).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['succeeds', 'fails'] as const)('unmount, then the import %s: nothing happens and nothing is reported', async (result) => {
    const onClose = jest.fn();
    const onConnected = jest.fn();
    const { held, view, pressed } = await startHeldConnect(onClose, onConnected);
    await view.unmount();
    if (result === 'succeeds') held.resolve({ normalizedCount: 4, complete: true });
    else held.reject(new Error('phone store read failed'));
    await pressed;
    await flush();
    expect(tutorialSignals).toEqual([]);
    expect(onConnected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it.each(['succeeds', 'fails'] as const)(
    'sign-out while the sheet is still open, then the import %s: no success, no re-read, no Sentry report',
    async (result) => {
      const onClose = jest.fn();
      const onConnected = jest.fn();
      const { held, pressed } = await startHeldConnect(onClose, onConnected);
      // signOut() calls this first, synchronously, before its first await.
      stopOnDeviceHealthWork();
      if (result === 'succeeds') held.resolve({ normalizedCount: 4, complete: true });
      else held.reject(new Error('phone store read failed'));
      await pressed;
      await flush();
      expect(tutorialSignals).toEqual([]);
      expect(onConnected).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(mockInvalidate).not.toHaveBeenCalled();
      expect(mockReport).not.toHaveBeenCalled();
      expect(screen.queryByText(LATE_FAILURE_COPY)).toBeNull();
      if (result === 'fails') {
        // Still this sheet: the stop is explained, with the way back.
        expect(screen.getByText(/signed-in account changed while Health Connect was connecting/)).toBeTruthy();
      }
    },
  );

  it.each(HOW)('a held RESUME import, then %s: the old resume does nothing to the Oura sheet', async (how) => {
    const onClose = jest.fn();
    const onConnected = jest.fn();
    // First run: every pass stops at the page bound, so the import is partial.
    mockHealthConnectSync.mockResolvedValue({ normalizedCount: 2, complete: false });
    const view = await render(
      <ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={onClose} onConnected={onConnected} />,
    );
    fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));
    await waitFor(() => expect(screen.getByLabelText('Continue import for Health Connect')).toBeTruthy());
    tutorialSignals.length = 0;
    onConnected.mockClear();
    mockInvalidate.mockReset();
    const held = holdNextImport();
    const calls = mockHealthConnectSync.mock.calls.length;
    const resumed = Promise.resolve(fireEvent.press(screen.getByLabelText('Continue import for Health Connect')));
    await waitFor(() => expect(mockHealthConnectSync.mock.calls.length).toBe(calls + 1));
    await moveToOura(view, how, onClose, onConnected);
    expect(ctaDisabled('Continue connecting Oura')).toBe(false);
    held.reject(new Error('phone store read failed'));
    await resumed;
    await flush();
    expectNothingVisible(onClose, onConnected);
    expect(screen.queryByLabelText('Continue import for Health Connect')).toBeNull();
  });

  describe('controls: an unchanged attempt still acts', () => {
    it('late success on the same sheet: success signal, onConnected and close', async () => {
      const onClose = jest.fn();
      const onConnected = jest.fn();
      const { held, pressed } = await startHeldConnect(onClose, onConnected);
      held.resolve({ normalizedCount: 4, complete: true });
      await pressed;
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(tutorialSignals).toEqual(['wearable_connected']);
      expect(mockInvalidate).toHaveBeenCalledTimes(1);
    });

    it('late failure on the same sheet: the specific message with a reference, and one Sentry report', async () => {
      const onClose = jest.fn();
      const onConnected = jest.fn();
      const { held, pressed } = await startHeldConnect(onClose, onConnected);
      held.reject(new Error('phone store read failed'));
      await pressed;
      await waitFor(() => expect(screen.getByText(LATE_FAILURE_COPY)).toBeTruthy());
      expect(screen.getByText(/Reference /)).toBeTruthy();
      expect(mockReport).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(ctaDisabled('Try again for Health Connect')).toBe(false);
    });
  });
});

describe('C-317-c: the Open Health Connect result is shown only on the sheet that asked', () => {
  it.each([true, false])('settings open resolves %s after a close and reopen for Oura: no message on the Oura sheet', async (opens) => {
    // A refused grant leads to the Open Health Connect action.
    mockRequestPermission.mockResolvedValueOnce([]);
    let resolveOpen: (v: boolean) => void = () => undefined;
    const openSpy = jest
      .spyOn(onDeviceConnectModule, 'openHealthConnectPermissions')
      .mockImplementationOnce(() => new Promise<boolean>((r) => (resolveOpen = r)));
    const onClose = jest.fn();
    const view = await render(<ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={onClose} />);
    fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));
    await waitFor(() => expect(screen.getByText(/access wasn't allowed/)).toBeTruthy());
    const opened = Promise.resolve(fireEvent.press(screen.getByLabelText('Open Health Connect')));
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    await view.rerender(<ConnectProviderSheet provider="HEALTH_CONNECT" visible={false} onClose={onClose} />);
    await view.rerender(<ConnectProviderSheet provider="OURA" visible onClose={onClose} />);
    resolveOpen(opens);
    await opened;
    await flush();
    expect(screen.queryByText(/didn't open/)).toBeNull();
    expect(screen.queryByText(/access is set up/)).toBeNull();
    expect(screen.getByLabelText('Continue connecting Oura')).toBeTruthy();
    openSpy.mockRestore();
  });

  it('control: on the same sheet the result is shown', async () => {
    mockRequestPermission.mockResolvedValueOnce([]);
    const openSpy = jest.spyOn(onDeviceConnectModule, 'openHealthConnectPermissions').mockResolvedValueOnce(false);
    await render(<ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));
    await waitFor(() => expect(screen.getByText(/access wasn't allowed/)).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Open Health Connect'));
    await waitFor(() => expect(screen.getByText(/Health Connect didn't open/)).toBeTruthy());
    openSpy.mockRestore();
  });
});
