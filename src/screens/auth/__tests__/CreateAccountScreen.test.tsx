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

const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: () => mockEmit() } }));

import CreateAccountScreen from '../CreateAccountScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

function makeNav() {
  return { replace: jest.fn(), navigate: jest.fn() };
}

async function renderScreen(params?: { invite_code?: string }, role: 'client' | 'coach' | null = 'client') {
  const nav = makeNav();
  const utils = await render(
    <CreateAccountScreen navigation={nav as never} route={params ? { params } : undefined} />,
  );
  await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
  // C13: without an invite code the first step is the role choice.
  if (!params?.invite_code && role) await fireEvent.press(await utils.findByTestId(`role-choice-${role}`));
  return { nav, ...utils };
}

describe('CreateAccountScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
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

  it('A1: policy GET failure keeps Google hidden but lets a no-code email signup reach the backend', async () => {
    mockGetSignupPolicy.mockRejectedValue(new Error('network'));
    mockRegister.mockResolvedValue({ data: { requires_verification: true } });
    const utils = await renderScreen();
    expect(await utils.findByText('INVITE CODE (OPTIONAL)')).toBeTruthy();
    expect(utils.queryByText('Continue with Google')).toBeNull();
    await fillAndSubmit(utils);
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(mockRegister.mock.calls[0][0]).toEqual({
      name: 'Pat Client',
      email: 'pat@example.com',
      password: 'Str0ng!pass',
      phone: undefined,
    });
    expect(await utils.findByText('I verified my email')).toBeTruthy();
  });

  it('A1: an explicit required-code policy is still enforced', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email'] } });
    const utils = await renderScreen();
    expect(await utils.findByText('INVITE CODE')).toBeTruthy();
    await fillAndSubmit(utils);
    expect(await utils.findByText('An invite code from your coach is required to join.')).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('A2: a permanent CoachProfile GP- code passes preflight via the public preview (validate would reject it)', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley' } });
    mockValidate.mockResolvedValue({ data: { valid: false, reason: 'not_found' } });
    mockSignupWithCode.mockResolvedValue({ data: { requires_verification: true, invite_attached: true } });
    const utils = await renderScreen({ invite_code: 'GP-BRADLEY' });
    await fillAndSubmit(utils);
    await waitFor(() => expect(mockSignupWithCode).toHaveBeenCalledTimes(1));
    expect(mockSignupWithCode.mock.calls[0][0]).toMatchObject({ invite_code: 'GP-BRADLEY' });
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('A2: a code the preview reports invalid is stopped before signup', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockPreview.mockResolvedValue({ data: { valid: false } });
    const utils = await renderScreen({ invite_code: 'GP-NOPE' });
    await fillAndSubmit(utils);
    expect(await utils.findByText('That invite code is not valid. Please check with your coach.')).toBeTruthy();
    expect(mockSignupWithCode).not.toHaveBeenCalled();
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

  describe('C13 role choice', () => {
    it('no invite code: role choice comes first', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      const utils = await renderScreen(undefined, null);
      expect(await utils.findByTestId('role-choice')).toBeTruthy();
      expect(utils.getByText("I'm here to train")).toBeTruthy();
      expect(utils.getByText('I coach clients')).toBeTruthy();
      expect(utils.queryByTestId('invite-code-input')).toBeNull();
    });

    it('arriving with an invite / QR code skips the choice (always a client)', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      const utils = await renderScreen({ invite_code: 'GP-PNW1' });
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.getByTestId('invite-code-input')).toBeTruthy();
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
    });

    it('client choice sends intended_role client on /auth/register', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      mockRegister.mockResolvedValue({ data: {} });
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][1]).toBe('client');
    });

    it('coach choice: no invite field, intended_role coach, and a server-confirmed coach skips RoleSelection', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email'] } });
      mockRegister.mockResolvedValue({ data: {} });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'coach' } } });
      const utils = await renderScreen(undefined, 'coach');
      expect(utils.getByText('Create your coach account')).toBeTruthy();
      expect(utils.queryByTestId('invite-code-input')).toBeNull();
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][0]).not.toHaveProperty('invite_code');
      expect(mockRegister.mock.calls[0][1]).toBe('coach');
      await fireEvent.press(await utils.findByText('I verified my email'));
      await waitFor(() => expect(mockEmit).toHaveBeenCalled());
      expect(utils.nav.replace).not.toHaveBeenCalled();
    });

    it('coach choice ignored by the current backend: falls back to RoleSelection with a plain notice', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      mockRegister.mockResolvedValue({ data: {} });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      const utils = await renderScreen(undefined, 'coach');
      await fillAndSubmit(utils);
      await fireEvent.press(await utils.findByText('I verified my email'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { coachRequestPending: true }),
      );
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});

