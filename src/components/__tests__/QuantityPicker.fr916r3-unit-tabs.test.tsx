// FR-916R3 F2 (LO-916R3 B1): every unit tab shows at every phone width and text size, as in C2 C_portion.
// PORTION-WRAP-M: the tabs now sit in ONE row (no wrap, no sideways scroller) at every phone width and text size.
// Table-driven over 320 to 430 pt at 100% and 130% text, with the window mocked to each width.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import { QuantityPickerContent } from '../log/QuantityPickerModal';
import { layout } from '../../theme';
import type { SearchResult } from '../../utils/log/types';

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

const flat = (s: unknown) => (StyleSheet.flatten(s as any) ?? {}) as Record<string, any>;
const base = {
  id: 'f', calories: 379, protein: 13, carbs: 68, fat: 6.5, nutrient_basis: 'PER_100G',
  serving_size: '100 g', serving_size_grams: 100,
};
const oats = { ...base, name: 'Rolled oats', supports_volume_units: true, cup_grams: 81, tbsp_grams: 5, tsp_grams: 1.7 } as SearchResult;
const chicken = { ...base, name: 'Chicken, roasted', supports_volume_units: false } as SearchResult;

async function tabRow(food: SearchResult) {
  await render(<QuantityPickerContent selectedFood={food} quantityInput="40" selectedUnit="g"
    onQuantityChange={jest.fn()} onUnitChange={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  const tabs = screen.getAllByRole('tab');
  let node: any = tabs[0].parent;
  let sideways = false;
  let wraps = false;
  let row: any = null;
  while (node) {
    if (!row && flat(node.props?.style).columnGap !== undefined) row = node;
    if (node.props?.horizontal) { sideways = true; break; }
    if (flat(node.props?.style).flexWrap === 'wrap') { wraps = true; break; }
    node = node.parent;
  }
  return { tabs, sideways, wraps, row };
}

// Inter Medium advance widths (em) letter by letter, read from the font file for this test (portionFit keeps
// whole-word widths; the two must agree): a tab is its label plus padding, never under its minWidth.
const LETTER_EM: Record<string, number> = { g: 0.6196, o: 0.604, z: 0.5591, s: 0.5386, e: 0.5874, r: 0.3867,
  v: 0.5747, i: 0.252, n: 0.6016, c: 0.5771, u: 0.6016, p: 0.6182, b: 0.6182, t: 0.3403 };
const tabWidth = (tab: any, label: string) => {
  const st = flat(tab.props.style);
  const size = flat(within(tab).getByText(label).props.style).fontSize as number;
  const text = [...label].reduce((n, ch) => n + LETTER_EM[ch], 0) * size;
  return Math.max(st.minWidth ?? 0, text + 2 * (st.paddingHorizontal ?? 0));
};

describe.each([320, 360, 375, 390, 430])('FR-916R3 F2: at %i pt', (width) => {
  it.each([1, 1.3])('every unit tab of a volume food shows whole at %f text, all six in one row inside the sheet', async (scale) => {
    Object.assign(mockWindow, { width, fontScale: scale });
    const { tabs, sideways, wraps, row } = await tabRow(oats);
    const labels = tabs.map((t) => String(t.props.accessibilityLabel).replace('Portion unit ', ''));
    expect(labels).toEqual(['g', 'oz', 'serving', 'cup', 'tbsp', 'tsp']);
    const room = width - 2 * layout.gutter;
    expect({ sideways, wraps }).toEqual({ sideways: false, wraps: false });
    const rowStyle = flat(row?.props.style);
    const gaps = (rowStyle.columnGap ?? 0) * (tabs.length - 1);
    const bleed = -(rowStyle.marginHorizontal ?? 0); // the row may borrow up to 8 pt of each gutter, never more
    expect(bleed).toBeLessThanOrEqual(8);
    expect(tabs.reduce((n, t, i) => n + tabWidth(t, labels[i]), 0) + gaps).toBeLessThanOrEqual(room + 2 * bleed);
    for (const t of tabs) {
      const st = flat(t.props.style);
      expect(st.width ?? null).toBeNull();
      expect(st.maxWidth ?? null).toBeNull();
      expect(st.minWidth).toBeGreaterThanOrEqual(layout.touchMin); // 44 pt targets
      expect(flat(within(t).getByText(/^(g|oz|serving|cup|tbsp|tsp)$/).props.style).fontSize).toBeGreaterThanOrEqual(12);
    }
    // No label is cut short with an ellipsis.
    for (const label of screen.getAllByText(/^(g|oz|serving|cup|tbsp|tsp)$/)) {
      expect(label.props.numberOfLines ?? null).toBeNull();
    }
  });
});

it('FR-916R3 F2: a food with only mass units (g, oz, serving) shows its tabs in a row that is not sideways', async () => {
  const { tabs, sideways } = await tabRow(chicken);
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Portion unit g', 'Portion unit oz', 'Portion unit serving']);
  expect(sideways).toBe(false);
});

it('control: a per-serving food with no grams shows its one serving tab', async () => {
  const { tabs } = await tabRow({ ...base, name: 'Protein bar', nutrient_basis: 'PER_SERVING', serving_size_grams: null } as unknown as SearchResult);
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Portion unit serving']);
});
