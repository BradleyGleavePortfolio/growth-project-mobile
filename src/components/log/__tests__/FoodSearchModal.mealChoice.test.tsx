// UI-3d (owner 10-19, option 1): the food search sheet opened from Extras "Add" shows the four existing meal names as pills,
// starting on the meal up next; a tap switches the meal the next food is filed under. Without the choice the sheet is unchanged.
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import FoodSearchModal from '../FoodSearchModal';
import { layout, lightTokens, radius } from '../../../theme/tokens';
import type { MealType } from '../../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../ui', () => ({ ...jest.requireActual('../../../ui'), useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../FoodSearchView', () => ({ __esModule: true, default: () => null }));
jest.mock('../ManualFoodEntryForm', () => ({ __esModule: true, default: () => null }));

type Flat = TextStyle & ViewStyle;
const flat = (node: { props: { style?: unknown } }): Flat => StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {};

const base = {
  visible: true, activeMealType: 'lunch' as MealType, onClose: jest.fn(), searchQuery: '', onSearchChange: jest.fn(), onClearSearch: jest.fn(),
  onRetrySearch: jest.fn(), searching: false, showSlowMessage: false, searchError: null, searchResults: [], didYouMean: [],
  recentTab: 'recent' as const, onRecentTabChange: jest.fn(), recentFoods: [], frequentFoods: [], onSelectFood: jest.fn(),
  manualMode: false, onEnterManualMode: jest.fn(), onExitManualMode: jest.fn(),
  manualFields: { foodName: '', calories: '', protein: '', carbs: '', fat: '', quantity: '1', unit: 'serving' },
  onManualFieldChange: jest.fn(), onManualLog: jest.fn(),
};
type Over = Partial<React.ComponentProps<typeof FoodSearchModal>>;
const show = (over: Over = {}) => render(<FoodSearchModal {...base} {...over} />);
const row = () => screen.getByTestId('food-search-meals');

beforeEach(() => jest.clearAllMocks());

it('shows no meal pills unless the sheet is opened with a meal choice', async () => {
  await show();
  expect(screen.queryByTestId('food-search-meals')).toBeNull();
  expect(screen.getByText('Add to Lunch')).toBeTruthy();
  expect(screen.queryByLabelText('Breakfast')).toBeNull();
});

it('shows Breakfast, Lunch, Dinner and Snacks in order, with the meal up next selected', async () => {
  await show({ onMealChange: jest.fn(), activeMealType: 'dinner' });
  const pills = within(row()).getAllByRole('button');
  expect(pills.map((b) => b.props.accessibilityLabel)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  expect(pills.map((b) => !!b.props.accessibilityState?.selected)).toEqual([false, false, true, false]);
  expect(screen.getByText('Add to Dinner')).toBeTruthy();
});

it('starts on Snacks once every meal is logged', async () => {
  await show({ onMealChange: jest.fn(), activeMealType: 'snack' });
  expect(within(row()).getByLabelText('Snacks').props.accessibilityState.selected).toBe(true);
  expect(screen.getByText('Add to Snacks')).toBeTruthy();
});

it('reports the tapped meal, and the title and selected pill follow the active meal', async () => {
  const onMealChange = jest.fn();
  const view = await show({ onMealChange });
  await fireEvent.press(within(row()).getByLabelText('Breakfast'));
  expect(onMealChange).toHaveBeenCalledWith('breakfast');
  await fireEvent.press(within(row()).getByLabelText('Snacks'));
  expect(onMealChange).toHaveBeenLastCalledWith('snack');
  await view.rerender(<FoodSearchModal {...base} onMealChange={onMealChange} activeMealType="snack" />);
  expect(screen.getByText('Add to Snacks')).toBeTruthy();
  expect(within(row()).getByLabelText('Snacks').props.accessibilityState.selected).toBe(true);
  expect(within(row()).getByLabelText('Lunch').props.accessibilityState.selected).toBe(false);
});

it('uses only the four existing meal names', async () => {
  await show({ onMealChange: jest.fn() });
  expect(within(row()).getAllByText(/./).map((t) => t.props.children)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
});

it('draws 44 pt rounded pills with the selected one outlined in the accent', async () => {
  await show({ onMealChange: jest.fn() });
  expect(flat(within(row()).getByLabelText('Lunch'))).toMatchObject({ minHeight: layout.touchMin, borderRadius: radius.chip, borderColor: lightTokens.accent });
  expect(flat(within(row()).getByLabelText('Dinner'))).toMatchObject({ minHeight: layout.touchMin, borderRadius: radius.chip, borderColor: lightTokens.border });
});

it('locks the pills while a food is saving', async () => {
  const onMealChange = jest.fn();
  await show({ onMealChange, saving: true });
  await fireEvent.press(within(row()).getByLabelText('Breakfast'));
  expect(onMealChange).not.toHaveBeenCalled();
});

it('keeps the pills with the manual form and the Added line, and hides them under the portion sheet', async () => {
  const view = await show({ onMealChange: jest.fn(), manualMode: true, addedFoodName: 'Rolled oats' });
  expect(within(row()).getAllByRole('button')).toHaveLength(4);
  expect(screen.getByText('Added Rolled oats.')).toBeTruthy();
  await view.rerender(<FoodSearchModal {...base} onMealChange={jest.fn()} portionPicker={<></>} />);
  expect(screen.queryByTestId('food-search-meals')).toBeNull();
});
