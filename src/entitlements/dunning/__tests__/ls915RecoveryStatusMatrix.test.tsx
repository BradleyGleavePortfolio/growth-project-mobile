import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

const mockEntitlement = jest.fn();
const mockStatus = jest.fn();
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'matrix-client', role: 'student', coach_id: 'matrix-coach' }),
}));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: (...args: unknown[]) => mockEntitlement(...args) },
}));
jest.mock('../dunningApi', () => ({
  dunningApi: { getStatus: (...args: unknown[]) => mockStatus(...args) },
}));
jest.mock('../../../services/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../PaywallSheet', () => ({ PaywallSheet: () => null }));
jest.mock('../DunningLockoutScreen', () => ({ DunningLockoutScreen: () => null }));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => false }));
jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#2C4A36' }),
    tokens: {
      typography: {
        h2: { fontSize: 24 }, h4: { fontSize: 17 }, body: { fontSize: 16 },
        bodyMd: { fontSize: 16 }, bodySmall: { fontSize: 14 },
      },
    },
  }),
}));

import { EntitlementProvider, useEntitlement } from '../../EntitlementProvider';
import { ProtectedScreen } from '../../ProtectedScreen';
import { DunningLockoutProvider, useDunning } from '../DunningLockoutProvider';
import { dunningLockoutStore } from '../dunningLockoutStore';
import { queryClient } from '../../../services/queryClient';

const LOCKED = {
  enabled: true, state: 'locked', kind: 'payment', lock_waived: false,
  purchase_id: 'matrix-plan', locked_at: '2026-10-11T15:07:00.000Z',
};
const noop = () => undefined;
let refreshDunning: () => Promise<void>;
function Probe() {
  const dunning = useDunning();
  const entitlement = useEntitlement();
  refreshDunning = async () => { await dunning?.refresh(); };
  return (
    <>
      <Text testID="locked">{String(dunning?.locked)}</Text>
      <Text testID="entitlement">{entitlement.status}</Text>
      <ProtectedScreen><Text testID="paid">paid content</Text></ProtectedScreen>
    </>
  );
}
async function mountLocked() {
  mockEntitlement.mockResolvedValue({ ok: true, data: { active: false } });
  mockStatus.mockResolvedValue(LOCKED);
  const view = await render(
    <EntitlementProvider>
      <DunningLockoutProvider
        enabled
        onMessageCoach={noop}
        onOpenDataExport={noop}
        onOpenDeleteAccount={noop}
        onSignOut={noop}
        onOpenUpdateCard={noop}
        getCurrentRouteName={() => 'UpdateCard'}
        subscribeToRouteChanges={() => noop}
      >
        <Probe />
      </DunningLockoutProvider>
    </EntitlementProvider>,
  );
  await waitFor(() => expect(view.getByTestId('locked').props.children).toBe('true'));
  await waitFor(() => expect(view.getByTestId('entitlement').props.children).toBe('inactive'));
  mockEntitlement.mockClear();
  (queryClient.invalidateQueries as jest.Mock).mockClear();
  return view;
}

beforeEach(() => {
  dunningLockoutStore.__resetForTests();
  mockEntitlement.mockReset();
  mockStatus.mockReset();
  (queryClient.invalidateQueries as jest.Mock).mockClear();
});

describe('LS-915 independent real-provider recovery matrix', () => {
  const ROWS = [
    { label: 'all paid and clear', next: { enabled: true, state: 'none' }, active: true, locked: false, rereads: 1 },
    { label: 'ended plan and clear', next: { enabled: true, state: 'none' }, active: false, locked: false, rereads: 1 },
    { label: 'back within grace', next: { ...LOCKED, state: 'past_due' }, active: true, locked: false, rereads: 1 },
    { label: 'another live plan waives lock', next: { ...LOCKED, lock_waived: true }, active: true, locked: false, rereads: 1 },
    { label: 'still locked after partial payment', next: LOCKED, active: true, locked: true, rereads: 0 },
    { label: 'dunning disabled is not entitlement', next: { enabled: false, state: 'none' }, active: false, locked: false, rereads: 1 },
  ];
  it.each(ROWS)('$label', async ({ next, active, locked, rereads }) => {
    const view = await mountLocked();
    mockStatus.mockResolvedValue(next);
    mockEntitlement.mockResolvedValue({ ok: true, data: { active } });
    await act(async () => { await refreshDunning(); });
    await waitFor(() => expect(view.getByTestId('locked').props.children).toBe(String(locked)));
    expect(mockEntitlement).toHaveBeenCalledTimes(rereads);
    expect((queryClient.invalidateQueries as jest.Mock).mock.calls).toHaveLength(rereads);
    expect(view.queryByTestId('paid') !== null).toBe(!locked && active);
    // Repeated authoritative clear/locked status is not another transition.
    await act(async () => { await refreshDunning(); });
    expect(mockEntitlement).toHaveBeenCalledTimes(rereads);
  });

  it('a failed status read retains the lock and starts no optimistic entitlement read', async () => {
    const view = await mountLocked();
    mockStatus.mockRejectedValue(new Error('review status unavailable'));
    mockEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    await act(async () => { await refreshDunning(); });
    expect(view.getByTestId('locked').props.children).toBe('true');
    expect(mockEntitlement).not.toHaveBeenCalled();
    expect(view.queryByTestId('paid')).toBeNull();
  });

  it('a clear status from the previous auth generation is ignored', async () => {
    const view = await mountLocked();
    let resolve!: (value: unknown) => void;
    mockStatus.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    let read!: Promise<void>;
    await act(async () => { read = refreshDunning(); });
    await act(async () => {
      dunningLockoutStore.retire();
      resolve({ enabled: true, state: 'none' });
      await read;
    });
    expect(view.getByTestId('entitlement').props.children).toBe('inactive');
    expect(mockEntitlement).not.toHaveBeenCalled();
    expect(view.queryByTestId('paid')).toBeNull();
  });
});
