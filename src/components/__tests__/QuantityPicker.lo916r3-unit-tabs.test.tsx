// LO-916R3 B1: a food that has cup, tbsp and tsp must show every unit tab on a phone.
// Main wrapped the unit chips so all six showed; the Style C portion sheet puts them in a sideways
// ScrollView with no scroll bar, 64 pt minimum each plus an 8 pt gap (6 x 64 + 5 x 8 = 424 pt), wider
// than the sheet's content at every phone width (320 pt - 2 x 24 pt gutter = 272 pt; 430 pt = 382 pt),
// so tsp (and at 320-390 pt tbsp, at 320 pt part of "cup") is off the edge with nothing to say it is there.
// PORTION-WRAP-M: the window is now mocked to a 320 pt phone at 130% text, where the one-row tabs must still fit.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../log/QuantityPickerModal';
import { layout } from '../../theme';
import type { SearchResult } from '../../utils/log/types';

const mockWindow = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

const flat = (s: unknown) => (StyleSheet.flatten(s as any) ?? {}) as Record<string, any>;

it('LO-916R3 B1: every unit tab of a volume food fits on a 320 pt phone (none hidden off the edge)', async () => {
  const oats = {
    id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
    nutrient_basis: 'PER_100G', serving_size: '100 g', serving_size_grams: 100,
    supports_volume_units: true, cup_grams: 81, tbsp_grams: 5, tsp_grams: 1.7, food_category: 'oats',
  } as SearchResult;
  await render(<QuantityPickerContent selectedFood={oats} quantityInput="40" selectedUnit="g"
    onQuantityChange={jest.fn()} onUnitChange={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(
    ['g', 'oz', 'serving', 'cup', 'tbsp', 'tsp'].map((u) => `Portion unit ${u}`));

  // Is the tab row a sideways scroller, and does it wrap?
  let node: any = tabs[0].parent;
  let sideways = false;
  let wraps = false;
  let gap = 0;
  while (node) {
    const cc = flat(node.props?.contentContainerStyle);
    if (typeof cc.gap === 'number') gap = cc.columnGap ?? cc.gap;
    if (node.props?.horizontal) { sideways = true; break; }
    const st = flat(node.props?.style);
    if (st.flexWrap === 'wrap') { wraps = true; break; }
    if (typeof st.gap === 'number' || typeof st.columnGap === 'number') gap = st.columnGap ?? st.gap;
    node = node.parent;
  }
  const minRow = tabs.reduce((n, t) => n + (flat(t.props.style).minWidth ?? 0), 0) + gap * (tabs.length - 1);
  const room = 320 - 2 * layout.gutter;
  const hidden = !wraps && minRow > room;
  expect({ sideways, wraps, minRow, room, hidden }).toEqual(expect.objectContaining({ hidden: false }));
});
