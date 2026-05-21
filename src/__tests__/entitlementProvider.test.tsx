/**
 * EntitlementProvider — wiring tests.
 *
 * Pins three behaviours that Hunter #2 P0-3 found broken or missing:
 *   1. A 402 emission from the API interceptor sets paywallVisible=true so
 *      the global PaywallSheet shows.
 *   2. A successful refreshEntitlement (active=true) clears paywallVisible.
 *   3. A network-failing refreshEntitlement leaves status='unavailable' so
 *      ProtectedScreen fails CLOSED (entitlementActive=null, not true).
 */
import React from 'react';
import { Text, View } from 'react-native';
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
  useCurrentUser: () => ({ id: 'u1', email: 'a@b.com', role: 'student' }),
}));

jest.mock('../services/queryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

import {
  EntitlementProvider,
  useEntitlement,
} from '../entitlements/EntitlementProvider';
import { entitlementEvents } from '../entitlements/entitlementEvents';
import { clientPaymentsApi } from '../api/clientPaymentsApi';

const mockedGetEntitlement = clientPaymentsApi.getEntitlement as jest.Mock;

function Probe({ onCtx }: { onCtx: (c: ReturnType<typeof useEntitlement>) => void }) {
  const ctx = useEntitlement();
  onCtx(ctx);
  return <View testID="probe"><Text>{ctx.status}</Text></View>;
}

beforeEach(() => {
  mockedGetEntitlement.mockReset();
});

describe('EntitlementProvider', () => {
  it('402 emission flips paywallVisible=true', async () => {
    mockedGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    let latest: ReturnType<typeof useEntitlement> | null = null;
    render(
      <EntitlementProvider>
        <Probe onCtx={(c) => { latest = c; }} />
      </EntitlementProvider>,
    );
    await waitFor(() => expect(latest?.status).toBe('active'));

    await act(async () => {
      entitlementEvents.emitRequired({
        status: 402,
        code: 'CLIENT_ENTITLEMENT_REQUIRED',
        message: 'Choose a plan to continue.',
      });
    });
    await waitFor(() => expect(latest?.paywallVisible).toBe(true));
    expect(latest?.paywallMessage).toBe('Choose a plan to continue.');
  });

  it('refreshEntitlement returning active=true clears paywallVisible', async () => {
    // First call → inactive (sets paywall after 402); second call → active.
    mockedGetEntitlement
      .mockResolvedValueOnce({ ok: true, data: { active: false } })
      .mockResolvedValueOnce({ ok: true, data: { active: true } });

    let latest: ReturnType<typeof useEntitlement> | null = null;
    render(
      <EntitlementProvider>
        <Probe onCtx={(c) => { latest = c; }} />
      </EntitlementProvider>,
    );
    await waitFor(() => expect(latest?.status).toBe('inactive'));

    // Simulate 402 firing the paywall.
    await act(async () => {
      entitlementEvents.emitRequired({
        status: 402,
        code: 'CLIENT_ENTITLEMENT_REQUIRED',
        message: 'm',
      });
    });
    await waitFor(() => expect(latest?.paywallVisible).toBe(true));

    // Now user buys a package; refresh succeeds.
    await act(async () => {
      await latest!.refreshEntitlement();
    });
    await waitFor(() => expect(latest?.paywallVisible).toBe(false));
    expect(latest?.status).toBe('active');
  });

  it('network failure on getEntitlement → status=unavailable (fail closed)', async () => {
    mockedGetEntitlement.mockResolvedValue({
      ok: false,
      reason: 'error',
      message: 'Network down',
    });
    let latest: ReturnType<typeof useEntitlement> | null = null;
    render(
      <EntitlementProvider>
        <Probe onCtx={(c) => { latest = c; }} />
      </EntitlementProvider>,
    );
    await waitFor(() => expect(latest?.status).toBe('unavailable'));
    // entitlementActive null means ProtectedScreen renders the paywall (verified
    // separately in protectedScreenFailClosed.test.tsx).
    expect(latest?.entitlementActive).toBeNull();
  });

});
