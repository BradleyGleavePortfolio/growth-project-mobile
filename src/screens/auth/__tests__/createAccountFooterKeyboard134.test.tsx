/**
 * CLIENT-POLISH-134 (agent 134, B13 B29; AUTH-ENTRY-133 optional items):
 *  - no lone "or" divider: it shows only under a real provider button (Apple
 *    once this device offers it, Google when advertised), never on its own;
 *  - with the keyboard open on a 360x800 Android phone the pinned footer
 *    (sharing sentence, Create account, terms) moves to the end of the form,
 *    so it never covers the fields; it pins again when the keyboard closes.
 */
import React from 'react';
import { Keyboard, Platform, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

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
// The real button renders only when this device offers Sign in with Apple and
// then calls onAvailable; the mock does the same from a test switch.
const mockApple = { available: false };
jest.mock('../../../components/AppleSignInButton', () => {
  const ReactActual = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  function MockAppleButton({ onAvailable }: { onAvailable?: () => void }) {
    ReactActual.useEffect(() => { if (mockApple.available) onAvailable?.(); }, [onAvailable]);
    return mockApple.available ? <Text>Continue with Apple</Text> : null;
  }
  return { __esModule: true, default: MockAppleButton };
});
jest.mock('../../../lib/coachSharingNotice', () => ({
  ...jest.requireActual('../../../lib/coachSharingNotice'),
  useCoachSharingNotice: () => 'coach_sharing_join_v1',
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));

import CreateAccountScreen from '../CreateAccountScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { footerBottomPadding } from '../../../ui';
import { layout } from '../../../theme/tokens';

const ANDROID_360 = { top: 24, bottom: 16, left: 0, right: 0 };
const POLICY = (providers: string[]) => ({ data: { invite_code_required: false, providers, role_choice: false } });
const nav = () => ({ navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), canGoBack: () => true });

// Keyboard events: capture the listeners the screen registers.
const listeners: Record<string, Array<() => void>> = {};
const realOS = Platform.OS;
// The divider is hidden from screen readers (decorative), so queries include hidden elements.
const HIDDEN = { includeHiddenElements: true } as const;

async function renderCreate(providers: string[]) {
  mockGetSignupPolicy.mockResolvedValue(POLICY(providers));
  const ui = await render(
    <SafeAreaInsetsContext.Provider value={ANDROID_360}>
      <CreateAccountScreen navigation={nav() as never} />
    </SafeAreaInsetsContext.Provider>,
  );
  await waitFor(() => expect(ui.queryByTestId('signup-policy-loading')).toBeNull());
  return ui;
}
const keyboard = async (event: string) => {
  await act(async () => { (listeners[event] ?? []).forEach((fn) => fn()); });
};

beforeEach(async () => {
  jest.clearAllMocks();
  __resetSignupPolicyCacheForTests();
  await AsyncStorage.clear();
  mockApple.available = false;
  mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley Gleave' } });
  for (const k of Object.keys(listeners)) delete listeners[k];
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: () => void) => {
    (listeners[event] ??= []).push(fn);
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => {
  Platform.OS = realOS;
  jest.restoreAllMocks();
});

describe('the "or" divider', () => {
  it('iOS without Sign in with Apple and without Google: no lone "or"', async () => {
    Platform.OS = 'ios';
    const ui = await renderCreate(['email']);
    expect(ui.queryByTestId('create-account-or', HIDDEN)).toBeNull();
    expect(ui.queryByText('or', HIDDEN)).toBeNull();
  });

  it('iOS with Sign in with Apple: "or" under the Apple button', async () => {
    Platform.OS = 'ios';
    mockApple.available = true;
    const ui = await renderCreate(['email', 'apple']);
    const providers = within(ui.getByTestId('create-account-providers'));
    expect(providers.getByText('Continue with Apple')).toBeTruthy();
    expect(providers.getByTestId('create-account-or', HIDDEN)).toBeTruthy();
  });

  it('Android with Google: "or" under Google only (no Apple button)', async () => {
    Platform.OS = 'android';
    const ui = await renderCreate(['email', 'google', 'apple']);
    const tree = JSON.stringify(ui.toJSON());
    expect(tree).not.toContain('Continue with Apple');
    expect(tree.indexOf('Continue with Google')).toBeGreaterThan(-1);
    expect(tree.indexOf('Continue with Google')).toBeLessThan(tree.indexOf('create-account-or'));
  });

  it('Android without Google: no providers block and no "or"', async () => {
    Platform.OS = 'android';
    const ui = await renderCreate(['email', 'apple']);
    expect(ui.queryByTestId('create-account-providers', HIDDEN)).toBeNull();
    expect(ui.queryByTestId('create-account-or', HIDDEN)).toBeNull();
  });
});

describe('the footer with the keyboard open (Android 360x800)', () => {
  it('moves under the fields while typing and pins again when the keyboard closes', async () => {
    Platform.OS = 'android';
    const ui = await renderCreate(['email']);
    await fireEvent.changeText(ui.getByTestId('invite-code-input'), 'GP-BRADLEY');
    const footer = () => ui.getByTestId('create-account-register-footer');
    const scroll = () => within(ui.getByTestId('create-account-register-scroll'));

    // Keyboard closed: sharing sentence, Create account and terms are pinned.
    expect(within(footer()).getByTestId('coach-sharing-notice')).toBeTruthy();
    expect(within(footer()).getByTestId('create-account-submit')).toBeTruthy();
    expect(within(footer()).getByTestId('create-account-legal')).toBeTruthy();
    expect(ui.queryByTestId('create-account-inline-footer')).toBeNull();

    await keyboard('keyboardDidShow');
    // The pinned slot holds nothing but its own padding, so the fields keep
    // the window above the keyboard: 800 - top - top bar - keyboard - slot.
    expect(within(footer()).queryByTestId('create-account-submit')).toBeNull();
    expect(within(footer()).queryByTestId('coach-sharing-notice')).toBeNull();
    const slot = StyleSheet.flatten(footer().props.style);
    const slotHeight = (slot.paddingTop as number) + (slot.paddingBottom as number);
    expect(slotHeight).toBe(layout.footerTopGap + footerBottomPadding(ANDROID_360.bottom));
    const KEYBOARD = 300; // a typical Android keyboard with its suggestion strip at 360 dp
    const window = 800 - (ANDROID_360.top + layout.statusBarGap) - layout.touchMin - KEYBOARD - slotHeight;
    expect(window).toBeGreaterThanOrEqual(3 * 80); // three labelled fields stay in view
    // Everything still sits together at the end of the form: sentence, button, terms.
    const inline = within(ui.getByTestId('create-account-inline-footer'));
    expect(inline.getByTestId('coach-sharing-notice')).toBeTruthy();
    expect(inline.getByTestId('create-account-submit')).toBeTruthy();
    expect(inline.getByTestId('create-account-legal')).toBeTruthy();
    expect(scroll().getByTestId('create-account-inline-footer')).toBeTruthy();
    expect(ui.getAllByTestId('create-account-submit')).toHaveLength(1);

    await keyboard('keyboardDidHide');
    expect(within(footer()).getByTestId('create-account-submit')).toBeTruthy();
    expect(ui.queryByTestId('create-account-inline-footer')).toBeNull();
  });

  it('keeps the field being typed in mounted (no remount when the footer moves)', async () => {
    Platform.OS = 'android';
    const ui = await renderCreate(['email']);
    const before = ui.getByTestId('invite-code-input');
    await keyboard('keyboardDidShow');
    expect(ui.getByTestId('invite-code-input')).toBe(before);
  });
});
