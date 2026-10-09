/** AUTH-ENTRY-133 (B13 B17): Role (prototype 01) and Create account (prototype 02) flow, copy and states. */
import React from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
const mockPreview = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    getInvitePreview: (...a: unknown[]) => mockPreview(...a),
    validateInviteCode: (...a: unknown[]) => mockPreview(...a),
  },
}));
jest.mock('../../../utils/appleAuth', () => ({ signInWithApple: jest.fn() }));
jest.mock('../../../utils/googleAuth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('../../../components/AppleSignInButton', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <Text>Continue with Apple</Text> };
});
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));

import CreateAccountScreen from '../CreateAccountScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

// Production GET /api/auth/signup-policy at 16:58 PDT 8 Oct (role_choice on).
const LIVE = { invite_code_required: false, providers: ['email', 'google', 'apple'], role_choice: true };

function makeNav(canGoBack = true) {
  return { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), canGoBack: () => canGoBack };
}

async function renderRole(nav = makeNav(), params?: { invite_code?: string }) {
  const ui = await render(<CreateAccountScreen navigation={nav as never} route={params ? { params } : undefined} />);
  await waitFor(() => expect(ui.queryByTestId('signup-policy-loading')).toBeNull());
  return { nav, ...ui };
}

const checked = (el: { props: { accessibilityState?: { checked?: boolean } } }) => el.props.accessibilityState?.checked;

beforeEach(async () => {
  jest.clearAllMocks();
  __resetSignupPolicyCacheForTests();
  await AsyncStorage.clear();
  mockGetSignupPolicy.mockResolvedValue({ data: LIVE });
  mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley Gleave' } });
});

