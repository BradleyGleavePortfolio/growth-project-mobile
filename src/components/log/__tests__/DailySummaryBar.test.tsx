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
    for (const label of ['Calories left', '900 eaten', 'Protein', 'Carbs', 'Fat']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('shows calories and protein only in the simple view', async () => {
    await render(<DailySummaryBar dailyTotals={TOTALS} remaining={889} mode="simple" />);
    expect(screen.getByTestId('daily-summary-simple')).toBeTruthy();
    expect(screen.getByText('900 eaten')).toBeTruthy();
    expect(screen.getByText('Calories left')).toBeTruthy();
    expect(screen.getByText('72g')).toBeTruthy();
    expect(screen.queryByText('Carbs')).toBeNull();
    expect(screen.queryByText('Fat')).toBeNull();
    expect(screen.queryByText('110g')).toBeNull();
  });

  it('does not invent a calorie target when no target is available', async () => {
    await render(<DailySummaryBar dailyTotals={TOTALS} remaining={null} />);
    expect(screen.getByText('Calories eaten · No target')).toBeTruthy();
    expect(screen.getByText('900')).toBeTruthy();
    expect(screen.queryByText('Calories left')).toBeNull();
  });

  it('shows the overage and each available macro target', async () => {
    await render(<DailySummaryBar dailyTotals={{ ...TOTALS, protein: 112 }} remaining={-100} targets={{ calories: 800, protein: 100, carbs: 120, fat: 40 }} />);
    expect(screen.getByText('Calories over target')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    for (const label of ['of 800 · 900 eaten', '112g / 100g goal · 12 g over', '110g / 120g goal', '31g / 40g goal']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
