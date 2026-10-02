/**
 * Log screen summary bar in the lighter first week (clinic contract v1
 * addition 8): calories and protein only in 'simple'; unchanged in 'full'.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import DailySummaryBar from '../DailySummaryBar';

const TOTALS = { calories: 900, protein: 72, carbs: 110, fat: 31 };

describe('DailySummaryBar', () => {
  it('defaults to the full bar (no behaviour change without the backend field)', async () => {
    await render(<DailySummaryBar dailyTotals={TOTALS} remaining={889} />);
    expect(screen.getByTestId('daily-summary-full')).toBeTruthy();
    for (const label of ['Eaten', 'Remaining', 'Protein', 'Carbs', 'Fat']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('shows calories and protein only in the simple view', async () => {
    await render(<DailySummaryBar dailyTotals={TOTALS} remaining={889} mode="simple" />);
    expect(screen.getByTestId('daily-summary-simple')).toBeTruthy();
    expect(screen.getByText('Eaten')).toBeTruthy();
    expect(screen.getByText('Remaining')).toBeTruthy();
    expect(screen.getByText('72g')).toBeTruthy();
    expect(screen.queryByText('Carbs')).toBeNull();
    expect(screen.queryByText('Fat')).toBeNull();
    expect(screen.queryByText('110g')).toBeNull();
  });
});
