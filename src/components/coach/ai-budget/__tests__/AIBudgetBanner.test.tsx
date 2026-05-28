/**
 * AIBudgetBanner — 95% threshold render test.
 *
 * The banner renders the structured copy "Last 5% of AI allowance remaining"
 * (spec §4 line) and a primary "Buy credits" CTA whose press fires the
 * `onBuyCredits` callback exactly once.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

import { AIBudgetBanner } from '../AIBudgetBanner';
import type { CoachAIBudgetResponse } from '../../../../api/types/coachAIBudget';

const budget95: CoachAIBudgetResponse = {
  period_start: '2026-05-01T00:00:00Z',
  period_end: '2026-06-01T00:00:00Z',
  base_displayed_cents: 12500,
  pack_displayed_cents: 0,
  total_displayed_cents: 12500,
  used_displayed_cents: 11875,
  remaining_displayed_cents: 625,
  pct_used: 95,
  base_actual_cents: 4000,
  value_multiplier: '3.125',
  actual_used_cents: 3800,
  pack_options_cents: [1000, 2500, 9900],
  custom_pack_bounds_cents: { min: 1000, max: 50000 },
};

describe('AIBudgetBanner', () => {
  it('renders the spec copy and CTA', () => {
    const onBuyCredits = jest.fn();
    const { getByText, getByTestId } = render(
      <AIBudgetBanner budget={budget95} onBuyCredits={onBuyCredits} />,
    );
    expect(getByText(/Last 5% of AI allowance remaining/i)).toBeTruthy();
    expect(getByTestId('ai-budget-banner-cta')).toBeTruthy();
  });

  it('fires onBuyCredits exactly once per CTA press', () => {
    const onBuyCredits = jest.fn();
    const { getByTestId } = render(
      <AIBudgetBanner budget={budget95} onBuyCredits={onBuyCredits} />,
    );
    fireEvent.press(getByTestId('ai-budget-banner-cta'));
    expect(onBuyCredits).toHaveBeenCalledTimes(1);
  });
});
