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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
const mockSignInWithGoogle = jest.fn();
jest.mock('../../../utils/googleAuth', () => ({
  signInWithGoogle: (...a: unknown[]) => mockSignInWithGoogle(...a),
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
  secureStorage: {
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
  },
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
import { __resetSignupPolicyCacheForTests, loadSignupPolicy } from '../../../lib/signupPolicy';
import { secureStorage } from '../../../services/secureStorage';
import { CoachSignupUnavailableError } from '../../../lib/intendedRole';
import { SIGNUP_ROLE_NOTICE_KEY } from '../../../lib/signupRoleNotice';

function makeNav() {
  return { replace: jest.fn(), navigate: jest.fn() };
}

// Live policy WITH the C13 role choice (backend #597).
const ROLE_CHOICE_POLICY = {
  invite_code_required: false,
  providers: ['email', 'apple'],
  role_choice: true,
  role_choice_field: 'intended_role',
  role_choice_values: ['client', 'coach'],
};

async function renderScreen(params?: { invite_code?: string }, role: 'client' | 'coach' | null = 'client') {
  const nav = makeNav();
  const utils = await render(
    <CreateAccountScreen navigation={nav as never} route={params ? { params } : undefined} />,
  );
  await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
  // The form (or the role step) is held back until the policy answers.
  await waitFor(() => expect(utils.queryByTestId('signup-policy-loading')).toBeNull());
  // C13: without an invite code, and only when the live policy advertises
  // role_choice, the first step is the role choice.
  if (!params?.invite_code && role && utils.queryByTestId('role-choice')) {
    await fireEvent.press(utils.getByTestId(`role-choice-${role}`));
  }
  return { nav, ...utils };
}

describe('CreateAccountScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
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

  describe('C13 role choice (policy-gated, backend #597)', () => {
    it('F1: the current production policy (no role_choice) never shows the role step and never sends intended_role', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'apple'] } });
      mockRegister.mockResolvedValue({ data: { requires_verification: true } });
      const utils = await renderScreen(undefined, null);
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
      expect(utils.getByText('Join your coach')).toBeTruthy();
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][1]).toBeUndefined();
    });

    it('F1: role_choice:false (kill switch) behaves like the production policy', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, role_choice: false } });
      const utils = await renderScreen(undefined, null);
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.getByLabelText('Full name')).toBeTruthy();
    });

    it('F1: a descriptor this build does not speak hides the step too', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, role_choice_field: 'requested_role' } });
      const utils = await renderScreen(undefined, null);
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.getByLabelText('Full name')).toBeTruthy();
    });

    it('F1: a failed policy GET with nothing cached never asks the role question', async () => {
      mockGetSignupPolicy.mockRejectedValue(new Error('network'));
      mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'u1', role: 'student' } });
      const utils = await renderScreen(undefined, null);
      expect(utils.queryByTestId('role-choice')).toBeNull();
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
      expect(mockSignInWithApple.mock.calls[0][0]).toEqual({ inviteCode: undefined, intendedRole: undefined });
    });

    it('the form is held back until the policy answers', async () => {
      let resolvePolicy: (v: unknown) => void = () => undefined;
      mockGetSignupPolicy.mockReturnValue(new Promise((r) => (resolvePolicy = r)));
      const nav = makeNav();
      const utils = await render(<CreateAccountScreen navigation={nav as never} route={undefined} />);
      expect(utils.getByTestId('signup-policy-loading')).toBeTruthy();
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.queryByLabelText('Full name')).toBeNull();
      resolvePolicy({ data: ROLE_CHOICE_POLICY });
      expect(await utils.findByTestId('role-choice')).toBeTruthy();
    });

    it('role_choice:true, no invite code: role choice comes first', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      const utils = await renderScreen(undefined, null);
      expect(await utils.findByTestId('role-choice')).toBeTruthy();
      expect(utils.getByText("I'm here to train")).toBeTruthy();
      expect(utils.getByText('I coach clients')).toBeTruthy();
      expect(utils.queryByTestId('invite-code-input')).toBeNull();
    });

    it('arriving with an invite / QR code skips the choice even when role_choice is on (always a client)', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignupWithCode.mockResolvedValue({ data: { requires_verification: true, invite_attached: true } });
      const utils = await renderScreen({ invite_code: 'GP-PNW1' });
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.getByTestId('invite-code-input')).toBeTruthy();
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockSignupWithCode).toHaveBeenCalledTimes(1));
      expect(mockSignupWithCode.mock.calls[0][0]).not.toHaveProperty('intended_role');
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('client choice sends intended_role client on /auth/register', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockRegister.mockResolvedValue({ data: { role: 'student' } });
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][1]).toBe('client');
      expect(utils.queryByTestId('coach-request-not-applied-notice')).toBeNull();
    });

    it('coach choice: no invite field, intended_role coach, and a server-confirmed coach skips RoleSelection', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, invite_code_required: true } });
      mockRegister.mockResolvedValue({ data: { requires_verification: true, role: 'coach' } });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'coach' } } });
      const utils = await renderScreen(undefined, 'coach');
      expect(utils.getByText('Create your coach account')).toBeTruthy();
      expect(utils.queryByTestId('invite-code-input')).toBeNull();
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][0]).not.toHaveProperty('invite_code');
      expect(mockRegister.mock.calls[0][1]).toBe('coach');
      expect(utils.queryByTestId('coach-request-not-applied-notice')).toBeNull();
      await fireEvent.press(await utils.findByText('I verified my email'));
      await waitFor(() => expect(mockEmit).toHaveBeenCalled());
      expect(utils.nav.replace).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
    });

    it('F2/F4: coach request the server created as a client is said on the verify step, persisted, and repeated on RoleSelection', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockRegister.mockResolvedValue({ data: { requires_verification: true, role: 'student' } });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      const utils = await renderScreen(undefined, 'coach');
      await fillAndSubmit(utils);
      expect(await utils.findByTestId('coach-request-not-applied-notice')).toBeTruthy();
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('coach_request_not_applied');
      await fireEvent.press(utils.getByText('I verified my email'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'coach_request_not_applied' }),
      );
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('F2: a coach request the backend refuses (unknown field) creates NOTHING and never falls back to a client signup', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockRegister.mockRejectedValue(new CoachSignupUnavailableError());
      const utils = await renderScreen(undefined, 'coach');
      await fillAndSubmit(utils);
      expect(await utils.findByText(/Coach sign-up is not available right now. No account was created./)).toBeTruthy();
      expect(mockRegister).toHaveBeenCalledTimes(1);
      expect(mockRegister.mock.calls[0][1]).toBe('coach');
      expect(utils.queryByText('I verified my email')).toBeNull();
      expect(utils.nav.replace).not.toHaveBeenCalled();
    });

    it('F3: Apple on the coach form sends intended_role coach only after the choice; a refusal is plain copy, no account', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple.mockResolvedValue({ success: false, error: 'x', error_code: 'coach_signup_unavailable' });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
      expect(mockSignInWithApple.mock.calls[0][0]).toEqual({ inviteCode: undefined, intendedRole: 'coach' });
      expect(await utils.findByText(/Coach sign-up is not available right now/)).toBeTruthy();
      expect(utils.nav.replace).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('Apple coach signup honoured by the server (role coach) goes straight to the app', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'c1', role: 'coach' } });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockEmit).toHaveBeenCalled());
      expect(utils.nav.replace).not.toHaveBeenCalled();
    });

    it('F4: Apple coach choice on an EXISTING provider account: signed in, and told the choice did not apply', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: false, user: { id: 'u1', role: 'student' } });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'existing_account' }),
      );
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('existing_account');
    });

    it('F4: Apple coach choice on a NEW account the server made a client: notice, not silence', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'u1', role: 'student' } });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'coach_request_not_applied' }),
      );
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('coach_request_not_applied');
    });

    it('F5: a typed invite code means client: the coach link disappears, no intended_role, and Apple carries the code', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'u1', role: 'student', coach_id: 'c1' } });
      const utils = await renderScreen();
      expect(utils.getByTestId('role-choice-change')).toBeTruthy();
      await fireEvent.changeText(utils.getByTestId('invite-code-input'), 'GP-PNW1');
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
      expect(utils.getByTestId('invite-code-means-client')).toBeTruthy();
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
      expect(mockSignInWithApple.mock.calls[0][0]).toEqual({ inviteCode: 'GP-PNW1', intendedRole: undefined });
      await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    });

    it('F5: a typed code goes to /auth/signup-with-code (never /auth/register) and is carried to the retry step', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignupWithCode.mockResolvedValue({
        data: { requires_verification: true, invite_attached: false, invite_attach_error: 'coach_inactive' },
      });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      const utils = await renderScreen();
      await fireEvent.changeText(utils.getByTestId('invite-code-input'), 'GP-PNW1');
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockSignupWithCode).toHaveBeenCalledTimes(1));
      expect(mockRegister).not.toHaveBeenCalled();
      await fireEvent.press(await utils.findByText('I verified my email'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
          inviteAttachError: 'coach_inactive',
          inviteCode: 'GP-PNW1',
        }),
      );
    });

    it('F5: Google with a typed code the backend did not attach carries the code to the retry step', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'google', 'apple'] } });
      mockSignInWithGoogle.mockResolvedValue({
        success: true,
        is_new_user: true,
        user: { id: 'u1' },
        invite_attached: false,
        invite_code: 'GP-PNW1',
      });
      const utils = await renderScreen();
      await fireEvent.changeText(utils.getByTestId('invite-code-input'), 'GP-PNW1');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1));
      expect(mockSignInWithGoogle.mock.calls[0][0]).toEqual({ inviteCode: 'GP-PNW1', intendedRole: undefined });
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
          inviteAttachError: 'unknown',
          inviteCode: 'GP-PNW1',
        }),
      );
    });

    it('Google coach choice: intended_role coach; a refusal is plain copy and no account', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'google'] } });
      mockSignInWithGoogle.mockResolvedValue({ success: false, error: 'x', error_code: 'coach_signup_unavailable' });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1));
      expect(mockSignInWithGoogle.mock.calls[0][0]).toEqual({ inviteCode: undefined, intendedRole: 'coach' });
      expect(await utils.findByText(/Coach sign-up is not available right now/)).toBeTruthy();
      expect(utils.nav.replace).not.toHaveBeenCalled();
    });

    it('a join link arriving while the coach form is open switches to the client form with the code filled', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      const nav = makeNav();
      const utils = await render(<CreateAccountScreen navigation={nav as never} route={undefined} />);
      await fireEvent.press(await utils.findByTestId('role-choice-coach'));
      expect(utils.getByText('Create your coach account')).toBeTruthy();
      utils.rerender(
        <CreateAccountScreen navigation={nav as never} route={{ params: { invite_code: 'GP-QR1' } }} />,
      );
      expect(await utils.findByText('Join your coach')).toBeTruthy();
      expect(utils.getByTestId('invite-code-input').props.value).toBe('GP-QR1');
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
    });

    it('switching back to the choice keeps the form, and the client form keeps the code field', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('role-choice-change'));
      await fireEvent.press(await utils.findByTestId('role-choice-client'));
      expect(await utils.findByText('Join your coach')).toBeTruthy();
      expect(utils.getByTestId('invite-code-input')).toBeTruthy();
    });
  });
  // Fix round 2: reproductions of the independent audits at b21b89b5
  // (Sol B1/B2, Opus C1/C2/C4). Each test failed on that head.
  describe('#306 fix round 2', () => {
    const CREATED_AS_CLIENT = /created as a client account/;

    // Cached policy says role choice is on; the live GET is held so the test
    // decides when (and with what) it answers.
    async function renderWithCachedPolicyAndPendingLive() {
      await loadSignupPolicy(async () => ({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'apple', 'google'] } }));
      let resolveLive: (v: unknown) => void = () => undefined;
      mockGetSignupPolicy.mockReturnValueOnce(new Promise((r) => { resolveLive = r; }));
      const nav = makeNav();
      const utils = await render(<CreateAccountScreen navigation={nav as never} route={undefined} />);
      await fireEvent.press(utils.getByTestId('role-choice-coach'));
      expect(utils.getByText('Create your coach account')).toBeTruthy();
      const disableLive = async () => {
        await act(async () => {
          resolveLive({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'apple', 'google'], role_choice: false } });
        });
      };
      return { nav, utils, disableLive };
    }

    it('Sol B1: Google coach signup with an unconfirmed backend outcome is a truthful failure, never "created as a client"', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'google'] } });
      mockSignInWithGoogle.mockResolvedValue({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      expect(await utils.findByText(/We could not confirm your coach account/)).toBeTruthy();
      expect(utils.queryByText(CREATED_AS_CLIENT)).toBeNull();
      expect(utils.queryByText(/No account was created/)).toBeNull();
      expect(utils.nav.replace).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
    });

    it('Sol B1: a provider success WITHOUT a server role on the coach form is not reported as a client account; the session is dropped', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'google'] } });
      // The shape the pre-fix Google fallback produced: basic user, no role.
      mockSignInWithGoogle.mockResolvedValue({
        success: true, is_new_user: true, server_confirmed: false, user: { id: 'u1', email: 'a@b.c', name: 'A' },
      });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      expect(await utils.findByText(/We could not confirm your coach account/)).toBeTruthy();
      expect(utils.nav.replace).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
      expect(secureStorage.removeItem).toHaveBeenCalledWith('supabase_token');
    });

    it('Sol B1: same rule for Apple (success with no server role on the coach form)', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'u1' } });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('apple-button'));
      expect(await utils.findByText(/We could not confirm your coach account/)).toBeTruthy();
      expect(utils.nav.replace).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
    });

    it('Sol B2 (email): cached-enabled -> chose coach -> live disabled: user is told, nothing is submitted, client needs an explicit choice', async () => {
      const { utils, disableLive } = await renderWithCachedPolicyAndPendingLive();
      mockRegister.mockResolvedValue({ data: { requires_verification: true, role: 'student' } });
      await disableLive();
      expect(await utils.findByTestId('coach-choice-withdrawn-notice')).toBeTruthy();
      expect(utils.getByText(/No account has been created/)).toBeTruthy();
      // The form is gone, so nothing can be submitted as a client by accident.
      expect(utils.queryByLabelText('Create account')).toBeNull();
      expect(utils.queryByLabelText('Full name')).toBeNull();
      expect(mockRegister).not.toHaveBeenCalled();
      // Explicit re-choice: only now does a client registration go out.
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-client'));
      expect(await utils.findByText('Join your coach')).toBeTruthy();
      await fillAndSubmit(utils as never);
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][1]).toBeUndefined();
    });

    it('Sol B2 (providers): after the live disable neither Apple nor Google can run until the user chooses', async () => {
      const { utils, disableLive } = await renderWithCachedPolicyAndPendingLive();
      await disableLive();
      expect(await utils.findByTestId('coach-choice-withdrawn-notice')).toBeTruthy();
      expect(utils.queryByTestId('apple-button')).toBeNull();
      expect(utils.queryByText('Continue with Google')).toBeNull();
      expect(mockSignInWithApple).not.toHaveBeenCalled();
      expect(mockSignInWithGoogle).not.toHaveBeenCalled();
    });

    it('Sol B2: "Check again" returns to the coach form when coach sign-up is back, and says so when it is not', async () => {
      const { utils, disableLive } = await renderWithCachedPolicyAndPendingLive();
      await disableLive();
      await utils.findByTestId('coach-choice-withdrawn-notice');
      mockGetSignupPolicy.mockResolvedValueOnce({ data: { ...ROLE_CHOICE_POLICY, role_choice: false } });
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-recheck'));
      expect(await utils.findByTestId('coach-choice-recheck-note')).toBeTruthy();
      mockGetSignupPolicy.mockResolvedValueOnce({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'c1', role: 'coach' } });
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-recheck'));
      expect(await utils.findByText('Create your coach account')).toBeTruthy();
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
      expect(mockSignInWithApple.mock.calls[0][0]).toEqual({ inviteCode: undefined, intendedRole: 'coach' });
    });

    it('B2 boundary: a live disable before any coach choice still continues as a client (no choice was made)', async () => {
      await loadSignupPolicy(async () => ({ data: ROLE_CHOICE_POLICY }));
      let resolveLive: (v: unknown) => void = () => undefined;
      mockGetSignupPolicy.mockReturnValueOnce(new Promise((r) => { resolveLive = r; }));
      const utils = await render(<CreateAccountScreen navigation={makeNav() as never} route={undefined} />);
      expect(utils.getByTestId('role-choice')).toBeTruthy();
      await act(async () => {
        resolveLive({ data: { ...ROLE_CHOICE_POLICY, role_choice: false } });
      });
      expect(await utils.findByText('Join your coach')).toBeTruthy();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
    });

    it('Opus C4: the "contact support" notice on the verify step links to the in-app support screen', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockRegister.mockResolvedValue({ data: { requires_verification: true, role: 'student' } });
      const utils = await renderScreen(undefined, 'coach');
      await fillAndSubmit(utils);
      await fireEvent.press(await utils.findByTestId('coach-request-not-applied-support'));
      expect(utils.nav.navigate).toHaveBeenCalledWith('SupportInbox');
    });
  });
});
