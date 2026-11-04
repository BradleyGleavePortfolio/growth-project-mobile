// FR-916R3 F2 (LO-916R3 B1): every unit tab shows at every phone width and text size, as on main
// (the tabs wrap) and in C2 C_portion. Table-driven over 320 to 430 pt at 100% and 130% text.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../log/QuantityPickerModal';
import { layout } from '../../theme';
import type { SearchResult } from '../../utils/log/types';

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
  while (node) {
    if (node.props?.horizontal) { sideways = true; break; }
    if (flat(node.props?.style).flexWrap === 'wrap') { wraps = true; break; }
    node = node.parent;
  }
  return { tabs, sideways, wraps };
}

// A tab's width: its label (about 0.6 em a letter at 16 pt, scaled by the text size) plus padding, never under minWidth.
const tabWidth = (tab: any, label: string, scale: number) => {
  const st = flat(tab.props.style);
  return Math.max(st.minWidth ?? 0, Math.ceil(label.length * 16 * 0.6 * scale) + 2 * (st.paddingHorizontal ?? 0));
};

describe.each([320, 360, 375, 390, 430])('FR-916R3 F2: at %i pt', (width) => {
  it.each([1, 1.3])('every unit tab of a volume food shows whole at %f text (the row wraps, no tab wider than the sheet)', async (scale) => {
    const { tabs, sideways, wraps } = await tabRow(oats);
    const labels = tabs.map((t) => String(t.props.accessibilityLabel).replace('Portion unit ', ''));
    expect(labels).toEqual(['g', 'oz', 'serving', 'cup', 'tbsp', 'tsp']);
    const room = width - 2 * layout.gutter;
    expect({ sideways, wraps }).toEqual({ sideways: false, wraps: true });
    for (const [i, t] of tabs.entries()) {
      const st = flat(t.props.style);
      expect(st.width ?? null).toBeNull();
      expect(st.maxWidth ?? null).toBeNull();
      expect(tabWidth(t, labels[i], scale)).toBeLessThanOrEqual(room);
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