describe('Role (prototype 01)', () => {
  it('asks the prototype question with two radio rows; Continue waits for a choice', async () => {
    const ui = await renderRole();
    expect(ui.getByText('Welcome')).toBeTruthy();
    expect(ui.getByText('How will you use The Growth Project?')).toBeTruthy();
    expect(ui.getByText('A plan, daily targets and a coach who knows you.')).toBeTruthy();
    expect(ui.getByText('Your practice in one place: clients, programs and messages.')).toBeTruthy();
    expect(ui.getAllByRole('radio')).toHaveLength(2);
    const cont = ui.getByTestId('role-choice-continue');
    expect(cont.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(cont);
    expect(ui.getByTestId('role-choice')).toBeTruthy();
    expect(ui.queryByTestId('role-choice-coachless-note')).toBeNull();

    await fireEvent.press(ui.getByTestId('role-choice-client'));
    expect(checked(ui.getByTestId('role-choice-client'))).toBe(true);
    expect(checked(ui.getByTestId('role-choice-coach'))).toBe(false);
    expect(ui.getByTestId('role-choice-coachless-note').props.children).toBe(
      'No coach code yet? You can add one after you sign up.',
    );
    expect(ui.getByTestId('role-choice-continue').props.accessibilityState).toMatchObject({ disabled: false });
    // Selecting never commits: the form appears only after Continue.
    expect(ui.queryByLabelText('Full name')).toBeNull();
    await fireEvent.press(ui.getByTestId('role-choice-coach'));
    expect(ui.queryByTestId('role-choice-coachless-note')).toBeNull();
    await fireEvent.press(ui.getByTestId('role-choice-continue'));
    expect(ui.getByText('Create your coach account.')).toBeTruthy();
    expect(ui.getByText('Joining as a coach')).toBeTruthy();
  });

  it('"I have an invite code" opens the client form with the code field focused', async () => {
    const ui = await renderRole();
    await fireEvent.press(ui.getByLabelText('I have an invite code'));
    expect(ui.getByText('Create your account.')).toBeTruthy();
    expect(ui.getByText('Joining as a client')).toBeTruthy();
    expect(ui.getByTestId('invite-code-input').props.autoFocus).toBe(true);
  });

  it('back leaves to Welcome; with no history it navigates there instead of doing nothing (B08)', async () => {
    const first = await renderRole(makeNav(true));
    await fireEvent.press(first.getByLabelText('Back'));
    expect(first.nav.goBack).toHaveBeenCalledTimes(1);
    const resumed = await renderRole(makeNav(false));
    await fireEvent.press(resumed.getByLabelText('Back'));
    expect(resumed.nav.goBack).not.toHaveBeenCalled();
    expect(resumed.nav.navigate).toHaveBeenCalledWith('Welcome');
  });
});

describe('Create account (prototype 02)', () => {
  it('providers come first, then "or", then the form; one filled action', async () => {
    const ui = await renderRole();
    await fireEvent.press(ui.getByTestId('role-choice-client'));
    await fireEvent.press(ui.getByTestId('role-choice-continue'));
    const tree = JSON.stringify(ui.toJSON());
    const at = (s: string) => tree.indexOf(s);
    expect(at('Continue with Apple')).toBeGreaterThan(-1);
    expect(at('Continue with Apple')).toBeLessThan(at('Continue with Google'));
    expect(at('Continue with Google')).toBeLessThan(at('"or"'));
    expect(at('"or"')).toBeLessThan(at('FULL NAME'));
    expect(ui.getByText('INVITE CODE (OPTIONAL)')).toBeTruthy();
    expect(ui.getByText('PHONE (OPTIONAL)')).toBeTruthy();
    const filled = ui
      .getAllByRole('button')
      .filter((b) => StyleSheet.flatten(b.props.style)?.backgroundColor === jest.requireActual('../../../theme/tokens').lightTokens.accent);
    expect(filled).toHaveLength(1);
  });

  it('a join link names the coach by first name in the eyebrow and skips the role step', async () => {
    const ui = await renderRole(makeNav(), { invite_code: 'GP-BRAD' });
    expect(ui.queryByTestId('role-choice')).toBeNull();
    expect(await ui.findByText('Joining Bradley')).toBeTruthy();
    // Back from a link-opened form leaves the screen (no role step to return to).
    await fireEvent.press(ui.getByLabelText('Back'));
    expect(ui.nav.goBack).toHaveBeenCalledTimes(1);
  });

  it('show-password toggles the field; back returns to the role step with the choice kept', async () => {
    const ui = await renderRole();
    await fireEvent.press(ui.getByTestId('role-choice-client'));
    await fireEvent.press(ui.getByTestId('role-choice-continue'));
    expect(ui.getByLabelText('Password').props.secureTextEntry).toBe(true);
    await fireEvent.press(ui.getByLabelText('Show password'));
    expect(ui.getByLabelText('Password').props.secureTextEntry).toBe(false);
    await fireEvent.press(ui.getByLabelText('Hide password'));
    expect(ui.getByLabelText('Password').props.secureTextEntry).toBe(true);
    await fireEvent.press(ui.getByLabelText('Back'));
    expect(ui.nav.goBack).not.toHaveBeenCalled();
    expect(checked(ui.getByTestId('role-choice-client'))).toBe(true);
  });

  it.each([
    ['Android 360x800', { top: 24, bottom: 16, left: 0, right: 0 }],
    ['iPhone 390x844', { top: 47, bottom: 34, left: 0, right: 0 }],
  ])('%s: role and create steps sit below the status bar (B13)', async (_name, insets) => {
    const nav = makeNav();
    const ui = await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <CreateAccountScreen navigation={nav as never} />
      </SafeAreaInsetsContext.Provider>,
    );
    await waitFor(() => expect(ui.queryByTestId('signup-policy-loading')).toBeNull());
    expect(StyleSheet.flatten(ui.getByTestId('create-account-role').props.style).paddingTop).toBe(insets.top + 12);
    expect(ui.toJSON()).toMatchSnapshot('role');
    await fireEvent.press(ui.getByTestId('role-choice-client'));
    await fireEvent.press(ui.getByTestId('role-choice-continue'));
    expect(StyleSheet.flatten(ui.getByTestId('create-account-register').props.style).paddingTop).toBe(insets.top + 12);
    expect(ui.toJSON()).toMatchSnapshot('create');
  });
});
