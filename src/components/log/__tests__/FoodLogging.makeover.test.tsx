import React from 'react';
import { Animated, Text, StyleSheet, Modal } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import MealSectionCard from '../MealSectionCard';
import FoodSearchView from '../FoodSearchView';
import QuantityPickerModal from '../QuantityPickerModal';
import WaterTracker from '../../WaterTracker';
import DaySelector from '../../DaySelector';
import QuietBar from '../../../ui/progress/QuietBar';
import type { FoodLog } from '../../../types';
jest.mock('../../FoodImage', () => ({ __esModule: true, default: () => null })); jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../hooks/useSettings', () => ({ useSettings: () => ({ settings: { waterGoalOz: 64 } }) }));
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }) }));
let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-07', formatDate: (date: string) => date }));
const food = { name: 'Oats', calories: 300, protein: 12, carbs: 54, fat: 6 };
const log: FoodLog = { ...food, foodName: food.name, id: 'log', userId: 'user', coachId: 'coach', date: '2026-10-07', mealType: 'breakfast', quantity: 1, unit: 'serving', createdAt: '' };
const action = jest.fn();
const search = { searchQuery: '', onSearchChange: jest.fn(), onClearSearch: jest.fn(), onRetrySearch: jest.fn(), searching: false, showSlowMessage: false, searchError: null, searchResults: [], didYouMean: [], recentTab: 'recent' as const, onRecentTabChange: jest.fn(), recentFoods: [food], frequentFoods: [food], onSelectFood: jest.fn(), onEnterManualMode: jest.fn() };
const press = (label: string, handler: jest.Mock, ...args: unknown[]) => { fireEvent.press(screen.getByText(label)); expect(handler).toHaveBeenLastCalledWith(...args); };
const fonts = () => expect(screen.UNSAFE_getAllByType(Text).every((text) => { const s = StyleSheet.flatten(text.props.style); return s.fontFamily === 'Inter_400Regular' && s.fontSize >= 13; })).toBe(true);
beforeEach(() => { jest.clearAllMocks(); mockReduced = false; });
it('preserves meal add, tap-to-edit and long-press-to-delete', async () => {
  const add = jest.fn(), edit = jest.fn();
  await render(<MealSectionCard label="Breakfast" icon="sunny-outline" mealType="breakfast" logs={[log]} mealCalories={300} onAddPress={add} onEditPress={edit} onDeletePress={action} />);
  press('Add Food', add, 'breakfast'); press('Oats', edit, log);
  fireEvent(screen.getByText('Oats'), 'longPress'); expect(action).toHaveBeenLastCalledWith(log); fonts(); });
it('preserves search, clear, both tabs, food selection, repeat and manual entry', async () => {
  const { rerender } = await render(<FoodSearchView {...search} repeatMealTitle="Last breakfast" repeatMeal={{ date: '2026-10-06', calories: 300, entries: [{ foodItemId: 'oats', name: 'Oats', calories: 300, quantityMultiplier: 1 }] }} onRepeatMeal={action} />);
  press('Add all', action); press('Recent', search.onRecentTabChange, 'recent'); press('Frequent', search.onRecentTabChange, 'frequent');
  press('Oats', search.onSelectFood, food); press('Enter Manually', search.onEnterManualMode); fonts();
  fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'oat'); expect(search.onSearchChange).toHaveBeenLastCalledWith('oat');
  await rerender(<FoodSearchView {...search} searchQuery="zz" searchError="Food search could not load" />);
  fireEvent.press(screen.getByLabelText('Clear food search')); expect(search.onClearSearch).toHaveBeenCalled(); press('Try again', search.onRetrySearch);
  await rerender(<FoodSearchView {...search} searchQuery="oat" didYouMean={[food]} />);
  press('Oats', search.onSelectFood, food); });
it('preserves portion input, unit, log and cancel with the same macro values', async () => {
  const confirm = jest.fn(), cancel = jest.fn(), unit = jest.fn();
  await render(<QuantityPickerModal visible selectedFood={{ ...food, nutrient_basis: 'PER_100G', serving_size_grams: 100, supports_volume_units: true, cup_grams: 100, tbsp_grams: 10, tsp_grams: 5 }} quantityInput="1" selectedUnit="serving" onQuantityChange={action} onUnitChange={unit} onConfirm={confirm} onCancel={cancel} />);
  fireEvent.changeText(screen.getByLabelText('Food quantity'), '2'); expect(action).toHaveBeenLastCalledWith('2');
  for (const label of ['serving', 'g', 'oz', 'cup', 'tbsp', 'tsp']) press(label, unit, label); press('Log Food', confirm); press('Cancel', cancel); cancel.mockClear(); fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose'); expect(cancel).toHaveBeenCalled(); fonts();
  for (const value of ['300', '12g', '54g', '6g']) expect(screen.getByText(value)).toBeTruthy(); });
it('preserves all water quick-add amounts and displayed quantities', async () => {
  await render(<WaterTracker currentOz={8} onAdd={action} />);
  for (const oz of [8, 12, 16]) { fireEvent.press(screen.getByLabelText(`Add ${oz} ounces of water`)); expect(action).toHaveBeenLastCalledWith(oz); } fonts();
  expect(screen.getByText('8 / 64 oz')).toBeTruthy(); expect(screen.getByText('1 glass (8 oz)')).toBeTruthy(); });
it('preserves previous, next and jump-to-today, with today marked and next disabled', async () => {
  const { rerender } = await render(<DaySelector selectedDate="2026-10-06" onDateChange={action} />);
  fireEvent.press(screen.getByLabelText('Previous day')); expect(action).toHaveBeenLastCalledWith('2026-10-05');
  for (const label of ['Next day', 'Viewing 2026-10-06, tap to go to today']) { fireEvent.press(screen.getByLabelText(label)); expect(action).toHaveBeenLastCalledWith('2026-10-07'); }
  await rerender(<DaySelector selectedDate="2026-10-07" onDateChange={action} />);
  expect(screen.getByTestId('today-dot')).toBeTruthy(); action.mockClear(); fireEvent.press(screen.getByLabelText('Next day')); expect(action).not.toHaveBeenCalled(); fireEvent.press(screen.getByLabelText('Viewing today')); expect(action).toHaveBeenLastCalledWith('2026-10-07'); fonts(); });
it('animates changed bar fills in 250 ms and skips motion when reduced', async () => {
  const timing = jest.spyOn(Animated, 'timing'); const { rerender } = await render(<QuietBar label="Protein" value="12g" current={12} target={100} />);
  await rerender(<QuietBar label="Protein" value="20g" current={20} target={100} />);
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 250 })); timing.mockClear(); mockReduced = true;
  await rerender(<QuietBar label="Protein" value="112g · 12 g over" current={112} target={100} />);
  expect(timing).not.toHaveBeenCalled(); fonts(); expect(StyleSheet.flatten(screen.getByTestId('quiet-bar-Protein').props.style)).toMatchObject({ height: 4, backgroundColor: require('../../../theme/tokens').colors.forest }); timing.mockRestore(); });
