import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { darkTokens, lightTokens } from '../../../theme/tokens';

const mockBack = jest.fn(), mockUpdate = jest.fn(), mockPatch = jest.fn(), mockInvalidate = jest.fn();
let mockColors = lightTokens;
let mockUser: import('../../../hooks/useCurrentUser').CurrentUser | null = { id: 'client', email: 'client@example.test', profile: {} };
jest.mock('../../../components/HapticPressable', () => {
  const React = require('react'), { View } = require('react-native');
  return { __esModule: true, default: ({ intent, ...props }: import('../../../components/HapticPressable').HapticPressableProps) =>
    React.createElement(View, { ...props, onPress: props.disabled ? undefined : props.onPress,
      accessibilityState: { ...props.accessibilityState, disabled: props.disabled } }) };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack }) }));
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => ({ semanticColors: mockColors }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/api', () => ({ profileApi: { update: (...args: unknown[]) => mockUpdate(...args) } }));
jest.mock('../../../lib/userCache', () => ({ patchUserCache: (...args: unknown[]) => mockPatch(...args) }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: (...args: unknown[]) => mockInvalidate(...args) } }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { warning: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
import EditProfileScreen from '../EditProfileScreen';

beforeEach(() => {
  jest.clearAllMocks(); mockColors = lightTokens; mockUpdate.mockResolvedValue({});
  mockUser = { id: 'client', email: 'client@example.test', profile: {} };
});

it.each([lightTokens, darkTokens])('uses semantic hairlines, readable units and one primary action', async (palette) => {
  mockColors = palette; await render(<EditProfileScreen />);
  for (const heading of ['ABOUT YOU', 'BODY', 'GOAL']) expect(screen.getByText(heading)).toBeTruthy();
  expect(screen.queryByText(/nothing leaves the app|Your coach sees|no caloric target/)).toBeNull();
  expect(screen.getByText('Maintenance calorie target')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByLabelText('Save profile').props.style).backgroundColor).toBe(palette.accent);
  expect(StyleSheet.flatten(screen.getByLabelText('Back').props.style).minHeight).toBeGreaterThanOrEqual(44);
  for (const label of ['Date of birth', 'Current weight in pounds', 'Height in centimetres', 'Target weight in pounds']) {
    const style = StyleSheet.flatten(screen.getByLabelText(label).props.style);
    expect(style.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
    expect(style.color).toBe(palette.textPrimary);
    expect(style.backgroundColor).toBeUndefined();
  }
  expect(screen.getAllByText('lbs')).toHaveLength(2); expect(screen.getByText('cm')).toBeTruthy();
});

it('keeps all eleven fields and every choice reachable, then saves the same payload and returns', async () => {
  await render(<EditProfileScreen />);
  const groups = [
    ['Female', 'Male'], ['Omnivore', 'Vegetarian', 'Vegan', 'Pescatarian', 'Keto', 'Paleo', 'Mediterranean', 'Other'],
    ['Sedentary', 'Lightly active', 'Moderately active', 'Active', 'Very active'],
    ['Lose weight fast', 'Lose weight steady', 'Maintain', 'Build muscle', 'Gain mass', 'Mobility & wellness'],
    ['Full gym, regular access', 'Full gym, occasional access', 'Home setup', 'Bodyweight only'],
    ['1', '2', '3', '4', '5', '6', '7'],
  ];
  for (const group of groups) for (const label of group) {
    const buttons = screen.getAllByLabelText(label), button = buttons[buttons.length - 1];
    await fireEvent.press(button); expect(button.props.accessibilityState.selected).toBe(true);
  }
  for (const label of ['None', 'Nut Allergy', 'Peanut Allergy', 'Shellfish Allergy', 'Egg Allergy', 'Dairy Allergy',
    'Soy', 'Sesame', 'Gluten-Free', 'Vegetarian', 'Vegan', 'Pescatarian', 'No Pork', 'No Beef', 'No Fish', 'No Spicy']) {
    const button = screen.getAllByLabelText(label)[0]; await fireEvent.press(button);
    expect(button.props.accessibilityState.selected).toBe(true);
  }
  await fireEvent.press(screen.getByLabelText('None')); await fireEvent.press(screen.getByLabelText('Female'));
  for (const [label, value] of [['Date of birth', '1992-04-15'], ['Current weight in pounds', '180'],
    ['Height in centimetres', '178'], ['Target weight in pounds', '165']]) await fireEvent.changeText(screen.getByLabelText(label), value);
  await act(async () => fireEvent.press(screen.getByLabelText('Save profile')));
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    sex: 'female', dob: '1992-04-15', current_weight: 180, height_cm: 178, target_weight: 165,
    diet_type: 'other', activity_level: 'very_active', primary_goal: 'mobility',
    gym_membership: 'no_gym', workout_days_per_week: 7, diet_restrictions: ['None'],
    calorie_target: expect.any(Number), protein_target: expect.any(Number),
  }));
  expect(mockPatch).toHaveBeenCalled(); expect(mockBack).toHaveBeenCalledTimes(1);
});

