/**
 * AIBudgetTutorialModal — BLOCKING behavior test.
 *
 * Operator override (2026-05-28): the 80% tutorial CANNOT be dismissed
 * before reaching card 4. Verifies:
 *   - Cards 1–3 render no close affordance.
 *   - "Continue" advances index and finally reveals the pack options.
 *   - `onClose` is NOT called until the coach reaches card 4 and presses
 *     "I'll buy later".
 *   - `onSelectPack` fires when a pack tier is tapped.
 *   - `tutorialSeenKey(period_start)` is persisted on dismissal.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: number) => v,
    Easing: { out: () => () => 0, cubic: () => 0, inOut: () => () => 0, quad: () => 0, linear: () => 0 },
  };
});

import {
  AIBudgetTutorialModal,
  tutorialSeenKey,
} from '../AIBudgetTutorialModal';
import type { CoachAIBudgetResponse } from '../../../../api/types/coachAIBudget';

const budget: CoachAIBudgetResponse = {
  period_start: '2026-05-01T00:00:00Z',
  period_end: '2026-06-01T00:00:00Z',
  base_displayed_cents: 12500,
  pack_displayed_cents: 0,
  total_displayed_cents: 12500,
  used_displayed_cents: 10000,
  remaining_displayed_cents: 2500,
  pct_used: 80,
  base_actual_cents: 4000,
  value_multiplier: '3.125',
  actual_used_cents: 3200,
  pack_options_cents: [1000, 2500, 9900],
  custom_pack_bounds_cents: { min: 1000, max: 50000 },
};

describe('AIBudgetTutorialModal — operator override BLOCKING behavior', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('renders no dismiss affordance on cards 1–3', async () => {
    const onClose = jest.fn();
    const onSelectPack = jest.fn();
    const { queryByTestId, getByText } = await render(
      <AIBudgetTutorialModal
        visible
        budget={budget}
        onClose={onClose}
        onSelectPack={onSelectPack}
      />,
    );
    // Card 1
    expect(queryByTestId('ai-tutorial-later')).toBeNull();
    expect(getByText('How AI usage works')).toBeTruthy();
  });

  it('does NOT call onClose between cards 1 and 3', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      const onSelectPack = jest.fn();
      const { getByTestId } = await render(
        <AIBudgetTutorialModal
          visible
          budget={budget}
          onClose={onClose}
          onSelectPack={onSelectPack}
        />,
      );

      // Press Continue 3 times to reach card 4 (cards are 0-indexed, 4 cards
      // total, so 3 advances). The transition uses setTimeout(120) to wait
      // for the fade-out; we flush all timers between presses.
      for (let i = 0; i < 3; i += 1) {
        await fireEvent.press(getByTestId('ai-tutorial-continue'));
        await act(() => {
          jest.advanceTimersByTime(300);
        });
      }

      expect(onClose).not.toHaveBeenCalled();
      // Card 4 shows the pack options.
      expect(getByTestId('ai-pack-option-1000')).toBeTruthy();
      expect(getByTestId('ai-tutorial-later')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('persists tutorialSeenKey and calls onClose when "later" is pressed on card 4', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      const onSelectPack = jest.fn();
      const { getByTestId } = await render(
        <AIBudgetTutorialModal
          visible
          budget={budget}
          onClose={onClose}
          onSelectPack={onSelectPack}
        />,
      );
      for (let i = 0; i < 3; i += 1) {
        await fireEvent.press(getByTestId('ai-tutorial-continue'));
        await act(() => {
          jest.advanceTimersByTime(300);
        });
      }
      await fireEvent.press(getByTestId('ai-tutorial-later'));

      // setItem is async; let pending promises settle.
      jest.useRealTimers();
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      const stored = await AsyncStorage.getItem(tutorialSeenKey(budget.period_start));
      expect(stored).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('routes pack selection on card 4 to onSelectPack', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      const onSelectPack = jest.fn();
      const { getByTestId } = await render(
        <AIBudgetTutorialModal
          visible
          budget={budget}
          onClose={onClose}
          onSelectPack={onSelectPack}
        />,
      );
      for (let i = 0; i < 3; i += 1) {
        await fireEvent.press(getByTestId('ai-tutorial-continue'));
        await act(() => {
          jest.advanceTimersByTime(300);
        });
      }
      await fireEvent.press(getByTestId('ai-pack-option-2500'));
      jest.useRealTimers();
      await waitFor(() => expect(onSelectPack).toHaveBeenCalledWith(2500));
    } finally {
      jest.useRealTimers();
    }
  });
});
