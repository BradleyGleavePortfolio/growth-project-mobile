/**
 * CreateAccountScreen (C02/C03/C10 mobile side), behavioural.
 *
 *  - Signup policy is read from `invite_code_required` + `providers`
 *    (live backend shape), with Google only when providers has 'google'.
 *  - "Paste invite code" fills the field from a GP code or a /join URL.
 *  - `invite_attached:false` after signup routes to the RoleSelection
 *    enter-code retry step (with the reason) instead of continuing silently.
 *  - Apple failures show friendly copy, never the raw server message.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
const mockSignupWithCode = jest.fn();
const mockValidate = jest.fn();
const mockPreview = jest.fn();
const mockLogin = jest.fn();
const mockRegister = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    signupWithCode: (...a: unknown[]) => mockSignupWithCode(...a),
    validateInviteCode: (...a: unknown[]) => mockValidate(...a),
    getInvitePreview: (...a: unknown[]) => mockPreview(...a),
    login: (...a: unknown[]) => mockLogin(...a),
    register: (...a: unknown[]) => mockRegister(...a),
  },
}));

const mockGetString = jest.fn();
jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockGetString() }));

const mockSignInWithApple = jest.fn();
jest.mock('../../../utils/appleAuth', () => ({
  signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a),
}));

jest.mock('../../../components/AppleSignInButton', () => {
  const { TouchableOpacity, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ onPress }: { onPress: () => void }) => (
      <TouchableOpacity testID="apple-button" onPress={onPress}>
        <Text>Apple</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../../services/secureStorage', () => ({
  secureStorage: { setItem: jest.fn(() => Promise.resolve()), getItem: jest.fn(() => Promise.resolve(null)) },
}));
jest.mock('../../../lib/userCache', () => ({ setUserCache: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../services/queryClient', () => ({
  purgePersistedQueryCacheForAllUsers: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import CreateAccountScreen from '../CreateAccountScreen';

function makeNav() {
  return { replace: jest.fn(), navigate: jest.fn() };
}

async function renderScreen(params?: { invite_code?: string }) {
  const nav = makeNav();
  const utils = await render(
    <CreateAccountScreen navigation={nav as never} route={params ? { params } : undefined} />,
  );
  await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
  return { nav, ...utils };
}

describe('CreateAccountScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley' } });
    mockValidate.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley' } });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('live policy (providers email+apple): hides Google and marks the code optional', async () => {
    mockGetSignupPolicy.mockResolvedValue({
      data: { invite_code_required: false, coach_code_required: false, providers: ['email', 'apple'] },
    });
    const { queryByText, findByText } = await renderScreen();
    expect(await findByText('INVITE CODE (OPTIONAL)')).toBeTruthy();
    expect(queryByText('Continue with Google')).toBeNull();
  });

  it('shows Google only when providers includes google', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email', 'google', 'apple'] } });
    const { findByText } = await renderScreen();
    expect(await findByText('Continue with Google')).toBeTruthy();
    expect(await findByText('INVITE CODE')).toBeTruthy();
  });

  it('falls back to legacy names when canonical ones are absent', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { require_invite_code: false, google_signin_enabled: true } });
    const { findByText } = await renderScreen();
    expect(await findByText('INVITE CODE (OPTIONAL)')).toBeTruthy();
    expect(await findByText('Continue with Google')).toBeTruthy();
  });

  it('policy failure is strict: code required, Google hidden', async () => {
    mockGetSignupPolicy.mockRejectedValue(new Error('network'));
    const { findByText, queryByText } = await renderScreen();
    expect(await findByText('INVITE CODE')).toBeTruthy();
    expect(queryByText('Continue with Google')).toBeNull();
  });

  it('paste invite code accepts a /join/<code> URL', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockGetString.mockResolvedValue('https://app.trygrowthproject.com/join/gp-pnw1?src=poster');
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('paste-invite-code'));
    await waitFor(() => expect(getByTestId('invite-code-input').props.value).toBe('GP-PNW1'));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('GP-PNW1'));
  });

  it('paste with no code on the clipboard shows guidance and leaves the field empty', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockGetString.mockResolvedValue('see you at the clinic!');
    const { getByTestId, findByText } = await renderScreen();
    await fireEvent.press(getByTestId('paste-invite-code'));
    expect(await findByText(/could not find an invite code on your clipboard/i)).toBeTruthy();
    expect(getByTestId('invite-code-input').props.value).toBe('');
  });

  async function fillAndSubmit(utils: Awaited<ReturnType<typeof renderScreen>>) {
    await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Client');
    await fireEvent.changeText(utils.getByLabelText('Email'), 'pat@example.com');
    await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
    await fireEvent.press(utils.getByLabelText('Create account'));
  }

  it('invite_attached:false routes to the RoleSelection retry step after verification', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockSignupWithCode.mockResolvedValue({
      data: { requires_verification: true, invite_attached: false, invite_attach_error: 'coach_inactive' },
    });
    mockLogin.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } } });
    const utils = await renderScreen({ invite_code: 'GP-PNW1' });
    await fillAndSubmit(utils);
    expect(await utils.findByTestId('invite-attach-pending-notice')).toBeTruthy();
    await fireEvent.press(utils.getByText('I verified my email'));
    await waitFor(() =>
      expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
        inviteAttachError: 'coach_inactive',
        inviteCode: 'GP-PNW1',
      }),
    );
  });

  it('successful attach continues to RoleSelection with no retry params', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockSignupWithCode.mockResolvedValue({ data: { requires_verification: true, invite_attached: true } });
    mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1' } } });
    const utils = await renderScreen({ invite_code: 'GP-PNW1' });
    await fillAndSubmit(utils);
    await fireEvent.press(await utils.findByText('I verified my email'));
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    expect(utils.queryByTestId('invite-attach-pending-notice')).toBeNull();
  });

  it('Apple failure shows friendly copy, not the raw server message', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'apple'] } });
    mockSignInWithApple.mockResolvedValue({ success: false, error: 'property identity_token should not exist' });
    const utils = await renderScreen();
    await fireEvent.press(utils.getByTestId('apple-button'));
    expect(await utils.findByText(/Sign in with Apple didn’t go through/)).toBeTruthy();
    expect(utils.queryByText(/identity_token/)).toBeNull();
    expect(utils.nav.replace).not.toHaveBeenCalled();
  });

  it('Apple success with invite_attached:false routes to the retry step', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'apple'] } });
    mockSignInWithApple.mockResolvedValue({ success: true, invite_attached: false, invite_attach_error: 'expired' });
    const utils = await renderScreen({ invite_code: 'GP-OLD1' });
    await fireEvent.press(utils.getByTestId('apple-button'));
    await waitFor(() =>
      expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
        inviteAttachError: 'expired',
        inviteCode: 'GP-OLD1',
      }),
    );
  });

  it('codeless policy: email signup with NO invite code registers and continues to RoleSelection', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'apple'] } });
    mockRegister.mockResolvedValue({ data: { requires_verification: true } });
    mockLogin.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } } });
    const utils = await renderScreen();
    await fillAndSubmit(utils);
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(mockRegister.mock.calls[0][0]).not.toHaveProperty('invite_code');
    expect(mockSignupWithCode).not.toHaveBeenCalled();
    await fireEvent.press(await utils.findByText('I verified my email'));
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
  });
});

