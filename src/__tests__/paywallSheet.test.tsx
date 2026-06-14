/**
 * PaywallSheet — global modal sheet rendered by EntitlementProvider when
 * `paywallVisible` flips true. Verifies the three user-visible contracts:
 *   - Opens when visible=true.
 *   - "Maybe later" close triggers onClose.
 *   - Subscribe CTA fires onSubscribe so the parent provider can route to
 *     ClientPackages or open the branded checkout.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
    getPackages: jest.fn(),
  },
}));

import { PaywallSheet } from '../entitlements/PaywallSheet';
import { clientPaymentsApi } from '../api/clientPaymentsApi';

const mockedGetPackages = clientPaymentsApi.getPackages as jest.Mock;

beforeEach(() => {
  mockedGetPackages.mockReset();
});

describe('PaywallSheet', () => {
  it('opens when visible=true and loads packages', async () => {
    mockedGetPackages.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: 'pkg_1',
          name: '1:1 Coaching',
          description: 'Weekly check-ins',
          type: 'recurring',
          price: 199,
          currency: 'USD',
          interval: 'month',
          trial_days: null,
          features: [],
        },
      ],
    });
    const { getByTestId, queryByTestId } = await render(
      <PaywallSheet
        visible
        onClose={jest.fn()}
        onSubscribe={jest.fn()}
      />,
    );
    expect(getByTestId('paywall-sheet')).toBeTruthy();
    await waitFor(() => {
      expect(getByTestId('paywall-package-pkg_1')).toBeTruthy();
    });
    expect(queryByTestId('paywall-loading')).toBeNull();
  });

  it('does not load packages when visible=false', async () => {
    await render(
      <PaywallSheet
        visible={false}
        onClose={jest.fn()}
        onSubscribe={jest.fn()}
      />,
    );
    // Visibility is handled by the Modal `visible` prop in RN; the contract
    // we care about here is that we don't pre-fetch packages when the sheet
    // is closed (would waste a request on every screen mount).
    expect(mockedGetPackages).not.toHaveBeenCalled();
  });

  it('"Maybe later" tap calls onClose', async () => {
    mockedGetPackages.mockResolvedValueOnce({ ok: true, data: [] });
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <PaywallSheet visible onClose={onClose} onSubscribe={jest.fn()} />,
    );
    await fireEvent.press(getByTestId('paywall-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('"See all plans" CTA calls onSubscribe', async () => {
    mockedGetPackages.mockResolvedValueOnce({ ok: true, data: [] });
    const onSubscribe = jest.fn();
    const { getByTestId } = await render(
      <PaywallSheet visible onClose={jest.fn()} onSubscribe={onSubscribe} />,
    );
    await fireEvent.press(getByTestId('paywall-subscribe'));
    expect(onSubscribe).toHaveBeenCalled();
  });

  it('tapping a package row calls onSubscribe(packageId)', async () => {
    mockedGetPackages.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: 'pkg_42',
          name: 'Elite',
          description: null,
          type: 'one_time',
          price: 999,
          currency: 'usd',
          interval: null,
          trial_days: null,
          features: [],
        },
      ],
    });
    const onSubscribe = jest.fn();
    const { getByTestId } = await render(
      <PaywallSheet visible onClose={jest.fn()} onSubscribe={onSubscribe} />,
    );
    await waitFor(() => getByTestId('paywall-package-pkg_42'));
    await fireEvent.press(getByTestId('paywall-package-pkg_42'));
    expect(onSubscribe).toHaveBeenCalledWith('pkg_42');
  });

  it('renders structured copy when packages fail to load (Rule 9)', async () => {
    mockedGetPackages.mockResolvedValueOnce({
      ok: false,
      reason: 'error',
      message: 'boom',
    });
    const { findByTestId } = await render(
      <PaywallSheet visible onClose={jest.fn()} onSubscribe={jest.fn()} />,
    );
    const node = await findByTestId('paywall-packages-unavailable');
    expect(node).toBeTruthy();
  });
});
