import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../log/QuantityPickerModal';
import type { SearchResult } from '../../utils/log/types';

it.each([
  ['member photo portion', 'Chicken, roasted', 'Log food'],
  ['member tile portion', 'Pineapple (juice)', 'Log food'],
  ['coach photo portion', 'Chicken, roasted', 'Use this food'],
  ['coach tile portion', 'Chicken (nuggets)', 'Use this food'],
])('LS-916R2 B3: %s has the picked Style C adjustable portion ruler', async (_state, name, confirmLabel) => {
  const food = {
    id: 'food', name, calories: 165, protein: 31, carbs: 0, fat: 3.6,
    nutrient_basis: 'PER_100G', serving_size_grams: 100,
  } as SearchResult;
  await render(<QuantityPickerContent selectedFood={food} quantityInput="150" selectedUnit="g"
    onQuantityChange={jest.fn()} onUnitChange={jest.fn()} onConfirm={jest.fn()}
    onCancel={jest.fn()} confirmLabel={confirmLabel} />);
  // C2 index.md section 5 and C_portion: a gram ruler, adjustable for screen readers.
  // This is absent functionality/layout, not unapproved wording or a tan-background comparison.
  expect(screen.getByRole('adjustable')).toBeTruthy();
});
