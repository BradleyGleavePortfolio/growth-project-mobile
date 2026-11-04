/**
 * REDO-FOOD-133 (APPLY-FOOD-133, part 2 of 2): the add-food sheets on the
 * shared primitives. One filled forest action per sheet, rounded token
 * corners (owner 17:07), lining tabular numbers, and the four sheet files
 * carry no TouchableOpacity, fixed Colors or literal radius.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import QuantityPickerModal from '../QuantityPickerModal';
import { gold, layout, lightTokens, radius } from '../../../theme/tokens';

jest.mock('../../FoodImage', () => ({ __esModule: true, default: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

type Flat = TextStyle & ViewStyle;
const flat = (node: { props: { style?: unknown } }): Flat => StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {};

type JsonNode = { props?: { style?: unknown }; children?: (JsonNode | string)[] | null };
const filledForest = (node: JsonNode | JsonNode[] | string | null): number => {
  if (!node || typeof node === 'string') return 0;
  if (Array.isArray(node)) return node.reduce((n, child) => n + filledForest(child), 0);
  const own = flat(node as { props: { style?: unknown } }).backgroundColor === lightTokens.accent ? 1 : 0;
  return own + filledForest((node.children ?? []) as JsonNode[]);
};

const SRC = path.join(__dirname, '..', '..', '..');
const FILES = [
  'components/log/FoodSearchView.tsx',
  'components/log/QuantityPickerModal.tsx',
  'components/log/ManualFoodEntryForm.tsx',
  'components/log/FoodSearchModal.tsx',
];

describe('Food sheets redesign (REDO-FOOD-133)', () => {
  it('keeps the four add-food sheet files on the shared parts and tokens', () => {
    for (const file of FILES) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      expect([file, /TouchableOpacity/.test(source)]).toEqual([file, false]);
      expect([file, /\bColors\b/.test(source)]).toEqual([file, false]);
      expect([file, /borderRadius:\s*\d/.test(source)]).toEqual([file, false]);
      expect([file, /SafeAreaView/.test(source)]).toEqual([file, false]);
    }
  });

  it('gives the portion sheet one filled forest action and rounded token corners', async () => {
    const food = { name: 'Oats', calories: 300, protein: 12, carbs: 54, fat: 6, nutrient_basis: 'PER_100G' as const, serving_size_grams: 100 };
    await render(<QuantityPickerModal visible selectedFood={food} quantityInput="1" selectedUnit="serving" onQuantityChange={jest.fn()}
      onUnitChange={jest.fn()} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    // Style C (STYLEC-916): the ruler needle is the only other forest fill; it is not an action.
    expect(filledForest(screen.toJSON() as JsonNode)).toBe(2);
    expect(flat(screen.getByTestId('portion-ruler-needle')).backgroundColor).toBe(lightTokens.accent);
    expect(flat(screen.getByRole('button', { name: 'Log food' }))).toMatchObject({ borderRadius: radius.button, minHeight: 54 });
    expect(flat(screen.getByLabelText('Portion unit serving')).borderBottomColor).toBe(gold[300]);
    expect(flat(screen.getByLabelText('Portion unit g')).borderBottomColor).toBe('transparent');
    for (const unit of ['serving', 'g', 'oz']) {
      const tab = flat(screen.getByLabelText(`Portion unit ${unit}`));
      expect(tab.minHeight).toBe(layout.touchMin);
      expect(Number(tab.minWidth)).toBeGreaterThanOrEqual(layout.touchMin);
    }
    expect(flat(screen.getByTestId('portion-summary')).fontVariant).toEqual(['lining-nums', 'tabular-nums']);
    expect(screen.getByTestId('portion-summary')).toHaveTextContent('300 kcal, 12 g protein, 54 g carbs, 6 g fat.');
  });
});
