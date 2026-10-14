/**
 * CREDITBUILD-143: under coach Roman's used-up line (CREDITSTYLE group 10,
 * S3): Roman's usual-pace line, "Buy {amount} of credits" and "Other
 * amounts", for head coaches on builds that sell packs; nothing otherwise (F6).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CoachAIBudgetResponse } from '../../../../api/types/coachAIBudget';
import type { CoachCredits } from '../useCoachCredits';

let mockCredits: CoachCredits | null = null;
const mockNavigate = jest.fn();
jest.mock('../useCoachCredits', () => ({ useCoachCredits: () => mockCredits }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

import CreditPoolEmptyLinks from '../CreditPoolEmptyLinks';

const usedUp = (packsSold: boolean): CoachCredits => ({
  packsSold,
  budget: {
    period_start: '2026-10-01T00:00:00.000Z',
    period_end: '2026-11-01T00:00:00.000Z',
    used_displayed_cents: 12500,
    total_displayed_cents: 12500,
    remaining_displayed_cents: 0,
    pct_used: 100,
    pack_options_cents: [1000, 2500, 9900],
  } as CoachAIBudgetResponse,
});
const OCT27 = new Date('2026-10-27T12:00:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockCredits = usedUp(true);
});

describe('Roman used-up buy links', () => {
  it('shows the approved pace line and opens checkout with the suggested pack', async () => {
    await render(<CreditPoolEmptyLinks now={OCT27} />);
    expect(screen.getByText('At your usual pace, a $25 pack should cover you until Nov 1.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Buy $25 of credits'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CreditPackCheckout', { preselect: 2500 });
    await fireEvent.press(screen.getByLabelText('Other amounts'));
    expect(mockNavigate).toHaveBeenLastCalledWith('CreditPackCheckout', undefined);
  });

  it('offers the largest pack without a pace line when no pack is enough', async () => {
    await render(<CreditPoolEmptyLinks now={new Date('2026-10-02T00:00:00.000Z')} />);
    expect(screen.queryByText(/At your usual pace/)).toBeNull();
    expect(screen.getByLabelText('Buy $99 of credits')).toBeTruthy();
  });

  it('adds nothing on builds that sell no packs, or without a pool (sub-coaches)', async () => {
    mockCredits = usedUp(false);
    const view = await render(<CreditPoolEmptyLinks now={OCT27} />);
    expect(screen.queryByTestId('roman-pool-empty-buy')).toBeNull();
    mockCredits = null;
    await view.rerender(<CreditPoolEmptyLinks now={OCT27} />);
    expect(screen.queryByTestId('roman-pool-empty-buy')).toBeNull();
  });
});
