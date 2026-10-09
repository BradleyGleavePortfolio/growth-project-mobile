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
import { Alert, Linking, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
const mockSignupWithCode = jest.fn();
const mockValidate = jest.fn();
const mockPreview = jest.fn();
const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockResend = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    resendVerification: (...a: unknown[]) => mockResend(...a),
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    signupWithCode: (...a: unknown[]) => mockSignupWithCode(...a),
    validateInviteCode: (...a: unknown[]) => mockValidate(...a),
    getInvitePreview: (...a: unknown[]) => mockPreview(...a),
    login: (...a: unknown[]) => mockLogin(...a),
    register: (...a: unknown[]) => mockRegister(...a),
  },
}));

const mockGetString = jest.fn();
const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({
  getStringAsync: () => mockGetString(),
  setStringAsync: (...a: unknown[]) => mockSetString(...a),
}));

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
let mockSemanticColors: import('../../../theme/tokens').SemanticTokens;
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: mockSemanticColors }),
}));

const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: () => mockEmit() } }));

import CreateAccountScreen from '../CreateAccountScreen';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../../../config/env';
import { __resetSignupPolicyCacheForTests, loadSignupPolicy } from '../../../lib/signupPolicy';
import { secureStorage } from '../../../services/secureStorage';
import { CoachSignupUnavailableError } from '../../../lib/intendedRole';
import { SIGNUP_ROLE_NOTICE_KEY } from '../../../lib/signupRoleNotice';
import { COACH_SIGNUP_UNCONFIRMED_KEY, rememberUnconfirmedCoachSignup } from '../../../lib/coachSignupAttempt';
import { darkTokens, lightTokens } from '../../../theme/tokens';

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

// Prototype ROLE (01): a row tap selects, Continue commits.
async function chooseRole(utils: { findByTestId: (id: string) => Promise<unknown>; getByTestId: (id: string) => unknown }, role: 'client' | 'coach') {
  await fireEvent.press((await utils.findByTestId(`role-choice-${role}`)) as never);
  await fireEvent.press(utils.getByTestId('role-choice-continue') as never);
}

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
    await chooseRole(utils, role);
  }
  return { nav, ...utils };
}

