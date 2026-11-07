import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import { fitTitle, sheetRoom } from '../portionFit';
import type { SearchResult } from '../../../utils/log/types';

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => mockWindow,
}));

const WRAPPING_NAMES = [
  'Oats, old-fashioned, cooked with water',
  'Cereals ready-to-eat, whole-wheat flakes',
];
const LONG_NAME = 'Chicken thigh, roasted, skin removed, with garlic and herb butter';
const food = (name: string) => ({
  id: 'food-name-201', name, calories: 165, protein: 31, carbs: 0, fat: 3.6,
  nutrient_basis: 'PER_100G', serving_size: '100 g', serving_size_grams: 100,
}) as unknown as SearchResult;

describe.each([320, 360, 390])('PORTION-NAME-M: %i pt', (width) => {
  it.each(WRAPPING_NAMES)('C1: keeps breakable hyphens when "%s" must wrap', (name) => {
    const title = fitTitle(name, sheetRoom(width), 2, 0.6);
    expect(title.oneLine).toBe(false);
    expect(title.text).toBe(name);
    expect(title.text).not.toContain('\u2011');
  });

  it.each([1, 1.3])('C2: the drawn name is 24 pt times %f text size, including the rendered header', async (fontScale) => {
    Object.assign(mockWindow, { width, fontScale });
    const name = 'Chicken breast, grilled';
    const title = fitTitle(name, sheetRoom(width), fontScale, 0.6);
    // The requested size is reduced only when this particular line cannot fit it.
    expect(title.fontSize).toBeLessThanOrEqual(24 * fontScale);
    if (fontScale === 1 || width === 390) expect(title.fontSize).toBe(24 * fontScale);
    await render(<QuantityPickerContent selectedFood={food(name)} quantityInput="150" selectedUnit="g"
      onQuantityChange={jest.fn()} onUnitChange={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    const header = screen.getByRole('header');
    expect(StyleSheet.flatten(header.props.style)).toMatchObject({
      fontSize: title.fontSize, lineHeight: title.lineHeight,
    });
    expect(header.props.accessibilityLabel).toBe(name);
    expect(header.props.allowFontScaling).toBe(false);
    expect(header.props.numberOfLines).toBeUndefined();
  });

  it.each([1, 1.3])('C2: long names wrap at their own 24 pt times %f text size without truncation', (fontScale) => {
    const title = fitTitle(LONG_NAME, sheetRoom(width), fontScale, 0.6);
    expect(title).toMatchObject({ oneLine: false, fontSize: 24 * fontScale, text: LONG_NAME });
  });

  it('C1: a one-line name still keeps its hyphenated word together', () => {
    expect(fitTitle('Rolled oats, old-fashioned', sheetRoom(width), 1, 0.6))
      .toMatchObject({ oneLine: true, text: 'Rolled oats, old\u2011fashioned' });
  });
});

it.each([0, -1])('C2: invalid text scale %f falls back to the 24 pt drawing', (fontScale) => {
  expect(fitTitle('Egg', sheetRoom(320), fontScale).fontSize).toBe(24);
});
