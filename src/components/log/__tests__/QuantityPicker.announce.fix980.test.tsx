import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QuantityPickerContent } from '../QuantityPickerModal';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const food: SearchResult = {
  id: 'food', name: 'Chicken breast, grilled', calories: 165, protein: 31, carbs: 0, fat: 3.6, nutrient_basis: 'PER_100G',
};
const online = { title: "Couldn't log food", message: 'This food was not added. Check the connection and try again.', retry: 'confirm' as const };
const offline = { title: "Couldn't save food", message: 'Keep this portion open and try saving again.', retry: 'addAnother' as const };
const notice = 'The food could not be saved. Check the connection and try again.';
type Failure = React.ComponentProps<typeof QuantityPickerContent>['saveFailure'];
const Sheet = ({ failure, message, qty = '150' }: { failure?: Failure; message?: string | null; qty?: string }) => (
  <QuantityPickerContent selectedFood={food} quantityInput={qty} selectedUnit="g" onQuantityChange={jest.fn()}
    onUnitChange={jest.fn()} onCancel={jest.fn()} onConfirm={jest.fn()} saveFailure={failure} notice={message} />
);

describe('FIX-980: shared portion-sheet announcements', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; jest.restoreAllMocks(); });

  it.each([
    ['online confirm', online, undefined],
    ['offline add another', offline, undefined],
    ['coach notice', undefined, notice],
  ] as const)('%s speaks existing words once per appearance, not once per render', async (_label, failure, message) => {
    Platform.OS = 'ios';
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const view = await render(<Sheet />);
    expect(announce).not.toHaveBeenCalled();
    await view.rerender(<Sheet failure={failure} message={message} />);
    const words = failure ? `${failure.title}. ${failure.message}` : message;
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith(words);
    await view.rerender(<Sheet failure={failure ? { ...failure } : undefined} message={message} qty="175" />);
    expect(announce).toHaveBeenCalledTimes(1);
    await view.rerender(<Sheet failure={null} message={null} />);
    expect(announce).toHaveBeenCalledTimes(1);
    await view.rerender(<Sheet failure={failure} message={message} />);
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['save failure', online, undefined],
    ['coach notice', undefined, notice],
  ] as const)('Android %s uses the live region without a duplicate explicit announcement', async (_label, failure, message) => {
    Platform.OS = 'android';
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const view = await render(<Sheet />);
    await view.rerender(<Sheet failure={failure} message={message} />);
    const alert = failure ? screen.getByTestId('portion-save-failure') : screen.getByText(notice);
    expect(alert.props.accessibilityLiveRegion).toBe('assertive');
    expect(announce).not.toHaveBeenCalled();
  });
});
