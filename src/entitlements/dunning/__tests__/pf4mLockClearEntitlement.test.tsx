/**
 * PF-4-M (LS-PAYFAIL B1): when the lock clears for the same account, EntitlementProvider reads the plan
 * again so paid screens open without an app foreground. A sign-out or sign-in retires the lock instead,
 * reads nothing for it, and the previous account's late answer never lands on the next one.
 */
import React from 'react';
import { AppState, Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

let mockUser = { id: 'client-a', role: 'student', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#2C4A36' }),
    tokens: { typography: { h2: { fontSize: 24 }, h4: { fontSize: 17 }, body: { fontSize: 16 }, bodyMd: { fontSize: 16 }, bodySmall: { fontSize: 14 } } },
  }),
}));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => false }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../PaywallSheet', () => ({
  PaywallSheet: () => null,
  COACH_MANAGED_BODY: 'x', COACH_MANAGED_TITLE: 'x', COACHLESS_BODY: 'x', COACHLESS_TITLE: 'x', COACHLESS_CTA: 'x',
}));
const mockGetEntitlement = jest.fn();
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: (...args: unknown[]) => mockGetEntitlement(...args) },
}));

import { EntitlementProvider, useEntitlement } from '../../EntitlementProvider';
import { ProtectedScreen } from '../../ProtectedScreen';
import { dunningLockoutStore } from '../dunningLockoutStore';

type Answer = { ok: true; data: { active: boolean } };
const answer = (active: boolean): Answer => ({ ok: true, data: { active } });
let appStateListener: ((next: string) => void) | undefined;

function Probe() {
  const { status } = useEntitlement();
  return (
    <>
      <Text testID="status">{status}</Text>
      <ProtectedScreen><Text testID="paid">Paid screen</Text></ProtectedScreen>
    </>
  );
}
const lock = () => act(async () => dunningLockoutStore.reportLocked({ requestId: 'r1', generation: dunningLockoutStore.currentGeneration() }));

async function openLocked() {
  mockGetEntitlement.mockResolvedValue(answer(false));
  const view = await render(<EntitlementProvider><Probe /></EntitlementProvider>);
  await waitFor(() => expect(view.getByTestId('status').props.children).toBe('inactive'));
  await lock();
  expect(view.queryByTestId('paid')).toBeNull();
  mockGetEntitlement.mockClear();
  return view;
}

beforeEach(() => {
  mockUser = { id: 'client-a', role: 'student', coach_id: 'coach-1' };
  dunningLockoutStore.__resetForTests();
  mockGetEntitlement.mockReset();
  appStateListener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListener = fn as (next: string) => void;
    return { remove: jest.fn() };
  });
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
});
afterEach(() => jest.restoreAllMocks());

describe('PF-4-M: the plan is read again when the lock clears', () => {
  it('a payment in the app clears the lock and the paid screen opens without a foreground', async () => {
    const view = await openLocked();
    mockGetEntitlement.mockResolvedValue(answer(true));
    await act(async () => dunningLockoutStore.clear(dunningLockoutStore.currentGeneration()));
    await waitFor(() => expect(view.queryByTestId('paid')).not.toBeNull());
    expect(mockGetEntitlement).toHaveBeenCalledTimes(1);
    expect(appStateListener).toBeDefined();
  });

  it('a payment on the web opens the paid screen when the app comes back to the front', async () => {
    const view = await openLocked();
    mockGetEntitlement.mockResolvedValue(answer(true));
    await act(async () => appStateListener?.('background'));
    await act(async () => appStateListener?.('active'));
    // The lockout's own foreground status read then clears the lock: one more read, same answer.
    await act(async () => dunningLockoutStore.clear(dunningLockoutStore.currentGeneration()));
    await waitFor(() => expect(view.queryByTestId('paid')).not.toBeNull());
    expect(view.getByTestId('status').props.children).toBe('active');
  });

  it('sign-out then sign-in as another account: nothing carries over', async () => {
    const view = await openLocked();
    let lateAnswerForA: (value: Answer) => void = () => undefined;
    mockGetEntitlement.mockImplementationOnce(() => new Promise<Answer>((resolve) => { lateAnswerForA = resolve; }));
    // Account A's read is still out (a foreground re-check on weak signal) when A signs out.
    await act(async () => appStateListener?.('background'));
    await act(async () => appStateListener?.('active'));
    expect(mockGetEntitlement).toHaveBeenCalledTimes(1);

    // A retire (sign-out, then sign-in) is not a payment: it reads nothing.
    await act(async () => dunningLockoutStore.retire());
    expect(mockGetEntitlement).toHaveBeenCalledTimes(1);

    mockUser = { id: 'client-b', role: 'student', coach_id: 'coach-2' };
    mockGetEntitlement.mockResolvedValue(answer(false));
    await view.rerender(<EntitlementProvider><Probe /></EntitlementProvider>);
    await waitFor(() => expect(view.getByTestId('status').props.children).toBe('inactive'));
    expect(mockGetEntitlement).toHaveBeenCalledTimes(2);

    // Account A's late "active" answer is dropped.
    await act(async () => lateAnswerForA(answer(true)));
    expect(view.getByTestId('status').props.children).toBe('inactive');
    expect(view.queryByTestId('paid')).toBeNull();
  });
});
