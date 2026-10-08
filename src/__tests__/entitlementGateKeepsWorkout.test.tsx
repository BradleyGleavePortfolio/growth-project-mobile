/**
 * TRAIN-GATE-128 (FW-TRAIN-128 B1): leaving the app mid-workout must not
 * unmount the live workout, and weak signal must not turn a paid client's
 * workout into "Choose a Plan". Only a confirmed inactive result gates;
 * the first fetch still fails closed.
 */
import React, { useEffect } from 'react';
import { AppState, AppStateStatus, Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2C4A36',
      background: '#F5EFE4',
      surface: '#F1E8D5',
      border: '#E0D8C8',
      textPrimary: '#1A1A18',
      textSecondary: '#6B6B6B',
      textOnPrimary: '#FFFFFF',
      cardShadow: 'rgba(0,0,0,0.4)',
    },
    tokens: {
      typography: {
        h2: { fontSize: 24 },
        h4: { fontSize: 17 },
        body: { fontSize: 16 },
        bodyMd: { fontSize: 16, fontWeight: '500' },
        bodySmall: { fontSize: 14 },
      },
    },
  }),
}));

jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: {
    getEntitlement: jest.fn(),
    getPackages: jest.fn().mockResolvedValue({ ok: true, data: [] }),
  },
}));

jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'a@b.com', role: 'student', coach_id: 'c1' }),
}));

jest.mock('../services/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

import { EntitlementProvider } from '../entitlements/EntitlementProvider';
import { ProtectedScreen } from '../entitlements/ProtectedScreen';
import { entitlementEvents } from '../entitlements/entitlementEvents';
import { clientPaymentsApi } from '../api/clientPaymentsApi';

const mockedGetEntitlement = clientPaymentsApi.getEntitlement as jest.Mock;
const ACTIVE = { ok: true, data: { active: true } };
const INACTIVE = { ok: true, data: { active: false } };
const NETWORK_DOWN = { ok: false, reason: 'error', message: 'Network down' };

let appStateHandler: ((s: AppStateStatus) => void) | null = null;
let mounts = 0;
let unmounts = 0;

function LiveWorkout() {
  useEffect(() => {
    mounts += 1;
    return () => {
      unmounts += 1;
    };
  }, []);
  return <Text testID="live-workout">Bench press set 2</Text>;
}

function tree() {
  return (
    <EntitlementProvider>
      <ProtectedScreen>
        <LiveWorkout />
      </ProtectedScreen>
    </EntitlementProvider>
  );
}

async function leaveAndReturn() {
  await act(async () => {
    appStateHandler?.('background');
    appStateHandler?.('active');
  });
}

function gateShown(q: (id: string) => unknown) {
  return Boolean(
    q('protected-screen-paywall') || q('protected-screen-coach-managed') || q('protected-screen-check-failed'),
  );
}

beforeEach(() => {
  mockedGetEntitlement.mockReset();
  mounts = 0;
  unmounts = 0;
  appStateHandler = null;
  // The jest preset leaves currentState unset; a real app starts 'active'.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: AppStateStatus) => void) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProtectedScreen keeps a confirmed-active workout mounted', () => {
  it('foreground re-check in flight keeps the live workout mounted (no spinner swap)', async () => {
    let resolveSecond: (v: unknown) => void = () => {};
    mockedGetEntitlement
      .mockResolvedValueOnce(ACTIVE)
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
    const screen = await render(tree());
    await waitFor(() => expect(screen.getByTestId('live-workout')).toBeTruthy());

    await leaveAndReturn();
    expect(mockedGetEntitlement).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('live-workout')).toBeTruthy();
    expect(screen.queryByTestId('protected-screen-loading')).toBeNull();

    await act(async () => { resolveSecond(ACTIVE); });
    expect(screen.getByTestId('live-workout')).toBeTruthy();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('failed re-check on weak signal after a confirmed active keeps the workout, never "Choose a Plan"', async () => {
    mockedGetEntitlement.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(NETWORK_DOWN);
    const screen = await render(tree());
    await waitFor(() => expect(screen.getByTestId('live-workout')).toBeTruthy());

    await leaveAndReturn();
    await waitFor(() => expect(mockedGetEntitlement).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('live-workout')).toBeTruthy();
    expect(gateShown(screen.queryByTestId)).toBe(false);
    expect(screen.queryByText('Choose a Plan')).toBeNull();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('a confirmed inactive re-check still gates', async () => {
    mockedGetEntitlement.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(INACTIVE);
    const screen = await render(tree());
    await waitFor(() => expect(screen.getByTestId('live-workout')).toBeTruthy());

    await leaveAndReturn();
    await waitFor(() => expect(screen.queryByTestId('live-workout')).toBeNull());
    expect(gateShown(screen.queryByTestId)).toBe(true);
  });

  it('a 402 after a confirmed active gates, and a later network failure stays gated', async () => {
    mockedGetEntitlement.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(NETWORK_DOWN);
    const screen = await render(tree());
    await waitFor(() => expect(screen.getByTestId('live-workout')).toBeTruthy());

    await act(async () => {
      entitlementEvents.emitRequired({ status: 402, code: 'CLIENT_ENTITLEMENT_REQUIRED', message: 'm' });
    });
    await waitFor(() => expect(screen.queryByTestId('live-workout')).toBeNull());
    await leaveAndReturn();
    await waitFor(() => expect(mockedGetEntitlement).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('live-workout')).toBeNull();
    expect(gateShown(screen.queryByTestId)).toBe(true);
  });

  it('first fetch failing still fails closed (no paid content)', async () => {
    mockedGetEntitlement.mockResolvedValue(NETWORK_DOWN);
    const screen = await render(tree());
    await waitFor(() => expect(gateShown(screen.queryByTestId)).toBe(true));
    expect(screen.queryByTestId('live-workout')).toBeNull();
  });
});
