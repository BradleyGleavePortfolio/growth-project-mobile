import React from 'react';
import { AppState, Text, TouchableOpacity } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'audit-client', role: 'student', coach_id: 'audit-coach' }),
}));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#2C4A36' }),
    tokens: {
      typography: {
        h2: { fontSize: 24 }, h4: { fontSize: 17 }, body: { fontSize: 16 },
        bodyMd: { fontSize: 16, fontWeight: '500' }, bodySmall: { fontSize: 14 },
      },
    },
  }),
}));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => false }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../PaywallSheet', () => ({
  PaywallSheet: () => null,
  COACH_MANAGED_BODY: 'Managed access', COACH_MANAGED_TITLE: 'Managed access',
  COACHLESS_BODY: 'No coach', COACHLESS_TITLE: 'No coach', COACHLESS_CTA: 'Add a coach',
}));
jest.mock('../DunningLockoutScreen', () => ({ DunningLockoutScreen: () => null }));

const mockGetEntitlement = jest.fn();
const mockGetStatus = jest.fn();
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: (...args: unknown[]) => mockGetEntitlement(...args) },
}));
jest.mock('../dunningApi', () => ({
  dunningApi: { getStatus: (...args: unknown[]) => mockGetStatus(...args) },
}));

import { EntitlementProvider, useEntitlement } from '../../EntitlementProvider';
import { ProtectedScreen } from '../../ProtectedScreen';
import { DunningLockoutProvider, useDunning } from '../DunningLockoutProvider';
import { dunningLockoutStore } from '../dunningLockoutStore';
import { queryClient } from '../../../services/queryClient';

const LOCKED = {
  enabled: true, state: 'locked', kind: 'payment', lock_waived: false,
  purchase_id: 'audit-purchase', locked_at: '2026-10-11T15:07:00.000Z',
};
const CLEAR = { enabled: true, state: 'none', purchase_id: null, locked_at: null };

function RecoveryScreen() {
  const dunning = useDunning();
  const entitlement = useEntitlement();
  return (
    <>
      <Text testID="audit-lock">{String(dunning?.locked)}</Text>
      <Text testID="audit-entitlement">{entitlement.status}</Text>
      {/* UpdateCardScreen.settle calls this same provider refresh after payment. */}
      <TouchableOpacity testID="audit-settle-card" onPress={() => void dunning?.refresh()}>
        <Text>Finish card recovery</Text>
      </TouchableOpacity>
      <ProtectedScreen>
        <Text testID="audit-paid-community">Coached community content</Text>
      </ProtectedScreen>
    </>
  );
}

beforeEach(() => {
  dunningLockoutStore.__resetForTests();
  mockGetEntitlement.mockReset();
  mockGetStatus.mockReset();
  (queryClient.invalidateQueries as jest.Mock).mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
});

afterEach(() => jest.restoreAllMocks());

it('LS-PAYFAIL B1: in-app payment recovery restores the real paid screen without an app foreground', async () => {
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false } });
  mockGetStatus.mockResolvedValue(LOCKED);
  const noop = () => undefined;
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
        <RecoveryScreen />
      </DunningLockoutProvider>
    </EntitlementProvider>,
  );
  await waitFor(() => expect(view.getByTestId('audit-lock').props.children).toBe('true'));
  await waitFor(() => expect(view.getByTestId('audit-entitlement').props.children).toBe('inactive'));
  expect(view.queryByTestId('audit-paid-community')).toBeNull();

  // The server has charged the invoice, restored access and cleared dunning.
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
  mockGetStatus.mockResolvedValue(CLEAR);
  await act(async () => { await fireEvent.press(view.getByTestId('audit-settle-card')); });
  await waitFor(() => expect(view.getByTestId('audit-lock').props.children).toBe('false'));
  expect(queryClient.invalidateQueries).toHaveBeenCalled();

  // No explicit entitlement refresh or artificial background/foreground is supplied.
  await waitFor(() => expect(view.queryByTestId('audit-paid-community')).not.toBeNull());
  expect(view.getByTestId('audit-entitlement').props.children).toBe('active');
});
