/**
 * BILLQUOTE-M (agent 144): the app shows the server's due-today amount and
 * charge date (backend #998 `quote` on GET /v1/clients/me/coach/packages and
 * /:id), never its own sum or its own trial date. With no quote (an older
 * server during rollout) those two facts are not shown; everything else stays.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../theme/tokens').default;
  return { useTheme: () => ({ tokens, semanticColors: tokens.lightTokens, colorScheme: 'light' }) };
});
jest.mock('../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));

import {
  planTerms,
  purchasableFromCoachPackage,
  reconcileIntentTerms,
  type PurchasablePackage,
} from '../lib/planTerms';
import { PACKAGE_PAYMENT_COPY } from '../lib/packagePayment';
import PlanTermsBlock from '../components/purchase/PlanTermsBlock';

const NEXT = '2026-11-14T12:00:00.000Z';
const TRIAL_END = '2026-10-28T12:00:00.000Z';
const quote = (due: number, first: string | null, trialEnd: string | null = null) => ({
  due_today_cents: due, currency: 'usd', first_charge_at: first, trial_end: trialEnd,
});
const MONTHLY = {
  id: 'pkg-monthly', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd',
  billing_type: 'recurring', interval: 'month',
};
const ONCE = { id: 'pkg-once', name: 'Six-week block', amount_cents: 9900, currency: 'usd', billing_type: 'one_time' };
const COMBO = {
  id: 'pkg-combo', name: 'Kickoff plus monthly', amount_cents: 9900, currency: 'usd', billing_type: 'one_time',
  recurring_amount_cents: 4900, recurring_interval: 'month',
};
const TRIAL = { ...MONTHLY, id: 'pkg-trial', trial_days: 14, trial_offer: { available: true, trial_days: 14 } };

const sellable = (row: Record<string, unknown>): PurchasablePackage => {
  const p = purchasableFromCoachPackage(row);
  if (!p) throw new Error('row not sellable');
  return p;
};

describe('quote present: due today and the charge date are the server quote', () => {
  it('monthly: due today, then the next renewal in the existing "next charge" words', () => {
    const t = planTerms(sellable({ ...MONTHLY, quote: quote(4900, NEXT) }));
    expect(t.firstCharge).toBe(
      'You pay $49.00 today for your first month. Your next charge of $49.00 is on November 14, 2026.',
    );
    expect(t.firstCharge).toContain(PACKAGE_PAYMENT_COPY.nextChargeOn('$49.00', 'November 14, 2026'));
    expect(t.firstCharge).not.toMatch(/first charge of/);
    expect(t.cta).toBe('Subscribe for $49.00 a month');
  });

  it('one-time: due today, no later charge', () => {
    const t = planTerms(sellable({ ...ONCE, quote: quote(9900, null) }));
    expect(t.firstCharge).toBe('You pay $99.00 today. It does not renew.');
    expect(t.cta).toBe('Pay $99.00');
    expect(t.renewal).toBeNull();
  });

  it('one-time + recurring: due today is the quoted amount, not a sum on the phone', () => {
    const t = planTerms(sellable({ ...COMBO, quote: quote(14800, NEXT) }));
    expect(t.firstCharge).toBe(
      'You pay $148.00 today: $99.00 once plus your first month at $49.00. ' +
        'Your next charge of $49.00 is on November 14, 2026.',
    );
    expect(t.cta).toBe('Subscribe, pay $148.00 today');
    // The phone repeats the server's number; it never recomputes it.
    expect(planTerms(sellable({ ...COMBO, quote: quote(12345, NEXT) })).cta).toBe('Subscribe, pay $123.45 today');
  });

  it('trial: nothing today, first charge on the quoted trial end in the existing trial words', () => {
    const t = planTerms(sellable({ ...TRIAL, quote: quote(0, TRIAL_END, TRIAL_END) }));
    expect(t.firstCharge).toBe(
      'Free for 14 days, then your first charge of $49.00 is on October 28, 2026. ' +
        'Your card is saved today and not charged. Cancel before then and you are never charged.',
    );
    expect(t.firstCharge).not.toMatch(/next charge/i);
    expect(t.cta).toBe('Start free trial');
  });
});

describe('quote missing (older server): no due-today number and no date, nothing else changes', () => {
  it.each([
    ['monthly', MONTHLY, 'Subscribe for $49.00 a month'],
    ['one-time', ONCE, 'Pay $99.00'],
    ['one-time + recurring', COMBO, 'Subscribe for $49.00 a month'],
    ['trial', TRIAL, 'Start free trial'],
  ])('%s', (_name, row, cta) => {
    const p = sellable(row);
    expect(p.quote).toBeNull();
    const t = planTerms(p);
    expect(t.firstCharge).toBeNull();
    expect(t.cta).toBe(cta);
    expect(t.cta).not.toMatch(/today/);
    expect(`${t.price} ${t.renewal ?? ''} ${t.cta}`).not.toMatch(/\$148|2026/);
  });

  it('a malformed quote counts as none', () => {
    expect(sellable({ ...MONTHLY, quote: { due_today_cents: '49', currency: 'usd' } }).quote).toBeNull();
    expect(sellable({ ...MONTHLY, quote: { due_today_cents: 4900 } }).quote).toBeNull();
    expect(planTerms(sellable({ ...MONTHLY, quote: quote(4900, 'not a date') })).firstCharge).toBe(
      'You pay $49.00 today for your first month.',
    );
  });
});

describe('the terms block renders the quote, and renders without one', () => {
  it('quote present: the server amount and date are on screen', async () => {
    const r = await render(<PlanTermsBlock pkg={sellable({ ...COMBO, quote: quote(14800, NEXT) })} />);
    expect(r.getByTestId('plan-terms-first-charge').props.children).toMatch(/^You pay \$148\.00 today/);
    expect(r.getByText(/November 14, 2026/)).toBeTruthy();
  });

  it('quote missing: no due-today line and no date, price and renewal still shown, no crash', async () => {
    const r = await render(<PlanTermsBlock pkg={sellable(COMBO)} />);
    expect(r.queryByTestId('plan-terms-first-charge')).toBeNull();
    expect(r.getByTestId('plan-terms-price').props.children).toBe('$49.00 a month');
    expect(r.getByTestId('plan-terms-renewal')).toBeTruthy();
    expect(r.queryByText(/today|\$148/)).toBeNull();
  });
});

describe('checkout answer vs the quote shown', () => {
  const plan = {
    amountCents: 4900, currency: 'usd', interval: 'month' as const, intervalCount: 1,
    firstChargeCents: 14800, oneTimeCents: 9900, trialDays: 0, trialEndsAt: null,
  };
  const combo = sellable({ ...COMBO, quote: quote(14800, NEXT) });

  it('same terms and the same amount: the sheet may open', () => {
    expect(reconcileIntentTerms(combo, plan, 'payment')).toEqual(
      expect.objectContaining({ changed: false, inconsistent: false }),
    );
  });

  it('same terms but a different amount than the quote: refused, never opened', () => {
    expect(reconcileIntentTerms(combo, { ...plan, firstChargeCents: 15000 }, 'payment').inconsistent).toBe(true);
  });

  it('new terms: the review shows the checkout\'s own amount and leaves the old date out', () => {
    const r = reconcileIntentTerms(combo, { ...plan, oneTimeCents: 15000, firstChargeCents: 19900 }, 'payment');
    expect(r.changed).toBe(true);
    expect(planTerms(r.adopted).cta).toBe('Subscribe, pay $199.00 today');
    expect(planTerms(r.adopted).firstCharge).not.toMatch(/November/);
  });
});

describe('no file under src/ works out due today or a trial date any more', () => {
  const root = path.resolve(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__') walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(root);

  it.each([
    ['adding the one-time part to a price', /oneTimeCents\s*\+|\+\s*[\w.]*oneTimeCents|one_time_cents\s*\+|\+\s*[\w.]*one_time_cents/],
    ['adding to a renewal price', /amountCents\s*\+\s*[\w.]*(Cents|cents)/],
    ['dating a trial on the phone', /trialFirstChargeDate|firstChargeCentsOf|getDate\(\)\s*\+\s*[\w.]*[tT]rial/],
  ])('none of %s', (_what, pattern) => {
    expect(files.length).toBeGreaterThan(100);
    const hits = files.filter((f) => pattern.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });
});