it.each([
  ['Height in centimetres', '80', 'Enter a height between 90 and 250 cm.'],
  ['Current weight in pounds', '40', 'Enter a current weight between 60 and 700 lbs.'],
  ['Target weight in pounds', '40', 'Enter a weight between 50 and 700 lbs.'],
  ['Date of birth', 'not-a-date', 'Enter a date as YYYY-MM-DD for an age between 13 and 110.'],
])('puts specific validation beside %s and does not save', async (label, value, message) => {
  await render(<EditProfileScreen />); await fireEvent.changeText(screen.getByLabelText(label), value);
  await act(async () => fireEvent.press(screen.getByLabelText('Save profile')));
  expect(screen.getByText(message)).toBeTruthy(); expect(mockUpdate).not.toHaveBeenCalled();
  const inputParent = screen.getByLabelText(label).parent;
  expect(screen.getByText(message).parent).toBe(label === 'Date of birth' ? inputParent : inputParent?.parent);
});

it('Back cancels without saving and a failed save remains on the form with recovery copy', async () => {
  await render(<EditProfileScreen />); await fireEvent.press(screen.getByLabelText('Back'));
  expect(mockBack).toHaveBeenCalledTimes(1); expect(mockUpdate).not.toHaveBeenCalled(); mockBack.mockClear();
  mockUpdate.mockRejectedValue({}); const alert = jest.spyOn(Alert, 'alert');
  await fireEvent.press(screen.getByLabelText('Female'));
  await act(async () => fireEvent.press(screen.getByLabelText('Save profile')));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't save", 'Profile changes were not saved. Check the connection and try again.'));
  expect(mockBack).not.toHaveBeenCalled(); expect(screen.getByLabelText('Save profile')).toBeEnabled();
  alert.mockRestore();
});

it.each([null, 'coach'])('never promises sharing or a plan with coach state %s', async (coach) => {
  mockUser = coach ? { id: 'client', email: 'client@example.test', coach_id: coach, profile: { height_cm: 178, current_weight: 180 } } : null;
  await render(<EditProfileScreen />);
  expect(screen.getByText('Update the details used for daily targets and training preferences.')).toBeTruthy();
  expect(screen.queryByText(/coach sees|Coaches will|nothing leaves|your plan can prescribe|hides anything/)).toBeNull();
  expect(screen.getByLabelText('Height in centimetres').props.value).toBe(coach ? '178' : '');
  expect(screen.getByLabelText('Current weight in pounds').props.value).toBe(coach ? '180' : '');
});

it('shows saving state, prevents another save tap, then returns after success', async () => {
  let finish: () => void = () => {};
  mockUpdate.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  await render(<EditProfileScreen />); await fireEvent.press(screen.getByLabelText('Female'));
  await act(async () => { void screen.getByLabelText('Save profile').props.onPress(); });
  expect(screen.getByLabelText('Saving profile')).toBeTruthy();
  expect(screen.getByLabelText('Save profile')).toBeDisabled();
  expect(screen.getByLabelText('Save profile').props.onPress).toBeUndefined();
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  await act(async () => finish()); expect(mockBack).toHaveBeenCalledTimes(1);
});

it('prefills saved details when the user cache finishes loading after mount', async () => {
  mockUser = null; const view = await render(<EditProfileScreen />);
  mockUser = { id: 'client', email: 'client@example.test', profile: {
    sex: 'female', dob: '1992-04-15', height_cm: 178, current_weight: 180, target_weight: 165,
    activity_level: 'moderate', primary_goal: 'maintain', diet_type: 'omnivore',
    diet_restrictions: ['None'], workout_days_per_week: 3, gym_membership: 'home_gym',
  } };
  await view.rerender(<EditProfileScreen />);
  expect(screen.getByLabelText('Height in centimetres').props.value).toBe('178');
  expect(screen.getByLabelText('Date of birth').props.value).toBe('1992-04-15');
  expect(screen.getByText('Save')).toBeTruthy();
});

it('reads the recipe lists again after saving allergies, so newly hidden recipes leave them (ALLERGY-M-130)', async () => {
  await render(<EditProfileScreen />);
  await fireEvent.press(screen.getByLabelText('Nut Allergy'));
  await act(async () => fireEvent.press(screen.getByLabelText('Save profile')));
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ diet_restrictions: ['Nut Allergy'] }));
  for (const queryKey of [['recipes'], ['recipe'], ['prep-guide']]) expect(mockInvalidate).toHaveBeenCalledWith({ queryKey });
  mockInvalidate.mockClear();
  mockUpdate.mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => fireEvent.press(screen.getByLabelText('Save profile')));
  expect(mockInvalidate).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('offers Soy and Sesame and keeps every saved answer when one is added (ALLERGY-CHOICES-131)', async () => {
  // A chip answer, a consultation answer and the new Sesame chip, all saved earlier.
  mockUser = { id: 'client', email: 'client@example.test', profile: { diet_restrictions: ['Nut Allergy', 'nuts', 'Sesame'] } };
  await render(<EditProfileScreen />);
  expect(screen.getByLabelText('Sesame').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('Nut Allergy').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('Soy').props.accessibilityState.selected).toBe(false);
  await fireEvent.press(screen.getByLabelText('Soy'));
  await act(async () => fireEvent.press(screen.getByLabelText('Save profile')));
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ diet_restrictions: ['Nut Allergy', 'nuts', 'Sesame', 'Soy'] }));
  for (const queryKey of [['recipes'], ['recipe'], ['prep-guide']]) expect(mockInvalidate).toHaveBeenCalledWith({ queryKey });
});
