/**
 * STYLEC-916 (C2 C_add and C_portion, index.md section 5): the portion ruler moves by
 * 10 g on drag, tap and the screen reader's adjustable swipe; what is logged is what
 * the sheet shows; unit tabs g, oz, serving (a USDA basic food's serving is 100 g,
 * owner W1 and W2); one summary line under the ruler; and the add sheet's rows.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import FoodSearchView from '../FoodSearchView';
import { calcMacros, parseQuantityInput } from '../../../utils/log/macros';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const chicken: SearchResult = {
  id: 'usda-1', name: 'Chicken breast, grilled', calories: 165, protein: 31, carbs: 0, fat: 3.6,
  nutrient_basis: 'PER_100G',
};

function Harness({ onConfirm, start = '150', unit: startUnit = 'g' }: { onConfirm: jest.Mock; start?: string; unit?: string }) {
  const [qty, setQty] = useState(start);
  const [unit, setUnit] = useState(startUnit);
  return (
    <QuantityPickerContent selectedFood={chicken} quantityInput={qty} selectedUnit={unit} mealLabel="Lunch"
      onQuantityChange={setQty} onUnitChange={setUnit} onCancel={jest.fn()}
      onConfirm={() => onConfirm(parseQuantityInput(qty), unit)} />
  );
}

const ruler = () => screen.getByTestId('portion-ruler');
const layoutRuler = async (width = 300) => {
  await fireEvent(ruler(), 'layout', { nativeEvent: { layout: { width, height: 72, x: 0, y: 0 } } });
};
const touch = (pageX: number, locationX = pageX) => ({ nativeEvent: { pageX, locationX } });

describe('STYLEC-916 portion ruler', () => {
  it('drags by 10 g steps and logs the amount it shows', async () => {
    const onConfirm = jest.fn();
    await render(<Harness onConfirm={onConfirm} />);
    await layoutRuler();
    await fireEvent(ruler(), 'responderGrant', touch(150));
    await fireEvent(ruler(), 'responderMove', touch(126)); // two ticks left: +20 g
    await fireEvent(ruler(), 'responderRelease', touch(126));
    expect(screen.getByLabelText('Food quantity').props.value).toBe('170');
    await fireEvent(ruler(), 'responderGrant', touch(150));
    await fireEvent(ruler(), 'responderMove', touch(186)); // three ticks right: -30 g
    await fireEvent(ruler(), 'responderRelease', touch(186));
    expect(screen.getByLabelText('Food quantity').props.value).toBe('140');
    expect(ruler().props.accessibilityValue).toEqual({ text: '140 g' });
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onConfirm).toHaveBeenLastCalledWith(140, 'g');
  });

  it('jumps to a tapped mark, 10 g per mark', async () => {
    const onConfirm = jest.fn();
    await render(<Harness onConfirm={onConfirm} />);
    await layoutRuler(300);
    await fireEvent(ruler(), 'responderGrant', touch(210, 210)); // five marks right of centre
    await fireEvent(ruler(), 'responderRelease', touch(210, 210));
    expect(screen.getByLabelText('Food quantity').props.value).toBe('200');
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onConfirm).toHaveBeenLastCalledWith(200, 'g');
  });

  it('is one adjustable control that screen readers step up and down by 10 g', async () => {
    const onConfirm = jest.fn();
    await render(<Harness onConfirm={onConfirm} start="137" />);
    const adjustable = screen.getByRole('adjustable');
    expect(adjustable.props.accessibilityLabel).toBe('Quantity');
    expect(adjustable.props.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
    await fireEvent(adjustable, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByRole('adjustable').props.accessibilityValue).toEqual({ text: '140 g' });
    await fireEvent(screen.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await fireEvent(screen.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByRole('adjustable').props.accessibilityValue).toEqual({ text: '120 g' });
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onConfirm).toHaveBeenLastCalledWith(120, 'g');
  });

  it('offers g, oz and serving tabs in that order; a USDA serving is 100 g', async () => {
    const onConfirm = jest.fn();
    await render(<Harness onConfirm={onConfirm} start="1" unit="serving" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel);
    expect(tabs).toEqual(['Portion unit g', 'Portion unit oz', 'Portion unit serving']);
    expect(screen.getByLabelText('Portion unit serving').props.accessibilityState).toMatchObject({ selected: true });
    const perServing = calcMacros(chicken, 1, 'serving');
    expect(perServing).toEqual(calcMacros(chicken, 100, 'g'));
    expect(screen.getByTestId('portion-summary')).toHaveTextContent('165 kcal, 31 g protein, 0 g carbs, 4 g fat.');
    expect(String(screen.getByTestId('portion-summary').props.children)).toContain('\u00A0g fat.');
    await fireEvent.press(screen.getByLabelText('Portion unit oz'));
    expect(screen.getByLabelText('Portion unit oz').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('puts one summary line under the ruler, with the meal over the serif name', async () => {
    await render(<Harness onConfirm={jest.fn()} />);
    expect(screen.getByText('For Lunch')).toBeTruthy();
    expect(screen.getByRole('header').props.children).toBe('Chicken breast, grilled');
    expect(screen.getByTestId('portion-summary')).toHaveTextContent('248 kcal, 47 g protein, 0 g carbs, 5 g fat.');
    expect(String(screen.getByTestId('portion-summary').props.children)).toContain('\u00A0g fat.');
    const order = JSON.stringify(screen.toJSON());
    expect(order.indexOf('portion-ruler')).toBeLessThan(order.indexOf('portion-summary'));
    expect(order.indexOf('portion-summary')).toBeLessThan(order.indexOf('quantity-log-food'));
    expect(screen.queryByText('Calories')).toBeNull();
  });
});

describe('STYLEC-916 add sheet rows', () => {
  const base = {
    searchQuery: '', onSearchChange: jest.fn(), onClearSearch: jest.fn(), onRetrySearch: jest.fn(),
    searching: false, showSlowMessage: false, searchError: null, searchResults: [], didYouMean: [],
    recentTab: 'recent' as const, onRecentTabChange: jest.fn(), frequentFoods: [],
    onSelectFood: jest.fn(), onEnterManualMode: jest.fn(),
  };

  // STYLEC-916B (C2 C_add, C_portion): whole grams, as the mock's "1 cup, 240 ml, 6 g protein" and
  // "248 kcal, 47 g protein, 0 g carbs, 5 g fat."; the saved entry keeps calcMacros' own numbers.
  it('rounds the row protein to whole grams', async () => {
    const grilled: SearchResult = { ...chicken, name: 'Chicken breast, grilled', last_quantity: 150, last_unit: 'g', from_log: true };
    await render(<FoodSearchView {...base} recentFoods={[grilled]} />);
    expect(screen.getByLabelText('Chicken breast, grilled, 150 g, 47 g protein, 248 kcal')).toBeTruthy();
    expect(screen.getByText('150 g, 47 g protein')).toBeTruthy();
  });

  it('shows a serif name, one portion and protein line, and that portion\'s calories at the right', async () => {
    const yoghurt: SearchResult = { name: 'Greek yoghurt, plain', calories: 59, protein: 10, carbs: 3.6, fat: 0.4,
      nutrient_basis: 'PER_100G', last_quantity: 200, last_unit: 'g', from_log: true };
    await render(<FoodSearchView {...base} recentFoods={[yoghurt, chicken]} />);
    const row = screen.getByLabelText('Greek yoghurt, plain, 200 g, 20 g protein, 118 kcal');
    expect(within(row).getByText('200 g, 20 g protein')).toBeTruthy();
    expect(within(row).getByText('118')).toBeTruthy();
    expect(screen.getByText('100 g, 31 g protein')).toBeTruthy();
    expect(screen.getByText('165')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => within(t).getByText(/./).props.children)).toEqual(['Recent', 'Frequent']);
    await fireEvent.press(screen.getByRole('button', { name: 'Quick add, enter a food manually' }));
    expect(base.onEnterManualMode).toHaveBeenCalled();
  });
});
