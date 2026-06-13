/**
 * ProtectedScreen — fail-closed behaviour.
 *
 * Hunter #2 P0-3: `ProtectedScreen` previously gated on
 * `entitlementActive === false`, so when the entitlement check failed
 * (network 5xx → status='unavailable', entitlementActive=null) it
 * rendered the *children* (paid content) instead of the paywall. That is
 * fail-OPEN on transport errors. This test pins the new fail-CLOSED
 * policy: only an explicit `true` may render children.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2C4A36',
      background: '#F5EFE4',
      textPrimary: '#1A1A18',
      textSecondary: '#6B6B6B',
      textOnPrimary: '#FFFFFF',
    },
    tokens: {
      typography: {
        h2: { fontSize: 24 },
        body: { fontSize: 16 },
        bodyMd: { fontSize: 16, fontWeight: '500' },
      },
    },
  }),
}));

import { ProtectedScreen } from '../entitlements/ProtectedScreen';
import * as Provider from '../entitlements/EntitlementProvider';

type Ctx = ReturnType<typeof Provider.useEntitlement>;

function mockEntitlement(ctx: Partial<Ctx>) {
  const value: Ctx = {
    entitlementActive: null,
    checking: false,
    status: 'unknown',
    refreshEntitlement: async () => false,
    openPlans: jest.fn(),
    paywallVisible: false,
    paywallMessage: null,
    dismissPaywall: jest.fn(),
    ...ctx,
  };
  jest.spyOn(Provider, 'useEntitlement').mockReturnValue(value);
}

const Child = () => <Text testID="paid-content">Paid feature</Text>;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProtectedScreen fail-closed gate', () => {
  it('entitlementActive=true → renders children', async () => {
    mockEntitlement({ entitlementActive: true, status: 'active' });
    const { getByTestId, queryByTestId } = await render(
      <ProtectedScreen>
        <Child />
      </ProtectedScreen>,
    );
    expect(getByTestId('paid-content')).toBeTruthy();
    expect(queryByTestId('protected-screen-paywall')).toBeNull();
  });

  it('entitlementActive=false → renders paywall', async () => {
    mockEntitlement({ entitlementActive: false, status: 'inactive' });
    const { getByTestId, queryByTestId } = await render(
      <ProtectedScreen>
        <Child />
      </ProtectedScreen>,
    );
    expect(getByTestId('protected-screen-paywall')).toBeTruthy();
    expect(queryByTestId('paid-content')).toBeNull();
  });

  it('entitlementActive=null after first settle (status=unavailable) → renders paywall (FAIL CLOSED)', async () => {
    mockEntitlement({ entitlementActive: null, status: 'unavailable' });
    const { getByTestId, queryByTestId } = await render(
      <ProtectedScreen>
        <Child />
      </ProtectedScreen>,
    );
    expect(getByTestId('protected-screen-paywall')).toBeTruthy();
    expect(queryByTestId('paid-content')).toBeNull();
  });

  it('status=loading on first fetch → renders spinner (no paywall flash)', async () => {
    mockEntitlement({ entitlementActive: null, status: 'loading' });
    const { getByTestId, queryByTestId } = await render(
      <ProtectedScreen>
        <Child />
      </ProtectedScreen>,
    );
    expect(getByTestId('protected-screen-loading')).toBeTruthy();
    expect(queryByTestId('protected-screen-paywall')).toBeNull();
    expect(queryByTestId('paid-content')).toBeNull();
  });

  it('status=checking → spinner (not paywall)', async () => {
    mockEntitlement({ entitlementActive: null, status: 'checking' });
    const { getByTestId, queryByTestId } = await render(
      <ProtectedScreen>
        <Child />
      </ProtectedScreen>,
    );
    expect(getByTestId('protected-screen-loading')).toBeTruthy();
    expect(queryByTestId('protected-screen-paywall')).toBeNull();
  });

  it('"View Plans" CTA calls openPlans', async () => {
    const openPlans = jest.fn();
    mockEntitlement({ entitlementActive: false, status: 'inactive', openPlans });
    const { getByTestId } = await render(
      <ProtectedScreen>
        <Child />
      </ProtectedScreen>,
    );
    await fireEvent.press(getByTestId('protected-screen-view-plans'));
    expect(openPlans).toHaveBeenCalled();
  });
});
