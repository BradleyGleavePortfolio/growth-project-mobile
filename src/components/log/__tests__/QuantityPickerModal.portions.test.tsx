import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import QuantityPickerModal from '../QuantityPickerModal';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('../../FoodImage', () => ({ __esModule: true, default: () => null }));

const food: SearchResult = {
  name: 'Almonds', calories: 579, protein: 21, carbs: 22, fat: 50,
  nutrient_basis: 'PER_100G', serving_size_grams: 28, supports_volume_units: false,
};
const props = {
  visible: true, selectedFood: food, quantityInput: '1', selectedUnit: 'serving',
  onQuantityChange: jest.fn(), onUnitChange: jest.fn(), onConfirm: jest.fn(), onCancel: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

describe('portion preview matches the saved quantity parser', () => {
  it('previews a comma-decimal half serving as 81 kcal rather than zero', async () => {
    await render(<QuantityPickerModal {...props} quantityInput="0,5" />);
    expect(screen.getByText('81')).toBeTruthy();
    expect(screen.getByText('2.9g')).toBeTruthy();
  });

  it('cannot log an empty quantity as an unseen one-serving default', async () => {
    await render(<QuantityPickerModal {...props} quantityInput="" />);
    expect(screen.getByText(/Enter a quantity greater than zero/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('shows an unknown nutrient as a dash instead of NaN', async () => {
    await render(<QuantityPickerModal {...props} selectedFood={{ ...food, protein: NaN }} />);
    expect(screen.getByText('—g')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('does not offer a cup conversion without a density', async () => {
    await render(<QuantityPickerModal {...props} selectedFood={{ ...food, supports_volume_units: true }} />);
    expect(screen.queryByText('cup')).toBeNull();
  });

  it('shows save progress and does not invite another log while saving', async () => {
    await render(<QuantityPickerModal {...props} saving />);
    const button = screen.getByRole('button', { name: 'Log food' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('quantity-log-food-spinner')).toBeTruthy();
    fireEvent.press(button);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