describe('CreateAccountScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSemanticColors = lightTokens;
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
    mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley' } });
    mockValidate.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley' } });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it.each([lightTokens, darkTokens])('uses the active semantic theme, hairline fields and readable type (%#)', async (palette) => {
    mockSemanticColors = palette;
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'google', 'apple'] } });
    const ui = await renderScreen();
    const root = ui.toJSON();
    expect(root && !Array.isArray(root) ? StyleSheet.flatten(root.props.style).backgroundColor : null).toBe(palette.bgPrimary);
    expect(StyleSheet.flatten(ui.getByText('Create your account.').props.style)).toMatchObject({
      fontFamily: 'CormorantGaramond_400Regular', fontWeight: '400', color: palette.textPrimary,
    });
    expect(StyleSheet.flatten(ui.getByText('FULL NAME').props.style)).toMatchObject({
      fontFamily: 'Inter_500Medium', letterSpacing: 1.98, color: palette.textMuted,
    });
    for (const label of ['Full name', 'Email', 'Password', 'Phone number, optional', 'Coach invite code']) {
      const style = StyleSheet.flatten(ui.getByLabelText(label).props.style);
      expect(style).toMatchObject({
        fontFamily: 'Inter_400Regular', fontSize: 16, minHeight: 52,
        borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border, color: palette.textPrimary,
      });
      expect(style.backgroundColor).toBeUndefined();
      expect(style.shadowOpacity).toBeUndefined();
      expect(ui.getByLabelText(label).props.placeholderTextColor).toBe(palette.textMuted);
    }
    expect(StyleSheet.flatten(ui.getByLabelText('Create account').props.style)).toMatchObject({
      backgroundColor: palette.accent, minHeight: 54, borderRadius: 12,
    });
    expect(StyleSheet.flatten(ui.getByText('Create account').props.style).color).toBe(palette.textOnAccent);
    expect(StyleSheet.flatten(ui.getByLabelText('Continue with Google').props.style).backgroundColor).toBeUndefined();
  });

  it('visual redo keeps every registration field, provider, legal link and sign-in action reachable', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'google', 'apple'] } });
    mockGetString.mockResolvedValue('GP-TEST');
    mockSignInWithGoogle.mockResolvedValue({ success: false, cancelled: true });
    mockSignInWithApple.mockResolvedValue({ success: false, cancelled: true });
    mockSignupWithCode.mockResolvedValue({ data: { requires_verification: true } });
    const ui = await renderScreen();
    for (const label of ['Full name', 'Email', 'Password', 'Phone number, optional', 'Coach invite code']) {
      expect(ui.getByLabelText(label)).toBeTruthy();
    }
    expect(ui.getByTestId('create-account-terms-link')).toBeTruthy();
    expect(ui.getByTestId('create-account-privacy-link')).toBeTruthy();
    await fireEvent.press(ui.getByLabelText('Continue with Google'));
    await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalled());
    await fireEvent.press(ui.getByTestId('apple-button'));
    await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalled());
    await fireEvent.press(ui.getByLabelText('Sign in'));
    expect(ui.nav.navigate).toHaveBeenCalledWith('Login');
    await fireEvent.press(ui.getByTestId('paste-invite-code'));
    await waitFor(() => expect(ui.getByTestId('invite-code-input').props.value).toBe('GP-TEST'));
    await fireEvent.changeText(ui.getByLabelText('Phone number, optional'), '07123456789');
    await fillAndSubmit(ui);
    await waitFor(() => expect(mockSignupWithCode).toHaveBeenCalled());
    expect(mockSignupWithCode.mock.calls[0][0]).toMatchObject({ invite_code: 'GP-TEST', phone: '07123456789' });
    expect(await ui.findByText('I verified my email')).toBeTruthy();
    await fireEvent.press(ui.getByText('Use a different email'));
    expect(await ui.findByLabelText('Create account')).toBeTruthy();
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

  it('B-IOSREV-2: states the Terms and Privacy agreement in the pinned footer, with both links', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'apple'] } });
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { findByTestId, getByTestId } = await renderScreen();
    const line = await findByTestId('create-account-legal');
    const flat = (node: unknown): string =>
      typeof node === 'string'
        ? node
        : Array.isArray(node)
          ? node.map(flat).join('')
          : node && typeof node === 'object' && 'props' in node
            ? flat((node as { props: { children?: unknown } }).props.children)
            : '';
    expect(flat(line.props.children)).toBe(
      'By continuing, you agree to the Terms of Service and the Privacy Policy.',
    );
    await fireEvent.press(getByTestId('create-account-terms-link'));
    expect(openUrl).toHaveBeenCalledWith(TERMS_URL);
    await fireEvent.press(getByTestId('create-account-privacy-link'));
    expect(openUrl).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
    openUrl.mockRestore();
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
    expect(await utils.findByText('That invite code is not valid. Check it with your coach, or clear the field to sign up without one.')).toBeTruthy();
    expect(mockSignupWithCode).not.toHaveBeenCalled();
  });

  it('paste invite code accepts a /join/<code> URL', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockGetString.mockResolvedValue('https://app.trygrowthproject.com/join/gp-test1?src=poster');
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('paste-invite-code'));
    await waitFor(() => expect(getByTestId('invite-code-input').props.value).toBe('GP-TEST1'));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('GP-TEST1'));
  });

  it('COACH-CARD-134: the paired line carries the coach headline and specialties', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockGetString.mockResolvedValue('GP-TEST1');
    mockPreview.mockResolvedValue({
      data: { valid: true, coach_name: 'Bradley', headline: 'Calm, steady strength', specialties: ['older', 'other', 'mobility'] },
    });
    const { getByTestId, findByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('paste-invite-code'));
    expect(await findByTestId('create-coach-card-headline')).toHaveTextContent('Calm, steady strength');
    expect(getByTestId('create-coach-card-specialties')).toHaveTextContent('Specialises in older adults and mobility.');
  });

  it('COACH-CARD-134: a coach who skipped the card fields leaves no blank rows', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockGetString.mockResolvedValue('GP-TEST1');
    const { getByTestId, findByText, queryByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('paste-invite-code'));
    expect(await findByText(/You will be paired with/)).toBeTruthy();
    expect(queryByTestId('create-coach-card')).toBeNull();
  });

  it('paste with no code on the clipboard shows guidance and leaves the field empty', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockGetString.mockResolvedValue('see you at the clinic!');
    const { getByTestId, findByText } = await renderScreen();
    await fireEvent.press(getByTestId('paste-invite-code'));
    expect(await findByText(/No invite code was found on your clipboard/i)).toBeTruthy();
    expect(getByTestId('invite-code-input').props.value).toBe('');
  });

  async function fillAndSubmit(utils: Awaited<ReturnType<typeof renderScreen>>) {
    await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Client');
    await fireEvent.changeText(utils.getByLabelText('Email'), 'pat@example.com');
    await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
    await fireEvent.press(utils.getByLabelText('Create account'));
  }

  it('FW-ONB-128 B1: the verify step sends a new link to the stored address', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockSignupWithCode.mockResolvedValue({ data: { requires_verification: true } });
    mockResend.mockResolvedValue({ data: { message: 'Verification request submitted.' } });
    const ui = await renderScreen();
    await fillAndSubmit(ui);
    expect(await ui.findByText('I verified my email')).toBeTruthy();
    await fireEvent.press(ui.getByLabelText('Send a new link'));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith('pat@example.com'));
    expect(await ui.findByText(/If an account is waiting for confirmation, a new link is on its way/)).toBeTruthy();
    expect(ui.getByText('Use a different email')).toBeTruthy();
  });

  it('invite_attached:false routes to the RoleSelection retry step after verification', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockSignupWithCode.mockResolvedValue({
      data: { requires_verification: true, invite_attached: false, invite_attach_error: 'coach_inactive' },
    });
    mockLogin.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } } });
    const utils = await renderScreen({ invite_code: 'GP-TEST1' });
    await fillAndSubmit(utils);
    expect(await utils.findByTestId('invite-attach-pending-notice')).toBeTruthy();
    await fireEvent.press(utils.getByText('I verified my email'));
    await waitFor(() =>
      expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
        inviteAttachError: 'coach_inactive',
        inviteCode: 'GP-TEST1',
      }),
    );
  });

  it('successful attach continues to RoleSelection with no retry params', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    mockSignupWithCode.mockResolvedValue({ data: { requires_verification: true, invite_attached: true } });
    mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1' } } });
    const utils = await renderScreen({ invite_code: 'GP-TEST1' });
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
      expect(utils.getByText('Create your account.')).toBeTruthy();
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
      const utils = await renderScreen({ invite_code: 'GP-TEST1' });
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
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
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
      await fireEvent.changeText(utils.getByTestId('invite-code-input'), 'GP-TEST1');
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
      expect(utils.getByTestId('invite-code-means-client')).toBeTruthy();
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
      expect(mockSignInWithApple.mock.calls[0][0]).toEqual({ inviteCode: 'GP-TEST1', intendedRole: undefined });
      await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    });

    it('F5: a typed code goes to /auth/signup-with-code (never /auth/register) and is carried to the retry step', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignupWithCode.mockResolvedValue({
        data: { requires_verification: true, invite_attached: false, invite_attach_error: 'coach_inactive' },
      });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      const utils = await renderScreen();
      await fireEvent.changeText(utils.getByTestId('invite-code-input'), 'GP-TEST1');
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockSignupWithCode).toHaveBeenCalledTimes(1));
      expect(mockRegister).not.toHaveBeenCalled();
      await fireEvent.press(await utils.findByText('I verified my email'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
          inviteAttachError: 'coach_inactive',
          inviteCode: 'GP-TEST1',
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
        invite_code: 'GP-TEST1',
      });
      const utils = await renderScreen();
      await fireEvent.changeText(utils.getByTestId('invite-code-input'), 'GP-TEST1');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1));
      expect(mockSignInWithGoogle.mock.calls[0][0]).toEqual({ inviteCode: 'GP-TEST1', intendedRole: undefined });
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
          inviteAttachError: 'not_attached',
          inviteCode: 'GP-TEST1',
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
      await chooseRole(utils, 'coach');
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
      utils.rerender(
        <CreateAccountScreen navigation={nav as never} route={{ params: { invite_code: 'GP-QR1' } }} />,
      );
      expect(await utils.findByText('Create your account.')).toBeTruthy();
      expect(utils.getByTestId('invite-code-input').props.value).toBe('GP-QR1');
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
    });

    it('switching back to the choice keeps the form, and the client form keeps the code field', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('role-choice-change'));
      await chooseRole(utils, 'client');
      expect(await utils.findByText('Create your account.')).toBeTruthy();
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
      await chooseRole(utils, 'coach');
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
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
      expect(await utils.findByText(/Your coach account could not be confirmed/)).toBeTruthy();
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
      expect(await utils.findByText(/Your coach account could not be confirmed/)).toBeTruthy();
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
      expect(await utils.findByText(/Your coach account could not be confirmed/)).toBeTruthy();
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
      expect(await utils.findByText('Create your account.')).toBeTruthy();
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
      expect(await utils.findByText('Create your coach account.')).toBeTruthy();
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
      expect(await utils.findByText('Create your account.')).toBeTruthy();
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

  // Fix round 3: the in-flight boundary (Sol B1-R2 / Opus C1) and the
  // lost-response retry notice (Opus C4). The first two tests are the two
  // independent audit probes at 83fbb619, kept as permanent regressions.
  describe('#306 fix round 3', () => {
    const PROVIDERS = ['email', 'apple', 'google'];
    const NO_ACCOUNT = /No account has been created/;

    async function renderCoachWithPendingLive() {
      await loadSignupPolicy(async () => ({ data: { ...ROLE_CHOICE_POLICY, providers: PROVIDERS } }));
      let resolveLive: (v: unknown) => void = () => undefined;
      mockGetSignupPolicy.mockReturnValueOnce(new Promise((r) => { resolveLive = r; }));
      const nav = makeNav();
      const utils = await render(<CreateAccountScreen navigation={nav as never} route={undefined} />);
      await chooseRole(utils, 'coach');
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
      const disableLive = async () => {
        await act(async () => {
          resolveLive({ data: { ...ROLE_CHOICE_POLICY, providers: PROVIDERS, role_choice: false } });
        });
      };
      return { nav, utils, disableLive };
    }

    async function startPendingCoachRegister(utils: Awaited<ReturnType<typeof renderCoachWithPendingLive>>['utils']) {
      let resolveRegister: (v: unknown) => void = () => undefined;
      let rejectRegister: (e: unknown) => void = () => undefined;
      mockRegister.mockReturnValueOnce(
        new Promise((res, rej) => { resolveRegister = res; rejectRegister = rej; }),
      );
      await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Coach');
      await fireEvent.changeText(utils.getByLabelText('Email'), 'pat@example.com');
      await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
      const pressing = fireEvent.press(utils.getByLabelText('Create account'));
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][1]).toBe('coach');
      return {
        resolve: async (v: unknown) => { await act(async () => { resolveRegister(v); }); await pressing; },
        reject: async (e: unknown) => { await act(async () => { rejectRegister(e); }); await pressing; },
      };
    }

    it('Sol B1-R2 probe: live disable while a coach /auth/register is pending never claims no account, never offers a client re-choice, never sends a second request', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      // The server has the coach request and may already have committed.
      await disableLive();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      expect(utils.queryByTestId('coach-choice-withdrawn-client')).toBeNull();
      // A second submission while the first is in flight is ignored.
      await fireEvent.press(utils.getByLabelText('Create account'));
      expect(mockRegister.mock.calls.map((c) => c[1])).toEqual(['coach']);
      await pending.resolve({ data: { requires_verification: true, role: 'coach' } });
      expect(await utils.findByText('Check your inbox')).toBeTruthy();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    it('Opus C1 probe: the withdrawal notice is held while the request is in flight; success goes to verify', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      // The pending form stays the coach form the user submitted.
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
      await pending.resolve({ data: { requires_verification: true, role: 'coach' } });
      expect(await utils.findByText('I verified my email')).toBeTruthy();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      expect(utils.queryByTestId('coach-request-not-applied-notice')).toBeNull();
    });

    it('in flight -> server created a client (kill switch): the verify step says coach sign-up was not applied, no withdrawal notice', async () => {
      const { utils, nav, disableLive } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      await disableLive();
      await pending.resolve({ data: { requires_verification: true, role: 'student' } });
      expect(await utils.findByTestId('coach-request-not-applied-notice')).toBeTruthy();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      // The policy answer that landed later does not erase the attempt's outcome.
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      await fireEvent.press(utils.getByText('I verified my email'));
      await waitFor(() =>
        expect(nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'coach_request_not_applied' }),
      );
    });

    it('in flight -> server failure (4xx answer): shown after it settles, as "not completed", never "No account has been created"', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      await pending.reject(Object.assign(new Error('Bad Request'), { response: { status: 400, data: { message: 'Invalid email' } } }));
      expect(await utils.findByTestId('coach-choice-withdrawn-refused')).toBeTruthy();
      expect(utils.getByText(/your coach sign-up was not completed/)).toBeTruthy();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
      // The request is settled, so an explicit client choice is now allowed.
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-client'));
      expect(await utils.findByText('Create your account.')).toBeTruthy();
    });

    it('in flight -> response lost (no answer): unconfirmed state, no "No account", no client re-choice; sign in or support offered', async () => {
      const { utils, nav, disableLive } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      await pending.reject(new Error('Cannot reach server. Please check your connection and try again.'));
      expect(await utils.findByTestId('coach-choice-withdrawn-unconfirmed')).toBeTruthy();
      expect(utils.getByText(/An account may or may not have been created/)).toBeTruthy();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
      expect(utils.queryByTestId('coach-choice-withdrawn-client')).toBeNull();
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-sign-in'));
      expect(nav.navigate).toHaveBeenCalledWith('Login', { email: 'pat@example.com' });
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-support'));
      expect(nav.navigate).toHaveBeenCalledWith('SupportInbox');
      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    it('in flight -> committed but response lost (5xx), then the safe retry finds the email registered: says the earlier attempt may have created it', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      await disableLive();
      await pending.reject(Object.assign(new Error('Server error'), { response: { status: 502 } }));
      expect(await utils.findByTestId('coach-choice-withdrawn-unconfirmed')).toBeTruthy();
      // Coach sign-up comes back; the user retries with the same email.
      mockGetSignupPolicy.mockResolvedValueOnce({ data: { ...ROLE_CHOICE_POLICY, providers: PROVIDERS } });
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-recheck'));
      expect(await utils.findByText('Create your coach account.')).toBeTruthy();
      mockRegister.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { response: { status: 409, data: { message: 'Email already registered' } } }));
      await fireEvent.press(utils.getByLabelText('Create account'));
      expect(await utils.findByText(/Your earlier coach sign-up may have created it/)).toBeTruthy();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
    });

    it('in flight -> pre-handler refusal (unknown field): the proven "No account was created" copy after it settles', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      await pending.reject(new CoachSignupUnavailableError());
      expect(await utils.findByTestId('coach-choice-withdrawn-refused')).toBeTruthy();
      expect(utils.getByText(/No account was created/)).toBeTruthy();
    });

    it('no in-flight request: a live disable still shows "No account has been created" (round-2 behaviour kept)', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      await disableLive();
      expect(await utils.findByTestId('coach-choice-withdrawn-not-started')).toBeTruthy();
      expect(utils.getByText(NO_ACCOUNT)).toBeTruthy();
    });

    it('Apple in flight: live disable is held; a server coach goes to the app with no notice', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      let resolveApple: (v: unknown) => void = () => undefined;
      mockSignInWithApple.mockReturnValueOnce(new Promise((r) => { resolveApple = r; }));
      const pressing = fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
      await act(async () => { resolveApple({ success: true, is_new_user: true, user: { id: 'c1', role: 'coach' } }); });
      await pressing;
      expect(mockSignInWithApple).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(mockEmit).toHaveBeenCalled());
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
    });

    it('Google in flight: live disable is held; an unconfirmed outcome shows the unconfirmed state, not "No account"', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      let resolveGoogle: (v: unknown) => void = () => undefined;
      mockSignInWithGoogle.mockReturnValueOnce(new Promise((r) => { resolveGoogle = r; }));
      const pressing = fireEvent.press(utils.getByText('Continue with Google'));
      await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1));
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      await act(async () => { resolveGoogle({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' }); });
      await pressing;
      expect(await utils.findByTestId('coach-choice-withdrawn-unconfirmed')).toBeTruthy();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
      expect(utils.queryByTestId('coach-choice-withdrawn-client')).toBeNull();
    });

    it('Apple cancelled while a live disable was held: nothing was sent, so "No account has been created" is true', async () => {
      const { utils, disableLive } = await renderCoachWithPendingLive();
      let resolveApple: (v: unknown) => void = () => undefined;
      mockSignInWithApple.mockReturnValueOnce(new Promise((r) => { resolveApple = r; }));
      const pressing = fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      await act(async () => { resolveApple({ success: false, cancelled: true }); });
      await pressing;
      expect(await utils.findByTestId('coach-choice-withdrawn-not-started')).toBeTruthy();
    });

    it('email coach signup with no answer (no policy change): the unconfirmed copy, not a generic error', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockRegister.mockRejectedValueOnce(new Error('Cannot reach server. Please check your connection and try again.'));
      const utils = await renderScreen(undefined, 'coach');
      await fillAndSubmit(utils);
      expect(await utils.findByText(/Your coach account could not be confirmed/)).toBeTruthy();
      expect(utils.queryByText(/No account was created/)).toBeNull();
    });

    it('Opus C4 (Google): a lost coach response, then the safe retry returns an existing client: "not applied", never "already had an account"', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'google'] } });
      mockSignInWithGoogle
        .mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' })
        .mockResolvedValueOnce({ success: true, is_new_user: false, user: { id: 'u1', role: 'student' } });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      expect(await utils.findByText(/Your coach account could not be confirmed/)).toBeTruthy();
      await fireEvent.press(utils.getByText('Continue with Google'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'coach_retry_not_applied' }),
      );
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('coach_retry_not_applied');
      expect(utils.nav.replace).not.toHaveBeenCalledWith('RoleSelection', { signupNotice: 'existing_account' });
    });

    it('Opus C4 (Apple): a lost coach response, then the safe retry returns an existing client: "not applied"', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockSignInWithApple
        .mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' })
        .mockResolvedValueOnce({ success: true, is_new_user: false, user: { id: 'u1', role: 'student' } });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(utils.getByTestId('apple-button'));
      expect(await utils.findByText(/Your coach account could not be confirmed/)).toBeTruthy();
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'coach_retry_not_applied' }),
      );
    });

    it('Opus C4 boundary: with no earlier unconfirmed attempt an existing account is still "already had an account"', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, providers: ['email', 'google'] } });
      mockSignInWithGoogle.mockResolvedValueOnce({ success: true, is_new_user: false, user: { id: 'u1', role: 'student' } });
      const utils = await renderScreen(undefined, 'coach');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'existing_account' }),
      );
    });

    it('while a coach request is in flight the role cannot be changed', async () => {
      const { utils } = await renderCoachWithPendingLive();
      const pending = await startPendingCoachRegister(utils);
      await fireEvent.press(utils.getByTestId('role-choice-change'));
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
      await pending.resolve({ data: { requires_verification: true, role: 'coach' } });
    });
  });

  describe('#306 fix round 4 (Sol B1-R3: an unresolved attempt outlives its request)', () => {
    const PROVIDERS = ['email', 'apple', 'google'];
    const NO_ACCOUNT = /No account has been created/;
    const UNCONFIRMED = /Your coach account could not be confirmed/;

    async function renderCoachWithHeldLive() {
      await loadSignupPolicy(async () => ({ data: { ...ROLE_CHOICE_POLICY, providers: PROVIDERS } }));
      let resolveLive: (v: unknown) => void = () => undefined;
      mockGetSignupPolicy.mockReturnValueOnce(new Promise((r) => { resolveLive = r; }));
      const nav = makeNav();
      const utils = await render(<CreateAccountScreen navigation={nav as never} route={undefined} />);
      await chooseRole(utils, 'coach');
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
      const disableLive = async () => {
        await act(async () => {
          resolveLive({ data: { ...ROLE_CHOICE_POLICY, providers: PROVIDERS, role_choice: false } });
        });
      };
      return { nav, utils, disableLive };
    }

    async function submitCoachEmail(utils: Awaited<ReturnType<typeof renderCoachWithHeldLive>>['utils']) {
      await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Coach');
      await fireEvent.changeText(utils.getByLabelText('Email'), 'pat@example.com');
      await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
      await fireEvent.press(utils.getByLabelText('Create account'));
    }

    function expectUnresolvedState(utils: Awaited<ReturnType<typeof renderCoachWithHeldLive>>['utils']) {
      expect(utils.getByTestId('coach-choice-withdrawn-unconfirmed')).toBeTruthy();
      expect(utils.getByText(/An account may or may not have been created/)).toBeTruthy();
      expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
      expect(utils.queryByTestId('coach-choice-withdrawn-client')).toBeNull();
      expect(utils.getByTestId('coach-choice-withdrawn-sign-in')).toBeTruthy();
    }

    it('email: the response is lost and settles, THEN the live disable lands: unconfirmed, never "No account"', async () => {
      const { utils, disableLive } = await renderCoachWithHeldLive();
      mockRegister.mockRejectedValueOnce(new Error('Cannot reach server. Please check your connection and try again.'));
      await submitCoachEmail(utils);
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      await disableLive();
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectUnresolvedState(utils);
    });

    it('Apple: unconfirmed and settled, then the live disable: unconfirmed', async () => {
      const { utils, disableLive } = await renderCoachWithHeldLive();
      mockSignInWithApple.mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' });
      await fireEvent.press(utils.getByTestId('apple-button'));
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      await disableLive();
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectUnresolvedState(utils);
    });

    it('Google: unconfirmed and settled, then the live disable: unconfirmed', async () => {
      const { utils, disableLive } = await renderCoachWithHeldLive();
      mockSignInWithGoogle.mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' });
      await fireEvent.press(utils.getByText('Continue with Google'));
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      await disableLive();
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectUnresolvedState(utils);
    });

    it('Apple: a lost attempt, then a CANCELLED retry with the disable held: cancellation proves nothing about the first', async () => {
      const { utils, disableLive } = await renderCoachWithHeldLive();
      mockSignInWithApple.mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' });
      await fireEvent.press(utils.getByTestId('apple-button'));
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      let resolveApple: (v: unknown) => void = () => undefined;
      mockSignInWithApple.mockReturnValueOnce(new Promise((r) => { resolveApple = r; }));
      const pressing = fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(2));
      await disableLive();
      expect(utils.queryByTestId('coach-choice-withdrawn-notice')).toBeNull();
      await act(async () => { resolveApple({ success: false, cancelled: true }); });
      await pressing;
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectUnresolvedState(utils);
    });

    it('Google: a lost attempt, then a CANCELLED retry with the disable held: unconfirmed', async () => {
      const { utils, disableLive } = await renderCoachWithHeldLive();
      mockSignInWithGoogle.mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' });
      await fireEvent.press(utils.getByText('Continue with Google'));
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      let resolveGoogle: (v: unknown) => void = () => undefined;
      mockSignInWithGoogle.mockReturnValueOnce(new Promise((r) => { resolveGoogle = r; }));
      const pressing = fireEvent.press(utils.getByText('Continue with Google'));
      await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalledTimes(2));
      await disableLive();
      await act(async () => { resolveGoogle({ success: false, error: 'Sign-in was cancelled' }); });
      await pressing;
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectUnresolvedState(utils);
    });

    it('email: a lost attempt, then a REFUSED retry (4xx) with the disable held: still unconfirmed', async () => {
      const { utils, disableLive } = await renderCoachWithHeldLive();
      mockRegister.mockRejectedValueOnce(Object.assign(new Error('Server error'), { response: { status: 502 } }));
      await submitCoachEmail(utils);
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      let rejectRegister: (e: unknown) => void = () => undefined;
      mockRegister.mockReturnValueOnce(new Promise((_res, rej) => { rejectRegister = rej; }));
      const pressing = fireEvent.press(utils.getByLabelText('Create account'));
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(2));
      await disableLive();
      await act(async () => { rejectRegister(Object.assign(new Error('Too many'), { response: { status: 429, data: { message: 'Too many requests' } } })); });
      await pressing;
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectUnresolvedState(utils);
    });

    it('remount: an unconfirmed attempt from before the remount is consulted before the live answer is applied', async () => {
      await rememberUnconfirmedCoachSignup('apple');
      const { utils, disableLive } = await renderCoachWithHeldLive();
      await disableLive();
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectUnresolvedState(utils);
    });

    it('"Check again" never erases it: still off keeps the unconfirmed state; no client account is offered', async () => {
      const { utils, disableLive } = await renderCoachWithHeldLive();
      mockRegister.mockRejectedValueOnce(new Error('Cannot reach server. Please check your connection and try again.'));
      await submitCoachEmail(utils);
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      await disableLive();
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      mockGetSignupPolicy.mockResolvedValueOnce({ data: { ...ROLE_CHOICE_POLICY, providers: PROVIDERS, role_choice: false } });
      await fireEvent.press(utils.getByTestId('coach-choice-withdrawn-recheck'));
      expect(await utils.findByTestId('coach-choice-recheck-note')).toBeTruthy();
      expectUnresolvedState(utils);
      expect(await AsyncStorage.getItem(COACH_SIGNUP_UNCONFIRMED_KEY)).not.toBeNull();
    });

    it('guard: a server answer for the same email resolves it (the marker is gone)', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
      mockRegister
        .mockRejectedValueOnce(new Error('Cannot reach server. Please check your connection and try again.'))
        .mockResolvedValueOnce({ data: { requires_verification: true, role: 'coach' } });
      const utils = await renderScreen(undefined, 'coach');
      await fillAndSubmit(utils);
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      expect(await AsyncStorage.getItem(COACH_SIGNUP_UNCONFIRMED_KEY)).not.toBeNull();
      await fireEvent.press(utils.getByLabelText('Create account'));
      expect(await utils.findByText('Check your inbox')).toBeTruthy();
      expect(await AsyncStorage.getItem(COACH_SIGNUP_UNCONFIRMED_KEY)).toBeNull();
    });

    it('a CLIENT retry (coach sign-up now off) that recovers an existing non-coach account is told "not applied"', async () => {
      await rememberUnconfirmedCoachSignup('apple');
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, role_choice: false } });
      mockSignInWithApple.mockResolvedValueOnce({ success: true, is_new_user: false, user: { id: 'u1', role: 'student' } });
      const utils = await renderScreen(undefined, null);
      expect(utils.queryByTestId('role-choice')).toBeNull();
      await fireEvent.press(utils.getByTestId('apple-button'));
      expect(mockSignInWithApple.mock.calls[0][0].intendedRole).toBeUndefined();
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'coach_retry_not_applied' }),
      );
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('coach_retry_not_applied');
    });

    it('a client email retry that finds the address taken after a lost coach attempt says the earlier attempt may have created it', async () => {
      await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
      mockGetSignupPolicy.mockResolvedValue({ data: { ...ROLE_CHOICE_POLICY, role_choice: false } });
      mockRegister.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { response: { status: 409, data: { message: 'Email already registered' } } }));
      const utils = await renderScreen(undefined, null);
      await fillAndSubmit(utils);
      expect(await utils.findByText(/Your earlier coach sign-up may have created it/)).toBeTruthy();
      expect(mockRegister.mock.calls[0][1]).toBeUndefined();
    });
  });

  describe('#306 fix round 4 (backend #597 email canonicalisation, Sol B-597-1)', () => {
    it('trims the typed address and signs in on the verify step with the address the server stored', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      mockRegister.mockResolvedValueOnce({ data: { requires_verification: true, email: 'pat@example.com', role: 'student' } });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      const utils = await renderScreen();
      await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Client');
      await fireEvent.changeText(utils.getByLabelText('Email'), ' Pat@Example.com ');
      await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
      await fireEvent.press(utils.getByLabelText('Create account'));
      expect(await utils.findByText('Check your inbox')).toBeTruthy();
      expect(mockRegister.mock.calls[0][0].email).toBe('Pat@Example.com');
      expect(mockRegister.mock.calls[0][1]).toBeUndefined();
      await fireEvent.press(utils.getByText('I verified my email'));
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith({ email: 'pat@example.com', password: 'Str0ng!pass' }));
      expect(await AsyncStorage.getItem('pending_email')).toBe('pat@example.com');
    });

    it('guard: a response without the stored address (current production) keeps the typed spelling', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      mockRegister.mockResolvedValueOnce({ data: { requires_verification: true } });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      const utils = await renderScreen();
      await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Client');
      await fireEvent.changeText(utils.getByLabelText('Email'), 'Pat@Example.com');
      await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
      await fireEvent.press(utils.getByLabelText('Create account'));
      expect(await utils.findByText('Check your inbox')).toBeTruthy();
      await fireEvent.press(utils.getByText('I verified my email'));
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith({ email: 'Pat@Example.com', password: 'Str0ng!pass' }));
    });

    it('guard: a different address in the response is ignored', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      mockRegister.mockResolvedValueOnce({ data: { requires_verification: true, email: 'someone@else.com' } });
      mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', role: 'student' } } });
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      expect(await utils.findByText('Check your inbox')).toBeTruthy();
      await fireEvent.press(utils.getByText('I verified my email'));
      await waitFor(() => expect(mockLogin).toHaveBeenCalledWith({ email: 'pat@example.com', password: 'Str0ng!pass' }));
    });
  });
});

