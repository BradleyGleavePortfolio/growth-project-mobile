/**
 * B29 (B-RADIUS-135, agent 135): the forest action on Forgot password and
 * Reset password uses the rounded button token, like every other primary
 * button (owner 17:07, Q10b: buttons 12, cards 16, sheets 24).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { radius } from '../../../theme/tokens';

jest.mock('../../../services/api', () => ({ authApi: { forgotPassword: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }),
}));

import ForgotPasswordScreen from '../ForgotPasswordScreen';
import ResetPasswordScreen from '../ResetPasswordScreen';

type ForgotNav = React.ComponentProps<typeof ForgotPasswordScreen>['navigation'];
type ResetNav = React.ComponentProps<typeof ResetPasswordScreen>['navigation'];

it('Forgot password: Send reset link uses radius.button', async () => {
  const navigation: Partial<ForgotNav> = { navigate: jest.fn(), goBack: jest.fn() };
  const view = await render(<ForgotPasswordScreen navigation={navigation as ForgotNav} />);
  expect(view.getByLabelText('Send reset link')).toHaveStyle({ borderRadius: radius.button });
});

it('Reset password: Update password uses radius.button', async () => {
  const navigation: Partial<ResetNav> = { navigate: jest.fn() };
  const view = await render(
    <ResetPasswordScreen
      navigation={navigation as ResetNav}
      route={{ key: 'reset', name: 'ResetPassword', params: { access_token: 'a', refresh_token: 'r' } }}
    />,
  );
  expect(view.getByLabelText('Update password')).toHaveStyle({ borderRadius: radius.button });
});
