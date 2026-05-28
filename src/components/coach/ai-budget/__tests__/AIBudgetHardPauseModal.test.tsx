/**
 * AIBudgetHardPauseModal — 100% threshold render test.
 *
 * Unlike the 80% tutorial this modal IS dismissible. Verifies:
 *   - Renders "AI paused" + pack options.
 *   - Close button calls onClose.
 *   - Selecting a pack calls onSelectPack with the correct cents value.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

import { AIBudgetHardPauseModal } from '../AIBudgetHardPauseModal';
import type { CoachAIBudgetResponse } from '../../../../api/types/coachAIBudget';

const paused: CoachAIBudgetResponse = {
  period_start: '2026-05-01T00:00:00Z',
  period_end: '2026-06-01T00:00:00Z',
  base_displayed_cents: 12500,
  pack_displayed_cents: 0,
  total_displayed_cents: 12500,
  used_displayed_cents: 12500,
  remaining_displayed_cents: 0,
  pct_used: 100,
  base_actual_cents: 4000,
  value_multiplier: '3.125',
  actual_used_cents: 4000,
  pack_options_cents: [1000, 2500, 9900],
  custom_pack_bounds_cents: { min: 1000, max: 50000 },
};

describe('AIBudgetHardPauseModal', () => {
  it('renders "AI paused" + pack options', () => {
    const onClose = jest.fn();
    const onSelectPack = jest.fn();
    const { getByText, getByTestId } = render(
      <AIBudgetHardPauseModal
        visible
        budget={paused}
        onClose={onClose}
        onSelectPack={onSelectPack}
      />,
    );
    expect(getByText('AI paused')).toBeTruthy();
    expect(getByTestId('ai-pack-option-1000')).toBeTruthy();
    expect(getByTestId('ai-pack-option-2500')).toBeTruthy();
    expect(getByTestId('ai-pack-option-9900')).toBeTruthy();
  });

  it('close button fires onClose', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <AIBudgetHardPauseModal
        visible
        budget={paused}
        onClose={onClose}
        onSelectPack={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('ai-hard-pause-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selecting a pack option fires onSelectPack with the correct cents', () => {
    const onSelectPack = jest.fn();
    const { getByTestId } = render(
      <AIBudgetHardPauseModal
        visible
        budget={paused}
        onClose={jest.fn()}
        onSelectPack={onSelectPack}
      />,
    );
    fireEvent.press(getByTestId('ai-pack-option-9900'));
    expect(onSelectPack).toHaveBeenCalledWith(9900);
  });
});
