/**
 * LS-E4R2 B3: C7 Style B / C7B-JOIN keep a visible step pill and bars on
 * Create account. The owner chose code entry option 2, not removal of progress.
 * GOAL: planning/MOCKUP3/C7/style-b-join/BJ_create_ios390_100.png.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
const mockPreview = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...args: unknown[]) => mockGetSignupPolicy(...args),
    getInvitePreview: (...args: unknown[]) => mockPreview(...args),
    validateInviteCode: (...args: unknown[]) => mockPreview(...args),
  },
}));
jest.mock('../../../utils/appleAuth', () => ({ signInWithApple: jest.fn() }));
jest.mock('../../../utils/googleAuth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('../../../components/AppleSignInButton', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <Text>Continue with Apple</Text> };
});
jest.mock('../../../config/featureFlags', () => ({
  ...jest.requireActual('../../../config/featureFlags'),
  featureFlags: {
    ...jest.requireActual('../../../config/featureFlags').featureFlags,
    firstRunV2: true,
    consultTilesV2: true,
  },
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));

import CreateAccountScreen from '../CreateAccountScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

beforeEach(async () => {
  jest.clearAllMocks();
  __resetSignupPolicyCacheForTests();
  await AsyncStorage.clear();
  mockGetSignupPolicy.mockResolvedValue({
    data: { invite_code_required: false, providers: ['email', 'google', 'apple'], role_choice: true },
  });
  mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Sam' } });
});

it.each([false, true])('LS-E4R2 B3: Create account keeps C7 step progress (link=%s)', async (linked) => {
  const nav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), canGoBack: () => true };
  const r = await render(
    <CreateAccountScreen navigation={nav as never}
      route={linked ? { params: { invite_code: 'TGP-R8N3VW5' } } : undefined} />,
  );
  await waitFor(() => expect(r.queryByTestId('signup-policy-loading')).toBeNull());
  if (!linked) {
    await fireEvent.press(r.getByTestId('role-choice-client'));
    await fireEvent.press(r.getByTestId('role-choice-continue'));
  }
  expect(r.getByText('Create your account.')).toBeTruthy();
  expect(r.getByText(/^Step \d+ of \d+$/)).toBeTruthy();
});
