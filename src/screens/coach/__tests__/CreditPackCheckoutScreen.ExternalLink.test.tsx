/**
 * CREDIT-PAY-130 (owner decision 10 fallback): on a US-link iOS store build the
 * credit-pack checkout opens in the SYSTEM browser, never the in-app WebView.
 * The real gate decides (featureFlags + expo-application mocked, __DEV__ false):
 *   - the select phase says the coach pays TGP the pack price;
 *   - a pack tap mints a session with tgp:// return links and Linking.openURL
 *     opens it; no WebView mounts;
 *   - Stripe's tgp://checkout/success shows the receipt, /cancel goes back to
 *     the packs, and returning to the app refetches the budget;
 *   - a failed start says why in plain words and that nothing was charged.
 * PACKS-BOTH-131: the same runs on an Android build with only the Android
 * link on; the packs and the browser wait state say packs are non-refundable;
 * route.params.preselect starts the tapped pack's checkout ('custom' focuses
 * the amount field).
 */
import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  type AppStateStatus,
} from 'react-native';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { layout, lightTokens, radius } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';

const mockFlags = { iosHideNonP2PPurchases: true, iosUsCreditPackLink: true, androidCreditPackLink: false, coachAiCredits: false };
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) =>
        k in mockFlags ? mockFlags[k as keyof typeof mockFlags] : (t as Record<string | symbol, unknown>)[k],
    }),
  };
});
jest.mock('expo-application', () => ({ nativeBuildVersion: '7' }));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
  useIsFocused: () => true,
}));
let mockBudget = {
  period_start: '2026-10-01T00:00:00.000Z',
  period_end: '2026-11-01T00:00:00.000Z',
  used_displayed_cents: 10000,
  remaining_displayed_cents: 0,
  pack_options_cents: [1000, 2500, 9900],
  custom_pack_bounds_cents: { min: 1000, max: 50000 },
};
let mockRole: 'head_coach' | 'sub_coach' | 'unknown' = 'head_coach';
let mockBudgetLoading = false;
const mockUseRole = jest.fn(() => mockRole);
jest.mock('../../../hooks/useCoachRoleType', () => ({ useCoachRoleType: () => mockUseRole() }));
jest.mock('../../../hooks/useAIBudget', () => ({
  useAIBudget: () => ({ data: mockBudgetLoading ? undefined : mockBudget }),
  COACH_AI_BUDGET_QUERY_KEY: ['coachAIBudget'],
}));
const mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
const mockCreateCheckout = jest.fn();
jest.mock('../../../api/coachAiBudgetApi', () => ({
  __esModule: true,
  coachAiBudgetApi: { createCheckout: (...args: unknown[]) => mockCreateCheckout(...args) },
  CUSTOM_PACK_MIN_CENTS: 1000,
  CUSTOM_PACK_MAX_CENTS: 50000,
  buildCheckoutInput: (amountCents: number, extras?: Record<string, string>) => ({
    tier: amountCents === 1000 ? 'small' : 'custom',
    amount_cents: amountCents,
    ...extras,
  }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  const MockWebView = () => require('react').createElement(View, { testID: 'credit-pack-webview-mock' });
  return { __esModule: true, default: MockWebView };
});
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => require('react').createElement(Text, null, `icon:${name}`) };
});
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('../../../components/HapticPressable', () => {
  const { Pressable } = require('react-native');
  return { __esModule: true, default: Pressable };
});

import CreditPackCheckoutScreen, {
  EXTERNAL_CANCEL_URL,
  EXTERNAL_SUCCESS_URL,
  checkoutStartErrorMessage,
  type CreditPackCheckoutScreenProps,
} from '../CreditPackCheckoutScreen';

const routeWith = (preselect: number | 'custom'): CreditPackCheckoutScreenProps['route'] => ({
  key: 'CreditPackCheckout-1',
  name: 'CreditPackCheckout',
  params: { preselect },
});

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_live_abc';
let urlListener: ((event: { url: string }) => void) | null = null;
// The RN preset makes Linking.addEventListener a jest.fn: reuse its
// implementation so the spy returns a real EmitterSubscription.
const addUrlListener =
  jest.mocked(Linking.addEventListener).getMockImplementation() ??
  Linking.addEventListener.bind(Linking);
