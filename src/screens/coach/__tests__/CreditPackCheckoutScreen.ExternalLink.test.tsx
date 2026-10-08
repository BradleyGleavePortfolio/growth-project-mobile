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
 */
import React from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

const mockFlags = { iosHideNonP2PPurchases: true, iosUsCreditPackLink: true };
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
jest.mock('../../../hooks/useAIBudget', () => ({
  useAIBudget: () => ({
    data: { remaining_displayed_cents: 0, pack_options_cents: [1000, 2500, 9900], custom_pack_bounds_cents: { min: 1000, max: 50000 } },
  }),
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
} from '../CreditPackCheckoutScreen';

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
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
  mockCreateCheckout.mockReset().mockResolvedValue({
    data: { checkout_session_id: 'cs_live_abc', checkout_url: CHECKOUT_URL, amount_cents: 1000 },
  });
  mockInvalidate.mockClear();
  mockGoBack.mockClear();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
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

describe('US-link build: credit-pack checkout in the system browser', () => {
  it('says who is paid, opens Stripe in the browser with tgp return links, and never mounts the WebView', async () => {
    await render(<CreditPackCheckoutScreen />);
    expect(screen.getByTestId('credit-pack-pays-tgp')).toHaveTextContent(/You pay TGP the pack price through Stripe checkout/);
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
  });

  it('Stripe success link shows the receipt and refetches the budget', async () => {
    await render(<CreditPackCheckoutScreen />);
    await tapFirstPack();
    expect(urlListener).not.toBeNull();
    await act(async () => {
      urlListener?.({ url: 'tgp://checkout/success?session_id=cs_live_abc' });
    });
    expect(screen.getByTestId('credit-pack-success')).toBeTruthy();
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
