/**
 * FOOD-DAY-STYLEC-M (C2 C_portion, approved with the UI-3 mockup): C2-S-32 "After this plate: {kcal} kcal left and
 * {p} g protein to go." from the plate on the ruler and what the day has left, and C2-S-33 "Add another food".
 * Both only when the Food tab passes them (featureFlags.foodPlanChecklist); without them the sheet reads as main.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const chicken: SearchResult = {
  id: 'usda-1', name: 'Chicken breast, grilled', calories: 165, protein: 31, carbs: 0, fat: 3.6, nutrient_basis: 'PER_100G',
};

function Harness(p: { left?: { kcal: number; protein: number } | null; onAddAnother?: () => void; onConfirm?: () => void; onCancel?: () => void }) {
  const [qty, setQty] = useState('150');
  return (
    <QuantityPickerContent selectedFood={chicken} quantityInput={qty} selectedUnit="g" mealLabel="Lunch"
      onQuantityChange={setQty} onUnitChange={jest.fn()} onCancel={p.onCancel ?? jest.fn()} onConfirm={p.onConfirm ?? jest.fn()}
      dayLeft={p.left} onAddAnother={p.onAddAnother} />
  );
}

it('C2-S-32: takes the plate on the ruler from what the day has left', async () => {
  await render(<Harness left={{ kcal: 640, protein: 63 }} />);
  // 150 g of chicken: 248 kcal and 47 g protein (the summary line above it).
  expect(screen.getByText('248\u00A0kcal, 47\u00A0g protein, 0\u00A0g carbs, 5\u00A0g fat.')).toBeTruthy();
  expect(screen.getByText('After this plate: 392 kcal left and 16 g protein to go.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Food quantity'), '100');
  expect(screen.getByText('After this plate: 475 kcal left and 32 g protein to go.')).toBeTruthy();
});

it('C2-S-32: says no left line once the plate passes the target, and protein never goes below 0', async () => {
  await render(<Harness left={{ kcal: 200, protein: 20 }} />);
  expect(screen.queryByText(/After this plate/)).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Food quantity'), '50');
  expect(screen.getByText('After this plate: 117 kcal left and 4 g protein to go.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Food quantity'), '80');
  expect(screen.getByText('After this plate: 68 kcal left and 0 g protein to go.')).toBeTruthy();
});

it('C2-S-33: Add another food logs this plate and keeps the add sheet; without it the sheet keeps Cancel', async () => {
  const onAddAnother = jest.fn();
  const onConfirm = jest.fn();
  const view = await render(<Harness left={{ kcal: 640, protein: 63 }} onAddAnother={onAddAnother} onConfirm={onConfirm} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Add another food' }));
  expect(onAddAnother).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByText('Cancel')).toBeNull();
  await view.rerender(<Harness />);
  expect(screen.queryByText(/After this plate/)).toBeNull();
  expect(screen.queryByText('Add another food')).toBeNull();
  expect(screen.getByText('Cancel')).toBeTruthy();
});
