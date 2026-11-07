import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import type { SearchResult } from '../../../utils/log/types';

// LO-948R2 B1. C_portion's `.c-amt` sets `font: 500 3rem/1.1 'Cormorant'` after `.num`, so its computed
// font-variant-numeric and font-feature-settings are `normal` (the same reset the FIX-948R1 css-audit.json records
// for `.meta`): Cormorant's own old-style PROPORTIONAL figures. Tabular figures give the narrow old-style "1" a full
// figure advance, so 150 reads "1 50" and 1500 "1 500" (renders ctx#494 @ 8548d7ce, comparison-short-ios390-100.png:
// the 1-to-5 gap is 11.5 pt built against 5.5 pt drawn).
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => mockWindow,
}));

const food = {
  name: 'Chicken breast, grilled', calories: 165, protein: 31, carbs: 0, fat: 3.6,
  nutrient_basis: 'PER_100G', serving_size: '100 g', serving_size_grams: 100,
} as SearchResult;

it.each(['150', '1500'])('LO-948R2 B1: the amount %s keeps the drawn proportional old-style figures', async (digits) => {
  await render(<QuantityPickerContent selectedFood={food} quantityInput={digits} selectedUnit="g"
    onQuantityChange={jest.fn()} onUnitChange={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  const fontVariant = (StyleSheet.flatten(screen.getByLabelText('Food quantity').props.style) ?? {}).fontVariant ?? [];
  expect(fontVariant).toContain('oldstyle-nums');
  expect(fontVariant).not.toContain('tabular-nums');
});
