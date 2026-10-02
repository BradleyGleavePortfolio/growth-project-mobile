/**
 * Per-entry macro line in a Log meal section during the lighter first week
 * (clinic contract v1 addition 8).
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import MealSectionCard from '../MealSectionCard';
import type { FoodLog } from '../../../types';

const LOG = {
  id: 'l1',
  userId: 'u1',
  coachId: 'c1',
  date: '2026-10-01',
  mealType: 'breakfast',
  foodName: 'Oats',
  calories: 300,
  protein: 12,
  carbs: 54,
  fat: 6,
  quantity: 1,
  unit: 'serving',
  createdAt: '2026-10-01T08:00:00Z',
} as FoodLog;

const props = {
  label: 'Breakfast',
  icon: 'sunny-outline',
  mealType: 'breakfast' as const,
  logs: [LOG],
  mealCalories: 300,
  onAddPress: jest.fn(),
  onDeletePress: jest.fn(),
};

describe('MealSectionCard macro line', () => {
  it('shows protein, carbs and fat by default', async () => {
    await render(<MealSectionCard {...props} />);
    expect(screen.getByText('P: 12g · C: 54g · F: 6g')).toBeTruthy();
  });

  it('shows protein only in the simple view', async () => {
    await render(<MealSectionCard {...props} macroMode="simple" />);
    expect(screen.getByText('P: 12g')).toBeTruthy();
    expect(screen.queryByText(/C: 54g/)).toBeNull();
  });
});
