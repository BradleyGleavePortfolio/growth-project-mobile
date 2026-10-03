/**
 * S-B2 FIX ROUND 4 (S-WEAR-4) — Sol B-317-9 and B-317-10 at cf387e88.
 *
 * B-317-9: the REAL ConnectProviderSheet drives the REAL
 * `connectOnDeviceProvider` (Health Connect on Android), the REAL
 * onDeviceSync orchestrator, session fence and local-authorization storage.
 * Only the edges are doubles: the Health Connect native module (with
 * `getSdkStatus` or `initialize` held by the test), the registration HTTP
 * call, the identity cache and the phone-store sync. Closing, unmounting,
 * switching provider or signing out while a native SETUP await is held must
 * open no new permission prompt and register, record or read nothing.
 *
 * B-317-10: a cloud OAuth browser result that arrives after the sheet was
 * closed, unmounted, replaced with another provider, or after sign-out,
 * must not emit the tutorial success, call onConnected or close the sheet.
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

import ConnectProviderSheet from '../ConnectProviderSheet';
import { authEvents } from '../../../../utils/authEvents';
import { stopOnDeviceHealthWork } from '../../../../services/health/sessionFence';
import { getLocalAuthorization } from '../../../../services/health/onDeviceState';
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
  mockGetSdkStatus.mockClear();
  mockInitialize.mockClear();
  mockRequestPermission.mockClear();
  mockRegister.mockReset();
  mockRegister.mockImplementation(async () => registered(mockCurrentUser ?? 'nobody'));
  mockHealthConnectSync.mockReset();
  mockHealthConnectSync.mockResolvedValue({ postedCount: 4, complete: true });
  mockInvalidate.mockReset();
  mockStartOauth.mockReset();
  mockStartOauth.mockResolvedValue({ authorizationUrl: 'https://provider.example/oauth', state: 's-1' });
  mockOpenAuthSession.mockClear();
  tutorialSignals.length = 0;
  unsubscribeTutorial = subscribeTutorialSignals((s) => tutorialSignals.push(s));
});

afterEach(() => {
  unsubscribeTutorial();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
});

async function release() {
  mockHold = null;
  mockReleases.splice(0).forEach((r) => r());
}

async function expectNoPromptOrWork() {
  expect(mockRequestPermission).not.toHaveBeenCalled();
  expect(mockRegister).not.toHaveBeenCalled();
  expect(mockHealthConnectSync).not.toHaveBeenCalled();
  expect(await getLocalAuthorization('user-a', 'HEALTH_CONNECT')).toBeNull();
}

describe('Sol B-317-9: cancelling during Health Connect setup opens no new permission prompt', () => {
  const HOW = ['hide', 'unmount', 'provider change', 'sign-out'] as const;
  describe.each(['status', 'init'] as const)('while %s is held', (stage) => {
    it.each(HOW)('%s: no prompt, registration, local grant or read', async (how) => {
      mockHold = stage;
      const onClose = jest.fn();
      const view = await render(
        <ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={onClose} />,
      );
      const pressed = Promise.resolve(
        fireEvent.press(screen.getByLabelText('Continue connecting Health Connect')),
      );
      await waitFor(() => expect(mockReleases.length).toBe(1));
      expect(stage === 'status' ? mockGetSdkStatus : mockInitialize).toHaveBeenCalledTimes(1);

      if (how === 'hide') {
        await view.rerender(
          <ConnectProviderSheet provider="HEALTH_CONNECT" visible={false} onClose={onClose} />,
        );
      } else if (how === 'unmount') {
        await view.unmount();
      } else if (how === 'provider change') {
        await view.rerender(<ConnectProviderSheet provider="OURA" visible onClose={onClose} />);
      } else {
        // signOut() calls this first, synchronously, before its first await.
        stopOnDeviceHealthWork();
      }

      await release();
      await pressed;
      await new Promise((r) => setTimeout(r, 0));

      if (stage === 'status') expect(mockInitialize).not.toHaveBeenCalled();
      await expectNoPromptOrWork();
      expect(onClose).not.toHaveBeenCalled();
      if (how === 'sign-out') {
        // Still the same sheet: the stop is explained, not shown as a failure.
        expect(screen.getByText(/so nothing was brought in/)).toBeTruthy();
        expect(screen.queryByText(/permission screen didn't open/)).toBeNull();
      }
    });
  });

  it('a logout auth event during setup also stops it', async () => {
    mockHold = 'init';
    await render(<ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={jest.fn()} />);
    const pressed = Promise.resolve(
      fireEvent.press(screen.getByLabelText('Continue connecting Health Connect')),
    );
    await waitFor(() => expect(mockReleases.length).toBe(1));
    mockCurrentUser = null;
    authEvents.emit('logout');
    await release();
    await pressed;
    await expectNoPromptOrWork();
  });

  it('control: with the sheet left open, the held setup goes on to the prompt, registration and import', async () => {
    mockHold = 'init';
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={onClose} />);
    const pressed = Promise.resolve(
      fireEvent.press(screen.getByLabelText('Continue connecting Health Connect')),
    );
    await waitFor(() => expect(mockReleases.length).toBe(1));
    await release();
    await pressed;
    await waitFor(() => expect(mockHealthConnectSync).toHaveBeenCalledTimes(1));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect((await getLocalAuthorization('user-a', 'HEALTH_CONNECT'))?.connectionId).toBe('conn-user-a');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('Sol B-317-10: a stale cloud auth-session result does nothing visible', () => {
  const HOW = ['hide', 'unmount', 'provider change', 'sign-out'] as const;
  describe.each(['success', 'dismiss'] as const)('browser returns %s', (type) => {
    it.each(HOW)('after %s: no success signal, no onConnected, no close', async (how) => {
      const onClose = jest.fn();
      const onConnected = jest.fn();
      const view = await render(
        <ConnectProviderSheet provider="OURA" visible onClose={onClose} onConnected={onConnected} />,
      );
      const pressed = Promise.resolve(fireEvent.press(screen.getByLabelText('Continue connecting Oura')));
      await waitFor(() => expect(mockOpenAuthSession).toHaveBeenCalledTimes(1));

      if (how === 'hide') {
        await view.rerender(
          <ConnectProviderSheet provider="OURA" visible={false} onClose={onClose} onConnected={onConnected} />,
        );
      } else if (how === 'unmount') {
        await view.unmount();
      } else if (how === 'provider change') {
        await view.rerender(
          <ConnectProviderSheet provider="FITBIT" visible onClose={onClose} onConnected={onConnected} />,
        );
      } else {
        stopOnDeviceHealthWork();
      }

      mockResolveBrowser({ type });
      await pressed;
      await new Promise((r) => setTimeout(r, 0));

      expect(tutorialSignals).toEqual([]);
      expect(onConnected).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      // Same session: the authoritative list is still re-read (the server may
      // have finished the connection). After sign-out: nothing at all.
      expect(mockInvalidate).toHaveBeenCalledTimes(how === 'sign-out' ? 0 : 1);
    });
  });

  it('a new Continue for another attempt is not closed by the old browser result', async () => {
    const onClose = jest.fn();
    const onConnected = jest.fn();
    const view = await render(
      <ConnectProviderSheet provider="OURA" visible onClose={onClose} onConnected={onConnected} />,
    );
    const first = Promise.resolve(fireEvent.press(screen.getByLabelText('Continue connecting Oura')));
    await waitFor(() => expect(mockOpenAuthSession).toHaveBeenCalledTimes(1));
    const resolveFirst = mockResolveBrowser;
    // Closed and reopened for another provider while the browser is up.
    await view.rerender(
      <ConnectProviderSheet provider="OURA" visible={false} onClose={onClose} onConnected={onConnected} />,
    );
    await view.rerender(
      <ConnectProviderSheet provider="FITBIT" visible onClose={onClose} onConnected={onConnected} />,
    );
    resolveFirst({ type: 'success' });
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(onConnected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(tutorialSignals).toEqual([]);
    expect(screen.getByLabelText('Continue connecting Fitbit')).toBeTruthy();
  });

  it.each(['success', 'dismiss'] as const)(
    'control: an unchanged attempt (%s) still invalidates, connects and closes',
    async (type) => {
      const onClose = jest.fn();
      const onConnected = jest.fn();
      await render(
        <ConnectProviderSheet provider="OURA" visible onClose={onClose} onConnected={onConnected} />,
      );
      const pressed = Promise.resolve(fireEvent.press(screen.getByLabelText('Continue connecting Oura')));
      await waitFor(() => expect(mockOpenAuthSession).toHaveBeenCalledTimes(1));
      mockResolveBrowser({ type });
      await pressed;
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mockInvalidate).toHaveBeenCalledTimes(1);
      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(tutorialSignals).toEqual(type === 'success' ? ['wearable_connected'] : []);
    },
  );
});
