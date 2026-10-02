/**
 * S14 round 3 — Sol A-317-1 (narrow reproduction at c7e35d84): the sheet
 * awaited the native permission prompt BEFORE the orchestrator captured the
 * signed-in user, so an account switch while the prompt was open registered,
 * authorized and imported A's phone data into B's account.
 *
 * This is the sheet-to-orchestrator composition test the audit asked for:
 * the REAL ConnectProviderSheet, the REAL onDeviceSync orchestrator, the REAL
 * session fence and auth events, the REAL local-authorization storage. Only
 * the edges are mocked: the native permission prompt (deferred), the
 * registration HTTP call, the identity cache and the phone-store sync.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockInvalidate = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useStartOauth: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useInvalidateWearableConnections: () => mockInvalidate,
}));

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

// The native permission prompt: resolved by the test, after the session moves.
let mockResolvePrompt: (outcome: string) => void = () => undefined;
const mockPrompt = jest.fn(
  () =>
    new Promise<string>((resolve) => {
      mockResolvePrompt = resolve;
    }),
);
jest.mock('../../../../services/health/onDeviceConnect', () => ({
  connectOnDeviceProvider: () => mockPrompt(),
  openHealthConnectPermissions: jest.fn(),
  openHealthConnectStore: jest.fn(),
}));

jest.mock('../../../../services/authActions', () => ({ signOut: jest.fn() }));

// Who the identity cache says is signed in right now. With mockDeferIdentity
// the read waits until the test releases it (Sol B-317-6).
let mockCurrentUser: string | null = 'user-a';
let mockDeferIdentity = false;
const mockIdentityWaiters: Array<() => void> = [];
jest.mock('../../../../lib/userCache', () => ({
  readUserCache: jest.fn(async () => {
    if (mockDeferIdentity) await new Promise<void>((r) => mockIdentityWaiters.push(r));
    return mockCurrentUser ? { id: mockCurrentUser } : null;
  }),
}));

// Registration would succeed for whoever's JWT is attached (B after a switch).
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

// The phone-store read + ingest. Never reached after a session change.
const mockHealthKitSync = jest.fn();
jest.mock('../../../../services/health/healthkit', () => ({
  healthKitSyncService: { sync: (...args: unknown[]) => mockHealthKitSync(...args) },
}));
jest.mock('../../../../services/health/healthConnect', () => ({
  syncHealthConnect: jest.fn(),
}));

import ConnectProviderSheet from '../ConnectProviderSheet';
import { authEvents } from '../../../../utils/authEvents';
import { getLocalAuthorization } from '../../../../services/health/onDeviceState';

function registered(userId: string) {
  return {
    id: `conn-${userId}`,
    user_id: userId,
    provider: 'APPLE_HEALTHKIT',
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
  await AsyncStorage.clear();
  mockCurrentUser = 'user-a';
  mockDeferIdentity = false;
  mockIdentityWaiters.length = 0;
  mockPrompt.mockClear();
  mockRegister.mockReset();
  mockRegister.mockImplementation(async () => registered(mockCurrentUser ?? 'nobody'));
  mockHealthKitSync.mockReset();
  mockHealthKitSync.mockResolvedValue({ postedCount: 7, complete: true });
  mockInvalidate.mockReset();
});

/**
 * Tap Continue and wait until the native prompt is open. The press is NOT
 * awaited here: its handler stays pending on the prompt until the test
 * resolves it; the returned promise settles after that.
 */
async function startContinue(
  onClose: () => void = jest.fn(),
): Promise<{ pressed: Promise<unknown> }> {
  await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />);
  const pressed = Promise.resolve(
    fireEvent.press(screen.getByLabelText('Continue connecting Apple Health')),
  );
  await waitFor(() => expect(mockPrompt).toHaveBeenCalledTimes(1));
  return { pressed };
}

async function expectNothingHappened() {
  expect(mockRegister).not.toHaveBeenCalled();
  expect(mockHealthKitSync).not.toHaveBeenCalled();
  expect(await getLocalAuthorization('user-a', 'APPLE_HEALTHKIT')).toBeNull();
  expect(await getLocalAuthorization('user-b', 'APPLE_HEALTHKIT')).toBeNull();
}

