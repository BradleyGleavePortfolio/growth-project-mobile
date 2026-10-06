import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import ManualFoodEntryForm from '../ManualFoodEntryForm';

const fields = {
  foodName: 'Label lunch', calories: '400', protein: '', carbs: '', fat: '',
  quantity: '2', unit: 'serving',
};
const props = {
  fields, onFieldChange: jest.fn(), onBack: jest.fn(), onSubmit: jest.fn(),
};
const message = 'Enter protein, carbs and fat. Use 0 if there is none.';

beforeEach(() => jest.clearAllMocks());

it('shows an actionable inline message and blocks a calorie-only save', async () => {
  await render(<ManualFoodEntryForm {...props} />);
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText(/Blank macros are not tracked/)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it('allows the same portion once all three macros have explicitly typed zero values', async () => {
  await render(<ManualFoodEntryForm {...props} fields={{
    ...fields, protein: '0', carbs: '0', fat: '0',
  }} />);
  expect(screen.queryByText(message)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Log Food' }));
  expect(props.onSubmit).toHaveBeenCalledTimes(1);
});
