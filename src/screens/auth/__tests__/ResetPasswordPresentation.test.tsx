import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import ResetPasswordScreen from '../ResetPasswordScreen';
import { lightTokens } from '../../../theme/tokens';

let mockDone = false;
let mockFalseStates = 0;
let mockDark = false;
jest.mock('react', () => {
  const actual = jest.requireActual<typeof React>('react');
  return { ...actual, useState: (initial: unknown) =>
    actual.useState(mockDone && initial === false ? ++mockFalseStates === 3 : initial) };
});
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: require('../../../theme/tokens')[mockDark ? 'darkTokens' : 'lightTokens'],
    colors: new Proxy({}, { get: () => require('../../../theme/tokens').lightTokens.bgPrimary }),
  }),
}));

it('resolves input colors from the retained dark theme', async () => {
  mockDark = true;
  const view = await render(<ResetPasswordScreen {...props()} />);
  mockDark = false;
  const dark = require('../../../theme/tokens').darkTokens;
  expect(view.getByLabelText('New password')).toHaveStyle({ backgroundColor: dark.bgPrimary, color: dark.textPrimary });
});

function props(valid = true): React.ComponentProps<typeof ResetPasswordScreen> {
  const navigation: Partial<React.ComponentProps<typeof ResetPasswordScreen>['navigation']> = { navigate: jest.fn() };
  return {
    navigation: navigation as React.ComponentProps<typeof ResetPasswordScreen>['navigation'],
    route: { key: 'reset', name: 'ResetPassword', params: valid ? { access_token: 'a', refresh_token: 'r' } : {} },
  };
}

it('keeps editable inputs, password visibility and update validation', async () => {
  const screenProps = props();
  const view = await render(<ResetPasswordScreen {...screenProps} />);
  expect(view.getByLabelText('New password')).toHaveStyle({
    backgroundColor: lightTokens.bgPrimary, borderBottomWidth: StyleSheet.hairlineWidth,
    fontFamily: 'Inter_400Regular',
  });
  // SHOTS-134B 5: an underline input has no corner radius.
  expect(StyleSheet.flatten(view.getByLabelText('New password').props.style).borderRadius).toBeUndefined();
  await fireEvent.press(view.getByLabelText('Show password'));
  expect(view.getByLabelText('New password').props.secureTextEntry).toBe(false);
  await fireEvent.press(view.getByLabelText('Hide password'));
  expect(view.getByLabelText('Confirm new password').props.secureTextEntry).toBe(true);
  await fireEvent.changeText(view.getByLabelText('New password'), 'Newpass1!');
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'Different1!');
  await fireEvent.press(view.getByLabelText('Update password'));
  expect(view.getByText('Passwords do not match.')).toBeTruthy();
});

it('keeps the completed-state sign-in route', async () => {
  mockDone = true;
  mockFalseStates = 0;
  const screenProps = props();
  const view = await render(<ResetPasswordScreen {...screenProps} />);
  mockDone = false;
  expect(view.getByText('Password updated')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Go to login'));
  expect(screenProps.navigation.navigate).toHaveBeenCalledWith('Login');
});

it('keeps invalid-link recovery and the disabled submit gate', async () => {
  const screenProps = props(false);
  const view = await render(<ResetPasswordScreen {...screenProps} />);
  expect(view.getByText(/invalid or has expired/)).toBeTruthy();
  expect(view.getByLabelText('Update password').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(view.getByLabelText('Back to login'));
  expect(screenProps.navigation.navigate).toHaveBeenCalledWith('Login');
});