describe('A-317-1: a session change while the permission prompt is open', () => {
  it('A -> B: no registration, no local grant, no phone read or upload for anyone', async () => {
    const { pressed } = await startContinue();
    mockCurrentUser = 'user-b';
    authEvents.emit('login');
    mockResolvePrompt('granted');
    await pressed;
    await waitFor(() =>
      expect(
        screen.getByText(/The signed-in account changed while Apple Health was connecting/),
      ).toBeTruthy(),
    );
    await expectNothingHappened();
  });

  it('sign-out: nothing registered, recorded or read', async () => {
    const { pressed } = await startContinue();
    mockCurrentUser = null;
    authEvents.emit('logout');
    mockResolvePrompt('granted');
    await pressed;
    await waitFor(() => expect(screen.getByText(/nothing was brought in/)).toBeTruthy());
    await expectNothingHappened();
  });

  it('same account signs in again: the old run still stops (generation changed)', async () => {
    const { pressed } = await startContinue();
    authEvents.emit('logout');
    authEvents.emit('login');
    mockResolvePrompt('granted');
    await pressed;
    await waitFor(() => expect(screen.getByText(/nothing was brought in/)).toBeTruthy());
    await expectNothingHappened();
  });

  it('control: with no session change the tapping person is registered, authorized and imported', async () => {
    const onClose = jest.fn();
    const { pressed } = await startContinue(onClose);
    mockResolvePrompt('granted');
    await pressed;
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect((await getLocalAuthorization('user-a', 'APPLE_HEALTHKIT'))?.connectionId).toBe(
      'conn-user-a',
    );
    expect(mockHealthKitSync).toHaveBeenCalledTimes(1);
    expect(mockHealthKitSync.mock.calls[0][0].scope).toEqual({
      userId: 'user-a',
      connectionId: 'conn-user-a',
      source: 'APPLE_HEALTHKIT',
    });
  });
});

/**
 * Sol B-317-6 (AUD-SOL-5): closing, unmounting or switching provider while
 * the identity read begun by Continue is still pending. Before the fix the
 * late continuation created and installed a fence anyway and went on to the
 * permission prompt, registration, local grant and phone sync for the
 * original person. Now: zero prompt, registration, grant and phone read.
 */
describe('B-317-6: cancelling before the fence exists', () => {
  it.each(['hide', 'unmount', 'provider change'])(
    '%s while the signed-in person is being read: nothing is prompted, registered, recorded or read',
    async (how) => {
      mockDeferIdentity = true;
      const onClose = jest.fn();
      const view = await render(
        <ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />,
      );
      const pressed = Promise.resolve(
        fireEvent.press(screen.getByLabelText('Continue connecting Apple Health')),
      );
      await waitFor(() => expect(mockIdentityWaiters.length).toBe(1));

      if (how === 'hide') {
        await view.rerender(
          <ConnectProviderSheet provider="APPLE_HEALTHKIT" visible={false} onClose={onClose} />,
        );
      } else if (how === 'unmount') {
        await view.unmount();
      } else {
        await view.rerender(<ConnectProviderSheet provider="OURA" visible onClose={onClose} />);
      }

      // The same person, still signed in, with access that would be granted.
      mockDeferIdentity = false;
      mockIdentityWaiters.splice(0).forEach((release) => release());
      await pressed;
      await new Promise((r) => setTimeout(r, 0));

      expect(mockPrompt).not.toHaveBeenCalled();
      await expectNothingHappened();
    },
  );

  it('control: with the sheet left open, the same deferred read goes on to the prompt', async () => {
    mockDeferIdentity = true;
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={jest.fn()} />);
    const pressed = Promise.resolve(
      fireEvent.press(screen.getByLabelText('Continue connecting Apple Health')),
    );
    await waitFor(() => expect(mockIdentityWaiters.length).toBe(1));
    mockDeferIdentity = false;
    mockIdentityWaiters.splice(0).forEach((release) => release());
    await waitFor(() => expect(mockPrompt).toHaveBeenCalledTimes(1));
    mockResolvePrompt('granted');
    await pressed;
    await waitFor(() => expect(mockHealthKitSync).toHaveBeenCalledTimes(1));
  });
});
