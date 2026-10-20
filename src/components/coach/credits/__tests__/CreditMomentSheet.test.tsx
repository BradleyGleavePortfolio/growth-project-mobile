/**
 * CREDITBUILD-143: the 80 % and 100 % sheets in the CREDIT-S hybrid (S3 card
 * and Roman pace line, S2's three pack tiles under Roman, the suggested pack
 * chosen, "New balance", the non-refundable line, one "Buy {amount} of
 * credits"), and the "Got it" sheet on builds that sell no packs.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CoachAIBudgetResponse } from '../../../../api/types/coachAIBudget';

jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

import CreditMomentSheet from '../CreditMomentSheet';

const budget = (used: number) =>
  ({
    period_start: '2026-10-01T00:00:00.000Z',
    period_end: '2026-11-01T00:00:00.000Z',
    used_displayed_cents: used,
    total_displayed_cents: 12500,
    remaining_displayed_cents: 12500 - used,
    base_displayed_cents: 12500,
    pct_used: Math.round((used / 12500) * 100),
    pack_options_cents: [1000, 2500, 9900],
  }) as CoachAIBudgetResponse;
const OCT22 = new Date('2026-10-22T12:00:00.000Z');

async function show(moment: 'low' | 'usedUp', used: number, packsSold: boolean, now = OCT22) {
  const props = { onBuy: jest.fn(), onOtherAmounts: jest.fn(), onClose: jest.fn() };
  const view = await render(<CreditMomentSheet moment={moment} credits={{ budget: budget(used), packsSold }} now={now} {...props} />);
  return { ...props, view };
}

describe('AI credit moments', () => {
  it('shows the low sheet with the suggested $25 pack chosen', async () => {
    const { onBuy, onOtherAmounts, onClose } = await show('low', 10000, true);
    await screen.findByText('Your AI credits are low.');
    expect(screen.getByText('$100 / $125')).toBeTruthy();
    expect(screen.getByText('Renews Nov 1.')).toBeTruthy();
    expect(screen.getByText('If they run out before then, Roman and AI features pause for you and your clients.')).toBeTruthy();
    expect(
      screen.getByText('At your pace this month, your credits will last until about Oct 27. A $25 pack should cover you until Nov 1.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('$25 pack').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('$99 pack').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByText('New balance')).toBeTruthy();
    expect(screen.getByText('$50')).toBeTruthy();
    expect(screen.getByText('Credit packs are non-refundable.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('$99 pack'));
    expect(screen.getByText('$124')).toBeTruthy();
    await fireEvent.press(screen.getByText('Buy $99 of credits'));
    expect(onBuy).toHaveBeenCalledWith(9900);
    await fireEvent.press(screen.getByText('Other amounts'));
    expect(onOtherAmounts).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('Not now'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the used-up sheet with Roman\'s usual-pace line', async () => {
    await show('usedUp', 12500, true, new Date('2026-10-27T12:00:00.000Z'));
    await screen.findByText('Your AI credits are used up.');
    expect(screen.getByText('Roman and AI features are paused for you and your clients. Everything else keeps working.')).toBeTruthy();
    expect(screen.getByText('At your usual pace, a $25 pack should cover you until Nov 1.')).toBeTruthy();
    expect(screen.getByText('Buy $25 of credits')).toBeTruthy();
    expect(screen.getByTestId('credit-moment-balance')).toHaveTextContent('New balance$25');
  });

  it('offers only "Got it" on builds that sell no packs', async () => {
    const { onClose, onBuy } = await show('low', 10000, false);
    await screen.findByText('At your pace this month, your credits will last until about Oct 27.');
    expect(screen.queryByTestId('credit-pack-tiles')).toBeNull();
    expect(screen.queryByText('New balance')).toBeNull();
    expect(screen.queryByText(/Buy /)).toBeNull();
    expect(screen.queryByText('Other amounts')).toBeNull();
    await fireEvent.press(screen.getByText('Got it'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBuy).not.toHaveBeenCalled();
  });

  it('leaves Roman out of the used-up sheet when no pack sells', async () => {
    await show('usedUp', 12500, false);
    await screen.findByText('Your AI credits are used up.');
    expect(screen.queryByText(/At your/)).toBeNull();
    expect(screen.getByText('Got it')).toBeTruthy();
  });
});