let appListener: ((state: AppStateStatus) => void) | null = null;
const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;
const realOS = Platform.OS;
let openURL: jest.SpyInstance;

beforeEach(() => {
  g.__DEV__ = false;
  Object.assign(mockFlags, { iosUsCreditPackLink: true, androidCreditPackLink: false, coachAiCredits: false });
  mockRole = 'head_coach';
  mockBudgetLoading = false;
  mockUseRole.mockReset().mockImplementation(() => mockRole);
  mockBudget = { ...mockBudget, used_displayed_cents: 10000, remaining_displayed_cents: 0 };
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
  mockCreateCheckout.mockReset().mockResolvedValue({
    data: { checkout_session_id: 'cs_live_abc', checkout_url: CHECKOUT_URL, amount_cents: 1000 },
  });
  mockInvalidate.mockClear();
  mockGoBack.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(undefined);
  urlListener = null;
  appListener = null;
  jest.spyOn(Linking, 'addEventListener').mockImplementation((type, listener) => {
    urlListener = listener;
    return addUrlListener(type, listener);
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appListener = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  g.__DEV__ = realDev;
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

async function tapFirstPack() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-pack-option-1000'));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe.each([
  ['US-link iOS build', 'ios', { iosUsCreditPackLink: true, androidCreditPackLink: false }],
  ['Android link build', 'android', { iosUsCreditPackLink: false, androidCreditPackLink: true }],
] as const)('%s: credit-pack checkout in the system browser', (_name, os, flags) => {
  beforeEach(() => {
    Object.assign(mockFlags, flags);
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  });

  it.each([1000, 2500, 9900, 'custom'] as const)('keeps pack %s at least 44 pt tall and its checkout path working', async (choice) => {
    await render(<CreditPackCheckoutScreen />);
    const button = screen.getByTestId(`ai-pack-option-${choice}`);
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
    if (choice === 'custom') {
      const input = screen.getByTestId('credit-pack-custom-input');
      expect(StyleSheet.flatten(input.props.style).minHeight).toBe(layout.touchMin);
      expect(StyleSheet.flatten(screen.getByTestId('credit-pack-custom-field').props.style)).toMatchObject({
        paddingVertical: 0, borderRadius: radius.input,
      });
      await fireEvent.changeText(input, '20');
    }
    await fireEvent.press(button);
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: choice === 'custom' ? 2000 : choice }),
    );
    expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
  });

  it('says who is paid, opens Stripe in the browser with tgp return links, and never mounts the WebView', async () => {
    await render(<CreditPackCheckoutScreen />);
    expect(screen.getByTestId('credit-pack-pays-tgp')).toHaveTextContent(/You pay TGP the pack price through Stripe checkout/);
    expect(screen.getByTestId('ai-pack-non-refundable')).toHaveTextContent('Credit packs are non-refundable.');
    expect(screen.getByTestId('credit-pack-custom-input').props.autoFocus).toBe(false);
    await tapFirstPack();
    expect(mockCreateCheckout).toHaveBeenCalledWith({
      tier: 'small',
      amount_cents: 1000,
      success_url: EXTERNAL_SUCCESS_URL,
      cancel_url: EXTERNAL_CANCEL_URL,
    });
    expect(EXTERNAL_SUCCESS_URL).toBe('tgp://checkout/success?session_id={CHECKOUT_SESSION_ID}');
    expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    expect(screen.queryByTestId('credit-pack-webview-mock')).toBeNull();
    expect(screen.getByTestId('credit-pack-external')).toHaveTextContent(/You pay TGP \$10\./);
    // FIX-OPUS-B-131 (B2): below 60% Coach Home shows no meter, so the copy names AI credits, not Coach Home.
    expect(screen.getByTestId('credit-pack-external')).toHaveTextContent(
      /It is added to your AI credits once Stripe confirms the payment\./,
    );
    expect(screen.getByTestId('credit-pack-external')).not.toHaveTextContent(/Coach Home/);
    expect(screen.getByTestId('credit-pack-external-non-refundable')).toHaveTextContent(
      'Credit packs are non-refundable.',
    );
  });

  it('a pack tapped on the pause or tutorial card (preselect) starts its checkout with no second tap', async () => {
    await render(<CreditPackCheckoutScreen route={routeWith(2500)} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 2500, success_url: EXTERNAL_SUCCESS_URL }),
    );
    expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
    expect(screen.getByTestId('credit-pack-external')).toHaveTextContent(/You pay TGP \$25\./);
  });

  it("preselect 'custom' opens the list with the amount field focused", async () => {
    await render(<CreditPackCheckoutScreen route={routeWith('custom')} />);
    expect(screen.getByTestId('credit-pack-select')).toBeTruthy();
    expect(screen.getByTestId('credit-pack-custom-input').props.autoFocus).toBe(true);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('a preselect that is not a pack starts nothing and shows the list', async () => {
    await render(<CreditPackCheckoutScreen route={routeWith(1234)} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('credit-pack-select')).toBeTruthy();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('Stripe success link shows the receipt with the new balance and refetches the budget', async () => {
    await render(<CreditPackCheckoutScreen />);
    await tapFirstPack();
    expect(urlListener).not.toBeNull();
    await act(async () => {
      urlListener?.({ url: 'tgp://checkout/success?session_id=cs_live_abc' });
    });
    expect(screen.getByTestId('credit-pack-success')).toBeTruthy();
    expect(screen.getByLabelText('New balance, $10')).toBeTruthy();
    // FIX-OPUS-B-131 (B2): the receipt names AI credits, not Coach Home.
    expect(screen.getByTestId('credit-pack-success')).toHaveTextContent(
      /It is added to your AI credits once Stripe confirms the payment\./,
    );
    expect(screen.getByTestId('credit-pack-success')).not.toHaveTextContent(/Coach Home/);
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['coachAIBudget'] });
  });

  it('Stripe cancel link returns to the packs; an unrelated link is ignored', async () => {
    await render(<CreditPackCheckoutScreen />);
    await tapFirstPack();
    await act(async () => {
      urlListener?.({ url: 'tgp://reset-password?token=x' });
    });
    expect(screen.getByTestId('credit-pack-external')).toBeTruthy();
    await act(async () => {
      urlListener?.({ url: 'tgp://checkout/cancel' });
    });
    expect(screen.getByTestId('credit-pack-select')).toBeTruthy();
  });

  it('coming back to the app refetches the budget; Done closes the screen', async () => {
    await render(<CreditPackCheckoutScreen />);
    await tapFirstPack();
    await act(async () => {
      appListener?.('active');
    });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['coachAIBudget'] });
    for (const id of ['credit-pack-external-done', 'credit-pack-external-reopen']) {
      expect(StyleSheet.flatten(screen.getByTestId(id).props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
    await fireEvent.press(screen.getByTestId('credit-pack-external-reopen'));
    expect(openURL).toHaveBeenCalledTimes(2);
    await act(async () => {
      fireEvent.press(screen.getByTestId('credit-pack-external-done'));
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('a browser that does not open shows a plain error, not raw text', async () => {
    openURL.mockRejectedValueOnce(new Error('Unable to open URL'));
    await render(<CreditPackCheckoutScreen />);
    await tapFirstPack();
    expect(screen.getByTestId('credit-pack-error')).toHaveTextContent(/Checkout did not start/);
    expect(screen.getByTestId('credit-pack-error')).toHaveTextContent(/Nothing was charged/);
    expect(screen.getByTestId('credit-pack-error')).not.toHaveTextContent(/Unable to open URL|Something went wrong/);
    expect(StyleSheet.flatten(screen.getByTestId('credit-pack-retry').props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(screen.getByTestId('credit-pack-retry'));
    expect(screen.getByTestId('credit-pack-select')).toBeTruthy();
  });
});

describe('checkoutStartErrorMessage', () => {
  it('names the busy and offline cases and never echoes the raw error', () => {
    expect(checkoutStartErrorMessage({ isAxiosError: true, response: { status: 429 } })).toMatch(/several times in a minute/);
    expect(checkoutStartErrorMessage({ isAxiosError: true, message: 'Network Error' })).toMatch(/could not be reached/);
    expect(checkoutStartErrorMessage(new Error('Request failed with status code 500'))).toBe(
      'Checkout could not start. Try again in a minute. Nothing was charged.',
    );
    expect(checkoutStartErrorMessage(undefined)).toMatch(/Nothing was charged/);
  });
});

describe('PACKSCREEN S3 selection (coachAiCredits on)', () => {
  beforeEach(() => {
    mockFlags.coachAiCredits = true;
    mockBudget.remaining_displayed_cents = 2500;
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    jest.setSystemTime(new Date('2026-10-22T00:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('uses the CB-PACE $25 suggestion, verbatim G2/G4, then the existing browser checkout', async () => {
    await render(<CreditPackCheckoutScreen />);
    expect(screen.getByTestId('credit-pack-select')).toHaveTextContent(
      'You pay face value. $10 of credit is $10 of AI usage.',
      { exact: false },
    );
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByText('A $25 pack should cover you until Nov 1.')).toBeTruthy();
    // #CREDIT-S: the three packs sit inside the Suggested card, under Roman's sentence, $25 chosen.
    const card = screen.getByTestId('credit-pack-suggested');
    expect(within(card).getByTestId('credit-pack-tiles')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('should cover you until')).toBeGreaterThan(-1);
    expect(tree.indexOf('should cover you until')).toBeLessThan(tree.indexOf('credit-pack-tiles'));
    expect(within(card).getByLabelText('$25 pack').props.accessibilityState).toEqual({ selected: true, checked: true });
    expect(within(card).getByLabelText('$10 pack').props.accessibilityState).toEqual({ selected: false, checked: false });
    expect(within(card).getByLabelText('$99 pack')).toBeTruthy();
    // On the ink card the chosen tile's ring is the on-dark frame token, not forest.
    expect(StyleSheet.flatten(within(card).getByLabelText('$25 pack').props.style)).toMatchObject({
      borderColor: lightTokens.data.frameOnDark,
      borderWidth: 2,
    });
    expect(screen.queryByTestId('credit-pack-other-amounts')).toBeNull();
    expect(screen.queryByTestId('credit-pack-custom-input')).toBeNull();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(screen.getByTestId('credit-pack-buy').props.style).minHeight).toBeGreaterThanOrEqual(layout.touchMin);
    await fireEvent.press(screen.getByTestId('credit-pack-buy'));
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 2500, success_url: EXTERNAL_SUCCESS_URL }),
    );
    expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
  });

  it.each([1000, 9900])('picking the $%s tile updates the primary button, then buys that pack', async (cents) => {
    await render(<CreditPackCheckoutScreen />);
    await fireEvent.press(screen.getByTestId(`credit-pack-${cents}`));
    expect(screen.getByLabelText(`${cents === 1000 ? '$10' : '$99'} pack`).props.accessibilityState).toEqual({ selected: true, checked: true });
    expect(screen.getByLabelText('$25 pack').props.accessibilityState).toEqual({ selected: false, checked: false });
    expect(screen.queryByLabelText('Buy $25 of credits')).toBeNull();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(`Buy ${cents === 1000 ? '$10' : '$99'} of credits`));
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: cents }));
    expect(openURL).toHaveBeenCalledWith(CHECKOUT_URL);
  });

  it.each(['cancel', 'Try again'] as const)('the chosen tile survives a checkout %s', async (way) => {
    if (way === 'Try again') mockCreateCheckout.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    await render(<CreditPackCheckoutScreen />);
    await fireEvent.press(screen.getByTestId('credit-pack-9900'));
    await fireEvent.press(screen.getByLabelText('Buy $99 of credits'));
    if (way === 'cancel') {
      await act(async () => {
        urlListener?.({ url: 'tgp://checkout/cancel' });
      });
    } else {
      await fireEvent.press(screen.getByTestId('credit-pack-retry'));
    }
    expect(screen.getByLabelText('$99 pack').props.accessibilityState).toEqual({ selected: true, checked: true });
    expect(screen.getByLabelText('$25 pack').props.accessibilityState).toEqual({ selected: false, checked: false });
    await fireEvent.press(screen.getByLabelText('Buy $99 of credits'));
    expect(mockCreateCheckout).toHaveBeenCalledTimes(2);
    expect(mockCreateCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ amount_cents: 9900 }));
  });

  it.each([true, false])('number pad (flag %s): keyboard insets on; with the flag on, Buy scrolls into view', async (on) => {
    mockFlags.coachAiCredits = on;
    const shown: Array<() => void> = [];
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: () => void) => {
      if (event === 'keyboardDidShow') shown.push(cb);
      return { remove: jest.fn() };
    }) as never);
    // The preset's ScrollView mock shares one scrollToEnd jest.fn across tests.
    const toEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockClear();
    await render(<CreditPackCheckoutScreen route={routeWith('custom')} />);
    expect(screen.getByTestId('credit-pack-select').props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(screen.getByTestId('credit-pack-custom-input').props.autoFocus).toBe(true);
    expect(screen.getByTestId('ai-pack-option-custom')).toBeTruthy();
    await act(async () => shown.forEach((cb) => cb()));
    if (on) expect(toEnd).toHaveBeenCalledWith({ animated: true });
    else expect(toEnd).not.toHaveBeenCalled();
  });

  it('Other amounts is the same full dark green button as Buy, with its own light haptic', async () => {
    const soft = jest.spyOn(HapticService, 'softImpact').mockResolvedValue(undefined);
    await render(<CreditPackCheckoutScreen />);
    const other = screen.getByTestId('credit-pack-other');
    const style = StyleSheet.flatten(other.props.style);
    expect(style).toEqual(StyleSheet.flatten(screen.getByTestId('credit-pack-buy').props.style));
    expect(style).toMatchObject({ backgroundColor: lightTokens.accent, borderRadius: radius.button });
    expect(style.minHeight).toBeGreaterThanOrEqual(layout.touchMin);
    expect(other).toHaveTextContent('Other amounts');
    expect(other.props.accessibilityRole).toBe('button');
    expect(other.props.accessibilityState).toEqual({ disabled: false, busy: false, expanded: false });
    await fireEvent.press(other);
    expect(soft).toHaveBeenCalledTimes(1);
  });

  it('Other amounts only opens: it leaves, focus moves into the field, and a tile brings both buttons back', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    const spoken = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    await render(<CreditPackCheckoutScreen />);
    await fireEvent.press(screen.getByTestId('credit-pack-9900'));
    await fireEvent.press(screen.getByTestId('credit-pack-other'));
    // No second tap is possible: the button is not drawn while the field is open.
    expect(screen.queryByTestId('credit-pack-other')).toBeNull();
    expect(screen.queryByTestId('credit-pack-buy')).toBeNull();
    expect(screen.getByTestId('credit-pack-other-amounts')).toBeTruthy();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith(expect.anything(), 'focus');
    await fireEvent.changeText(screen.getByTestId('credit-pack-custom-input'), '20');
    expect(focus).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('credit-pack-1000'));
    expect(screen.queryByTestId('credit-pack-other-amounts')).toBeNull();
    expect(screen.getByLabelText('$10 pack').props.accessibilityState).toEqual({ selected: true, checked: true });
    expect(screen.getByLabelText('Buy $10 of credits')).toBeTruthy();
    expect(screen.getByTestId('credit-pack-other')).toBeTruthy();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('credit-pack-other'));
    expect(screen.getByTestId('credit-pack-custom-input').props.value).toBe('20');
    expect(screen.getByLabelText('Buy $20 of credits')).toBeTruthy();
  });

  it('empty or out-of-range: "Enter an amount", disabled, no haptic, nothing sent; a valid amount buys it', async () => {
    const soft = jest.spyOn(HapticService, 'softImpact').mockResolvedValue(undefined);
    await render(<CreditPackCheckoutScreen />);
    await fireEvent.press(screen.getByTestId('credit-pack-other'));
    soft.mockClear();
    expect(screen.queryByText('Custom')).toBeNull();
    for (const typed of ['', '5', '600', 'abc']) {
      await fireEvent.changeText(screen.getByTestId('credit-pack-custom-input'), typed);
      const off = screen.getByTestId('ai-pack-option-custom');
      expect(off).toHaveTextContent('Enter an amount');
      expect(off.props.accessibilityState).toEqual({ disabled: true, busy: false });
      await fireEvent.press(off);
    }
    expect(soft).not.toHaveBeenCalled();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
    expect(screen.queryByTestId('credit-pack-error')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('credit-pack-custom-input'), '20.50');
    const on = screen.getByTestId('ai-pack-option-custom');
    expect(on).toHaveTextContent('Buy $20.50 of credits');
    expect(on.props.accessibilityState).toEqual({ disabled: false, busy: false });
    // The press is onSelect('custom'): the screen sends the typed amount.
    await fireEvent.press(on);
    expect(soft).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 2050 }));
  });

  it('keeps a custom amount typed before the role/pool resolves visible once the suggestion loads', async () => {
    mockRole = 'unknown';
    const ui = await render(<CreditPackCheckoutScreen />);
    await fireEvent.changeText(screen.getByTestId('credit-pack-custom-input'), '20');
    mockRole = 'head_coach';
    await ui.rerender(<CreditPackCheckoutScreen />);
    expect(screen.getByTestId('credit-pack-suggested')).toBeTruthy();
    expect(screen.getByTestId('credit-pack-custom-input').props.value).toBe('20');
    expect(screen.getByLabelText('Buy $20 of credits')).toBeTruthy();
  });

  it.each([0, 50000])('no suggestion for usage %s: original choices, $99 marked selected, no coverage claim', async (used) => {
    mockBudget.used_displayed_cents = used;
    await render(<CreditPackCheckoutScreen />);
    expect(screen.queryByTestId('credit-pack-suggested')).toBeNull();
    expect(screen.getByLabelText('$99 pack').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByLabelText('$25 pack').props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('credit-pack-custom-input')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('$99 pack'));
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 9900 }));
  });

  it('without a loaded pool, shows the original row with $99 and makes no coverage claim', async () => {
    mockBudgetLoading = true;
    await render(<CreditPackCheckoutScreen />);
    expect(screen.queryByTestId('credit-pack-suggested')).toBeNull();
    expect(screen.getByLabelText('$99 pack').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('credit-pack-custom-input')).toBeTruthy();
  });

  it.each(['sub_coach', 'unknown'] as const)('never derives a suggestion from the retained head pool for %s', async (role) => {
    mockRole = role;
    await render(<CreditPackCheckoutScreen />);
    expect(screen.queryByTestId('credit-pack-suggested')).toBeNull();
    expect(screen.queryByText(/should cover you until/)).toBeNull();
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('a failed custom checkout comes back with the field open and the typed amount kept', async () => {
    mockCreateCheckout.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    await render(<CreditPackCheckoutScreen />);
    await fireEvent.press(screen.getByTestId('credit-pack-other'));
    expect(StyleSheet.flatten(screen.getByTestId('credit-pack-custom-input').props.style).minHeight).toBe(layout.touchMin);
    await fireEvent.changeText(screen.getByTestId('credit-pack-custom-input'), '20.50');
    await fireEvent.press(screen.getByLabelText('Buy $20.50 of credits'));
    await fireEvent.press(screen.getByTestId('credit-pack-retry'));
    expect(screen.getByTestId('credit-pack-custom-input').props.value).toBe('20.50');
    expect(screen.queryByTestId('credit-pack-other')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Buy $20.50 of credits'));
    expect(mockCreateCheckout).toHaveBeenCalledTimes(2);
    expect(mockCreateCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ amount_cents: 2050 }));
  });

  it('numeric preselect still starts once; custom preselect reveals and focuses the custom field', async () => {
    const ui = await render(<CreditPackCheckoutScreen route={routeWith('custom')} />);
    expect(screen.getByTestId('credit-pack-custom-input').props.autoFocus).toBe(true);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
    await ui.unmount();
    await render(<CreditPackCheckoutScreen route={routeWith(2500)} />);
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
  });

  it('flag off keeps old words, all choices and no new role read', async () => {
    mockFlags.coachAiCredits = false;
    await render(<CreditPackCheckoutScreen />);
    expect(screen.getByTestId('credit-pack-select')).toHaveTextContent('no multiplier math.', { exact: false });
    expect(screen.getByTestId('ai-pack-option-2500')).toBeTruthy();
    expect(screen.queryByTestId('credit-pack-suggested')).toBeNull();
    expect(mockUseRole).not.toHaveBeenCalled();
    // As on main: the Custom pill stays on and an out-of-range amount gets the error screen.
    await fireEvent.changeText(screen.getByTestId('credit-pack-custom-input'), '5');
    await fireEvent.press(screen.getByTestId('ai-pack-option-custom'));
    expect(screen.getByTestId('credit-pack-error')).toHaveTextContent('Custom packs must be between $10 and $500.', { exact: false });
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });
});