// Sol B-324-1: "Request access" never fails silently. When no email app
// opens, the screen says so, shows the one support address as selectable
// text, and offers Copy and Try again.
describe('CreateAccountScreen Request access email', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email'] } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens a draft to the one support inbox with the request-access subject', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const utils = await renderScreen();
    await fireEvent.press(await utils.findByTestId('request-access-link'));
    expect(openURL).toHaveBeenCalledWith(
      'mailto:Bradleyapple1031@gmail.com?subject=Request%20access%20to%20The%20Growth%20Project',
    );
    expect(utils.queryByTestId('request-access-fallback')).toBeNull();
  });

  it('a mail intent that cannot open shows what happened, the address, Copy and Try again', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    mockSetString.mockResolvedValue(true);
    const utils = await renderScreen();
    await fireEvent.press(await utils.findByTestId('request-access-link'));
    await waitFor(() => utils.getByTestId('request-access-fallback'));
    expect(utils.getByTestId('request-access-fallback-status').props.children).toMatch(
      /could not open an email app/,
    );
    const address = utils.getByTestId('request-access-fallback-address');
    expect(address.props.selectable).toBe(true);
    expect(address.props.children).toBe('Bradleyapple1031@gmail.com');
    await fireEvent.press(utils.getByTestId('request-access-fallback-copy'));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('Bradleyapple1031@gmail.com'));
    await waitFor(() =>
      expect(utils.getByTestId('request-access-fallback-status').props.children).toMatch(/Address copied/),
    );
    // Try again opens the same draft; once it opens, the fallback goes away.
    openURL.mockResolvedValueOnce(true);
    await fireEvent.press(utils.getByTestId('request-access-fallback-retry'));
    expect(openURL).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(utils.queryByTestId('request-access-fallback')).toBeNull());
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
