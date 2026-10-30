/**
 * FR-913R2 class-first (LS-E4R2 B3): every way into Create account shows the
 * count of the client's own path (role, account, inbox; no role step from a
 * link or when the policy has no role choice). Flag off: no pill.
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
import { featureFlags } from '../../../config/featureFlags';
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

type Row = [string, { linked: boolean; roleChoice: boolean; role: 'client' | 'coach' | null; v2: boolean }, string | null, number];
const rows: Row[] = [
  ['role step', { linked: false, roleChoice: true, role: null, v2: true }, 'Step 1 of 3', 3],
  ['client after role', { linked: false, roleChoice: true, role: 'client', v2: true }, 'Step 2 of 3', 3],
  ['coach after role', { linked: false, roleChoice: true, role: 'coach', v2: true }, 'Step 2 of 3', 3],
  ['invite link', { linked: true, roleChoice: true, role: null, v2: true }, 'Step 1 of 2', 2],
  ['no role choice', { linked: false, roleChoice: false, role: null, v2: true }, 'Step 1 of 2', 2],
  ['flag off', { linked: false, roleChoice: true, role: 'client', v2: false }, null, 0],
];

it.each(rows)('%s: shows the true step count', async (_name, c, pill, bars) => {
  (featureFlags as { firstRunV2: boolean }).firstRunV2 = c.v2;
  mockGetSignupPolicy.mockResolvedValue({
    data: { invite_code_required: false, providers: ['email', 'google', 'apple'], role_choice: c.roleChoice },
  });
  const nav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), canGoBack: () => true };
  const r = await render(
    <CreateAccountScreen navigation={nav as never}
      route={c.linked ? { params: { invite_code: 'TGP-R8N3VW5' } } : undefined} />,
  );
  await waitFor(() => expect(r.queryByTestId('signup-policy-loading')).toBeNull());
  if (c.role) {
    await fireEvent.press(r.getByTestId(`role-choice-${c.role}`));
    await fireEvent.press(r.getByTestId('role-choice-continue'));
  }
  if (pill) expect(r.getByTestId('signup-step-pill')).toHaveTextContent(pill);
  else expect(r.queryByTestId('signup-step-pill')).toBeNull();
  expect(r.queryByTestId('signup-step-bars', { includeHiddenElements: true })?.children.length ?? 0).toBe(bars);
});
