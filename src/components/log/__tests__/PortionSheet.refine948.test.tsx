import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import SheetGrip from '../SheetGrip';
import { colors, gold, lightTokens } from '../../../theme/tokens';
import { fitUnitTabs, sheetRoom } from '../portionFit';
import type { SearchResult } from '../../../utils/log/types';

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => mockWindow,
}));

const food = {
  name: 'Chicken breast, grilled', calories: 165, protein: 31, carbs: 0, fat: 3.6,
  nutrient_basis: 'PER_100G', serving_size: '100 g', serving_size_grams: 100,
  supports_volume_units: true, cup_grams: 81, tbsp_grams: 5, tsp_grams: 1.7,
} as SearchResult;
const props = {
  selectedFood: food, quantityInput: '150', selectedUnit: 'g', mealLabel: 'Lunch',
  dayLeft: { kcal: 640, protein: 63 }, onAddAnother: jest.fn(),
  onQuantityChange: jest.fn(), onUnitChange: jest.fn(), onConfirm: jest.fn(), onCancel: jest.fn(),
};
const flat = (node: { props: { style?: unknown } }): Record<string, any> => StyleSheet.flatten(node.props.style as any) ?? {};

describe.each([320, 390])('FIX-948R1 drawing values at %i pt', (width) => {
  it.each([1, 1.3])('keeps 1–4 digit widths and the drawn amount face at %f text', async (fontScale) => {
    Object.assign(mockWindow, { width, fontScale });
    const view = await render(<QuantityPickerContent {...props} />);
    for (const digits of ['1', '12', '150', '1500']) {
      await view.rerender(<QuantityPickerContent {...props} quantityInput={digits} />);
      const input = screen.getByLabelText('Food quantity');
      expect(flat(input)).toMatchObject({
        fontFamily: 'CormorantGaramond_500Medium', fontSize: 48, lineHeight: 60,
        fontVariant: ['oldstyle-nums', 'tabular-nums'],
        width: Math.ceil(digits.length * 28 * fontScale) + 12,
      });
      expect(input.props.value).toBe(digits);
      expect(input.props.maxFontSizeMultiplier).toBe(1.3);
    }
  });

  it.each([1, 1.3])('uses the drawn metadata, tabs and gaps at %f text without changing fit', async (fontScale) => {
    Object.assign(mockWindow, { width, fontScale });
    await render(<QuantityPickerContent {...props} />);
    expect(flat(screen.getByLabelText('Food quantity').parent!)).toMatchObject({ marginTop: 10 });
    const unit = screen.getAllByText('g', { includeHiddenElements: true }).find((node) => node.props.accessibilityElementsHidden);
    expect(unit).toBeDefined();
    expect(flat(unit!)).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 16, color: lightTokens.textMuted });
    expect(flat(screen.getByTestId('portion-summary'))).toMatchObject({
      fontSize: 14, lineHeight: 20.02, color: lightTokens.textMuted, marginTop: 4, marginBottom: 4,
    });
    expect(flat(screen.getByTestId('portion-after-plate'))).toMatchObject({
      fontSize: 14, lineHeight: 20.02, color: lightTokens.textPrimary, marginTop: 0, marginBottom: 10,
    });
    expect(flat(screen.getByText('1 serving = 100 g'))).toMatchObject({
      fontSize: 14, lineHeight: 20.02, color: lightTokens.textMuted, marginTop: 4,
    });
    expect(flat(screen.getByTestId('quantity-log-food'))).toMatchObject({ marginTop: 10, marginBottom: 0 });
    expect(flat(screen.getByText('For Lunch'))).toMatchObject({
      fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.98,
      textTransform: 'uppercase', color: lightTokens.textMuted, marginTop: 0,
    });
    const units = ['g', 'oz', 'serving', 'cup', 'tbsp', 'tsp'];
    const fit = fitUnitTabs(units, sheetRoom(width), fontScale);
    const row = screen.getAllByRole('tab')[0].parent!.parent!.parent!;
    expect(flat(row)).toMatchObject({ marginTop: 6, borderBottomWidth: 1 });
    screen.getAllByRole('tab').forEach((tab, index) => {
      expect(flat(tab)).toMatchObject({ minHeight: 44, minWidth: fit.minWidth, paddingHorizontal: fit.padding });
      expect(flat(within(tab).getByText(units[index]))).toMatchObject({
        fontSize: Math.min(15 * fontScale, fit.fontSize), fontFamily: 'Inter_500Medium',
        color: index === 0 ? lightTokens.textPrimary : lightTokens.textMuted,
      });
    });
    expect(flat(screen.getAllByRole('tab')[0])).toMatchObject({ borderBottomWidth: 2, borderBottomColor: gold[300] });
  });
});

it('does not double the final 10 pt gap when the after-plate line is last', async () => {
  await render(<QuantityPickerContent {...props} selectedFood={{ ...food, serving_size: undefined }} />);
  expect(flat(screen.getByTestId('portion-after-plate')).marginBottom).toBe(10);
  expect(flat(screen.getByTestId('quantity-log-food')).marginTop).toBe(0);
});

it('uses a local 36 by 5 grip, with 14 pt before the overline, without changing other food sheets', async () => {
  await render(<QuantityPickerContent {...props} />);
  const grip = screen.getByTestId('sheet-grip', { includeHiddenElements: true });
  expect(flat(grip)).toMatchObject({ width: 36, height: 5, backgroundColor: lightTokens.border });
  expect(flat(grip.parent!)).toMatchObject({ paddingTop: 10, paddingBottom: 14 });
  expect(grip.parent!.props.accessibilityElementsHidden).toBe(true);
  const shared = await render(<SheetGrip />);
  expect(flat(shared.getByTestId('sheet-grip', { includeHiddenElements: true }))).toMatchObject({ width: 40, height: 5 });
});

it.each([272, 342])('draws 58 pt charcoal ticks, 18/82 percent fade stops and a centered 2.5 pt forest needle at %i pt', async (width) => {
  await render(<QuantityPickerContent {...props} />);
  const ruler = screen.getByTestId('portion-ruler');
  await fireEvent(ruler, 'layout', { nativeEvent: { layout: { width, height: 58, x: 0, y: 0 } } });
  expect(flat(ruler)).toMatchObject({ height: 58, marginTop: 8, marginBottom: 6 });
  expect(flat(screen.getByTestId('portion-ruler-needle'))).toMatchObject({
    width: 2.5, height: 58, left: width / 2 - 1.25, backgroundColor: colors.forest,
  });
  const ticks = ruler.findAll((node) => node.type === 'View' && flat(node).width === 1);
  expect(ticks.length).toBeGreaterThan(10);
  ticks.forEach((tick) => {
    const style = flat(tick);
    expect(style).toMatchObject({ height: 58, top: 0, width: 1, backgroundColor: colors.charcoal });
    const expected = 0.55 * Math.max(0, Math.min(1, style.left / (width * 0.18), (width - style.left) / (width * 0.18)));
    expect(style.opacity).toBeCloseTo(expected);
  });
  expect(ticks.some((tick) => flat(tick).opacity === 0.55)).toBe(true);
  const positions = ticks.map((tick) => flat(tick).left).sort((a, b) => a - b);
  expect(positions[1] - positions[0]).toBe(12);
});
