// PORTION-WRAP-M (agent 198, C2 C_portion): the shared portion sheet's food name sits on one line and its unit tabs
// in one row on small phones and at large text; no word is cut at a hyphen, nothing is ellipsized, every tab shows.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import { fitTitle, fitUnitTabs, sheetRoom } from '../portionFit';
import { layout } from '../../../theme';
import type { SearchResult } from '../../../utils/log/types';

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

const flat = (s: unknown) => (StyleSheet.flatten(s as any) ?? {}) as Record<string, any>;
const base = { id: 'f', calories: 165, protein: 31, carbs: 0, fat: 3.6, nutrient_basis: 'PER_100G', serving_size: '100 g', serving_size_grams: 100 };
const food = (name: string, volume = false) =>
  ({ ...base, name, supports_volume_units: volume, cup_grams: 81, tbsp_grams: 5, tsp_grams: 1.7 }) as unknown as SearchResult;
// Each name's width in em, summed from Cormorant Garamond Regular's advance widths (the title face).
const EM = { 'Chicken breast, grilled': 8.87, 'Rolled oats, old-fashioned': 10.174 };
const LETTER_SPACING = 0.6; // typography.h1

async function header(name: string, width: number, fontScale: number, volume = false) {
  Object.assign(mockWindow, { width, fontScale });
  await render(<QuantityPickerContent selectedFood={food(name, volume)} quantityInput="150" selectedUnit="g"
    onQuantityChange={jest.fn()} onUnitChange={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} mealLabel="Lunch" />);
  return screen.getByRole('header');
}

const NAMES = Object.keys(EM) as (keyof typeof EM)[];
describe.each([320, 360, 375, 390, 430])('PORTION-WRAP-M: at %i pt', (width) => {
  it.each(NAMES.flatMap((n) => [[n, 1], [n, 1.3]] as const))('"%s" fits one line at %f text, never under 24 pt', async (name, scale) => {
    const st = flat((await header(name, width, scale)).props.style);
    expect(st.fontSize).toBeGreaterThanOrEqual(24);
    expect(st.fontSize).toBeLessThanOrEqual(30 * scale);
    expect(EM[name] * st.fontSize + LETTER_SPACING * name.length).toBeLessThanOrEqual(width - 2 * layout.gutter);
    expect(st.lineHeight).toBeGreaterThanOrEqual(1.2 * st.fontSize);
  });
});

it.each([[1, 30], [1.3, 39]])('PORTION-WRAP-M: a name that fits keeps its own size at %f text (%i pt), as before', async (scale, size) => {
  expect(flat((await header('Chicken breast', 430, scale)).props.style).fontSize).toBe(size);
});

it('PORTION-WRAP-M: a hyphenated word never splits at its hyphen; the screen reader hears the plain name', async () => {
  const h = await header('Rolled oats, old-fashioned', 320, 1.3, true);
  expect(h.props.children).toBe('Rolled oats, old\u2011fashioned');
  expect(h.props.accessibilityLabel).toBe('Rolled oats, old-fashioned');
  expect(h.props.allowFontScaling).toBe(false); // its size already carries the text size
});

it('PORTION-WRAP-M: a name too long for one line at 24 pt wraps between words at its own size, never ellipsized', async () => {
  const name = 'Chicken thigh, roasted, skin removed, with garlic and herb butter';
  const h = await header(name, 320, 1.3);
  expect(flat(h.props.style).fontSize).toBe(39);
  expect(h.props.numberOfLines ?? null).toBeNull();
  expect(fitTitle(name, sheetRoom(320), 1.3).oneLine).toBe(false);
});

describe('PORTION-WRAP-M: fitUnitTabs', () => {
  const MASS = ['g', 'oz', 'serving'];
  const ALL = ['g', 'oz', 'serving', 'cup', 'tbsp', 'tsp'];
  it.each([320, 360, 390, 430])('the drawn food (g, oz, serving) keeps the drawn tabs at %i pt and 130%%', (width) => {
    expect(fitUnitTabs(MASS, sheetRoom(width), 1.3)).toEqual({ fontSize: 16 * 1.3, padding: 12, minWidth: 64, gap: 8, spread: false, wrap: false });
  });
  it.each([[360, 1], [390, 1.3], [430, 1.3]])('six tabs keep the full text size where the row has room (%i pt, %f)', (width, scale) => {
    const t = fitUnitTabs(ALL, sheetRoom(width), scale);
    expect(t).toMatchObject({ fontSize: 16 * scale, minWidth: layout.touchMin, wrap: false, spread: true });
  });
  it('six tabs at 320 pt step their labels down to fit one row, not under 12 pt, still 44 pt targets', () => {
    for (const scale of [1, 1.3]) {
      const t = fitUnitTabs(ALL, sheetRoom(320), scale);
      expect(t.wrap).toBe(false);
      expect(t.fontSize).toBeGreaterThanOrEqual(12);
      expect(t.fontSize).toBeLessThan(16);
      expect(t.minWidth).toBe(layout.touchMin);
    }
  });
  it('a window narrower than any phone wraps the row instead, so every tab still shows', () => {
    expect(fitUnitTabs(ALL, sheetRoom(240), 1)).toMatchObject({ wrap: true, fontSize: 16 });
  });
});
