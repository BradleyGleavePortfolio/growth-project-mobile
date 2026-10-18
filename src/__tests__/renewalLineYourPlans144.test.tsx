/**
 * BILLFIX1 (agent 144): the renewal line every plan shows before paying names
 * the place where a plan is really ended. Membership is read-only; End my plan
 * lives in Your plans (YourPlansPanel on ClientPackages). This test proves the
 * line names that place and that the tap path to it arrives somewhere real:
 *   More -> Membership -> "Your plans" -> ClientPackages -> Your plans panel
 *   with End my plan. (MembershipScreen.status128 presses the "Your plans"
 *   button and asserts navigate('ClientPackages').)
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../theme/tokens').default;
  return { useTheme: () => ({ tokens, semanticColors: tokens.lightTokens, colorScheme: 'light' }) };
});
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() },
}));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

import { planTerms, type PurchasablePackage } from '../lib/planTerms';
import YourPlansPanel, { YOUR_PLANS_COPY } from '../components/purchase/YourPlansPanel';

const src = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const RENEWING: PurchasablePackage = {
  id: 'pkg-1',
  name: 'Monthly coaching',
  currency: 'usd',
  amountCents: 9900,
  renewing: true,
  interval: 'month',
  intervalCount: 1,
  oneTimeCents: 0,
  trialDays: 0,
};

describe('the renewal line points to Your plans', () => {
  it('names Your plans, not Membership', () => {
    const { renewal } = planTerms(RENEWING);
    expect(renewal).toBe(
      'Renews automatically at $99.00 a month until you cancel. ' +
        'Cancel anytime in Your plans; you keep the plan until the end of the period you paid for.',
    );
    expect(renewal).not.toMatch(/Membership/);
    // Trial and combo plans carry the same line.
    expect(planTerms({ ...RENEWING, trialDays: 7 }).renewal).toBe(renewal);
    expect(planTerms({ ...RENEWING, oneTimeCents: 5000 }).renewal).toBe(renewal);
  });

  it('the place it names exists: the Your plans panel shows End my plan for a renewing plan', async () => {
    const ID = 'purchase-1';
    mockGet.mockResolvedValue({
      data: {
        plans: [
          {
            purchase_id: ID, package_id: 'pkg-1', package_name: 'Monthly coaching', state: 'active',
            entitlement_active: true, amount_cents: 9900, currency: 'usd', interval: 'month', interval_count: 1,
            next_charge_at: '2026-11-02T12:00:00.000Z', cancel_at_period_end: false, access_ends_at: null,
            can_cancel: true, can_resume: false,
          },
        ],
      },
    });
    const r = await render(<YourPlansPanel />);
    await waitFor(() => expect(r.getByTestId(`your-plan-end-${ID}`)).toBeTruthy());
    expect(YOUR_PLANS_COPY.title).toBe('Your plans');
    expect(r.getByText('Your plans')).toBeTruthy();
    expect(r.getByText(YOUR_PLANS_COPY.endPlan)).toBeTruthy();
  });

  it('the tap path arrives there: More -> Membership -> Your plans -> ClientPackages (Your plans panel)', () => {
    const more = src('screens/client/MoreScreen.tsx');
    expect(more).toMatch(/label: 'Membership',[\s\S]{0,200}target: \{ type: 'stack', screen: 'Membership' \}/);
    const membership = src('screens/client/MembershipScreen.tsx');
    expect(membership).toMatch(/status\.hasPlan \? 'Your plans'/);
    expect(membership).toMatch(/onPress=\{\(\) => navigation\.navigate\('ClientPackages'\)\}/);
    const nav = src('navigation/ClientNavigator.tsx');
    expect(nav).toMatch(/MoreStackNav\.Screen name="Membership"/);
    expect(nav).toMatch(/MoreStackNav\.Screen name="ClientPackages"/);
    expect(src('screens/client/ClientPackagesScreen.tsx')).toMatch(/<YourPlansPanel\b/);
    // After buying on the share-link checkout, its plan action opens the same screen.
    expect(src('screens/client/PackageCheckoutScreen.tsx')).toMatch(/navigation\.navigate\('ClientPackages'\)/);
  });
});
