/**
 * LS-914R2 B2 (class): a host that reads the moment once (usePlanMoment)
 * draws the receipt in its scrolling content and See what unlocks + Done in
 * its pinned bar (PlanActiveBar), never under the content. One purchases read
 * feeds both.
 */
import React from 'react';
import { AccessibilityInfo, ScrollView, View } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ClientPurchase } from '../../../api/clientPaymentsApi';
import type { PurchaseSuccess } from '../../../hooks/usePackagePurchase';
import PlanActiveMoment, { PlanActiveBar, usePlanMoment } from '../PlanActiveMoment';

const mockFlags = { clientBillingV2: true, deliverables: true };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));
jest.mock('../../../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../../../theme/tokens').default;
  return {
    useTheme: () => ({ tokens: realTokens, semanticColors: realTokens.lightTokens, colorScheme: 'light' }),
  };
});
jest.mock('react-native-svg', () => {
  const mockReact = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const El = ({ children }: { children?: React.ReactNode }) => mockReact.createElement(View, null, children);
  return { __esModule: true, default: El, Circle: El };
});
const mockGetPurchases = jest.fn();
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getPurchases: () => mockGetPurchases() },
}));
const mockGet = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
}));
const mockSuccessHaptic = jest.fn(async () => undefined);
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: () => mockSuccessHaptic(),
    softImpact: jest.fn(async () => undefined),
    lightImpact: jest.fn(async () => undefined),
    mediumImpact: jest.fn(async () => undefined),
    selection: jest.fn(async () => undefined),
  },
}));

const NEXT = '2026-11-14T12:00:00Z';
const row = (over: Partial<ClientPurchase> = {}): ClientPurchase => ({
  id: 'pur-1',
  package_id: 'pkg-1',
  status: 'active',
  entitlement_active: true,
  access_expires_at: null,
  current_period_end: NEXT,
  cancel_at_period_end: false,
  canceled_at: null,
  created_at: '2026-10-14T12:00:00Z',
  amount_cents: 14900,
  currency: 'usd',
  billing_type: 'recurring',
  first_charge_cents: 44900,
  ...over,
});
const success = (over: Partial<PurchaseSuccess> = {}): PurchaseSuccess => ({
  kind: 'subscription',
  title: 'Your plan is active',
  body: 'Welcome to Monthly coaching. Your coach can see you are on board.',
  packageId: 'pkg-1',
  purchaseId: 'pur-1',
  ...over,
});

let reduceMotion = false;
beforeEach(() => {
  mockFlags.clientBillingV2 = true;
  mockFlags.deliverables = true;
  reduceMotion = false;
  mockGetPurchases.mockReset();
  mockGet.mockReset().mockResolvedValue({ data: { name: 'Sam' } });
  mockSuccessHaptic.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => reduceMotion);
});
afterEach(() => jest.restoreAllMocks());


function Host({ s, onContinue, onSeeUnlocks }: { s: PurchaseSuccess; onContinue: () => void; onSeeUnlocks: (id: string) => void }) {
  const moment = usePlanMoment(s);
  return (
    <View>
      <ScrollView testID="host-body">
        <PlanActiveMoment success={s} onContinue={onContinue} onSeeUnlocks={onSeeUnlocks} moment={moment} />
      </ScrollView>
      <PlanActiveBar moment={moment} onContinue={onContinue} onSeeUnlocks={onSeeUnlocks} />
    </View>
  );
}

describe('LS-914R2 B2: the success actions live in the host pinned bar', () => {
  it('receipt scrolls; See what unlocks and Done are in the bar; one purchases read', async () => {
    mockGetPurchases.mockResolvedValue({ ok: true, data: [row()] });
    const onContinue = jest.fn();
    const onSeeUnlocks = jest.fn();
    const r = await render(<Host s={success()} onContinue={onContinue} onSeeUnlocks={onSeeUnlocks} />);
    const bar = r.getByTestId('payment-success-footer');
    await waitFor(() => expect(within(bar).getByTestId('payment-see-unlocks')).toBeTruthy());
    const body = r.getByTestId('host-body');
    expect(within(body).getByTestId('payment-success-paid')).toBeTruthy();
    expect(within(body).queryByTestId('payment-see-unlocks')).toBeNull();
    expect(within(body).queryByTestId('payment-continue')).toBeNull();
    await fireEvent.press(within(bar).getByTestId('payment-see-unlocks'));
    expect(onSeeUnlocks).toHaveBeenCalledWith('pur-1');
    await fireEvent.press(within(bar).getByTestId('payment-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(mockGetPurchases).toHaveBeenCalledTimes(1);
    await r.unmount();
  });

  it('nothing to open: Done alone, still in the bar', async () => {
    mockFlags.deliverables = false;
    mockGetPurchases.mockResolvedValue({ ok: true, data: [row()] });
    const r = await render(<Host s={success()} onContinue={jest.fn()} onSeeUnlocks={jest.fn()} />);
    await waitFor(() => expect(r.getByTestId('payment-success-paid')).toBeTruthy());
    const bar = r.getByTestId('payment-success-footer');
    expect(within(bar).getByTestId('payment-continue')).toBeTruthy();
    expect(r.queryByTestId('payment-see-unlocks')).toBeNull();
    expect(within(r.getByTestId('host-body')).queryByTestId('payment-continue')).toBeNull();
  });
});
