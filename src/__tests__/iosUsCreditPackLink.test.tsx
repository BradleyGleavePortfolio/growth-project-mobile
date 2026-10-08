/**
 * CREDIT-PAY-130 (owner decision 10 fallback): with the build-time switch
 * EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK on, an iOS store build shows the AI
 * credit packs again (system-browser checkout). Everything else the iOS gate
 * hides stays hidden, and Android release builds stay hidden. Real surfaces,
 * real gate, __DEV__ false (release semantics).
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockState: { hide: boolean; usLink: boolean } = { hide: true, usLink: true };
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) =>
        k === 'iosHideNonP2PPurchases'
          ? mockState.hide
          : k === 'iosUsCreditPackLink'
            ? mockState.usLink
            : (t as Record<string | symbol, unknown>)[k],
    }),
  };
});
jest.mock('expo-application', () => ({ nativeBuildVersion: '7' }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: number) => v,
    Easing: { out: () => () => 0, cubic: () => 0, inOut: () => () => 0, quad: () => 0, linear: () => 0 },
  };
});
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));
let mockBudget: CoachAIBudgetResponse | undefined;
jest.mock('../hooks/useAIBudget', () => ({ useAIBudget: () => ({ data: mockBudget }) }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoachAIBudgetResponse } from '../api/types/coachAIBudget';
import { AIBudgetMount } from '../components/coach/ai-budget/AIBudgetMount';
import { AIBudgetTutorialModal } from '../components/coach/ai-budget/AIBudgetTutorialModal';
import { PackOptionsRow } from '../components/coach/ai-budget/PackOptionsRow';
import { UpgradeGate } from '../screens/coach/TeamManagementScreen';
import { withNonP2PPurchaseGate } from '../components/purchases/withNonP2PPurchaseGate';
import { COACH_PUSH_ROUTES } from '../services/pushTapRouter';
import {
  creditPackCheckoutMode,
  creditPacksHidden,
  digitalPurchasesHidden,
  purchasePolicyHeader,
} from '../config/purchaseSurfaces';

function budget(pct: number): CoachAIBudgetResponse {
  return {
    period_start: '2026-10-01T00:00:00Z',
    period_end: '2026-11-01T00:00:00Z',
    base_displayed_cents: 12500,
    pack_displayed_cents: 0,
    total_displayed_cents: 12500,
    used_displayed_cents: Math.round(12500 * (pct / 100)),
    remaining_displayed_cents: 0,
    pct_used: pct,
    base_actual_cents: 4000,
    value_multiplier: '3.125',
    actual_used_cents: 4000,
    pack_options_cents: [1000, 2500, 9900],
    custom_pack_bounds_cents: { min: 1000, max: 50000 },
  };
}

describe('creditPackCheckoutMode decision table', () => {
  it.each([
    ['ios', true, true, 'external'],
    ['ios', true, false, 'hidden'],
    ['android', true, true, 'hidden'],
    ['ios', false, false, 'in-app'],
    ['android', false, true, 'in-app'],
  ])('%s, digital hidden %p, US link %p → %s', (os, digitalHidden, usLink, mode) => {
    expect(creditPackCheckoutMode(os, digitalHidden, usLink)).toBe(mode);
  });

  it('the switch is on only in the clinic (App Store) profile', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../../eas.json');
    expect(eas.build.clinic.env.EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK).toBe('true');
    expect(eas.build.production.env).not.toHaveProperty('EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK');
    expect(eas.build.preview.env).not.toHaveProperty('EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK');
  });
});

const realOS = Platform.OS;
const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;

function setRow(os: 'ios' | 'android', usLink: boolean) {
  mockState.hide = true;
  mockState.usLink = usLink;
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  g.__DEV__ = false;
}

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
  g.__DEV__ = realDev;
  mockNavigate.mockClear();
});

describe('iOS store build, US link on', () => {
  beforeEach(async () => {
    setRow('ios', true);
    await AsyncStorage.clear();
  });

  it('credit packs show; other digital purchases stay hidden; the header says so', async () => {
    expect(creditPackCheckoutMode()).toBe('external');
    expect(creditPacksHidden()).toBe(false);
    expect(digitalPurchasesHidden()).toBe(true);
    expect(purchasePolicyHeader()).toBe('p2p-and-ai-credits');
    const gate = await render(<UpgradeGate />);
    expect(JSON.stringify(gate.toJSON())).not.toMatch(/Upgrade/);
  });

  it('the checkout route mounts and a budget push opens it', async () => {
    const Gated = withNonP2PPurchaseGate(() => <Text>Digital checkout</Text>, creditPacksHidden);
    const utils = await render(<Gated />);
    expect(utils.getByText('Digital checkout')).toBeTruthy();
    expect(COACH_PUSH_ROUTES.CreditPackCheckout()).toEqual({ root: 'SettingsStack', screen: 'CreditPackCheckout' });
  });

  it('meter chip offers the packs', async () => {
    mockBudget = budget(60);
    const chip = await render(<AIBudgetMount />);
    expect(chip.getByTestId('ai-budget-mount-chip').props.accessibilityRole).toBe('button');
  });

  it('95% banner: Buy credits opens checkout', async () => {
    mockBudget = budget(96);
    const banner = await render(<AIBudgetMount />);
    await fireEvent.press(banner.getByText('Buy credits'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CreditPackCheckout', params: { preselect: 'custom' } });
  });

  it('hard pause shows the three packs, Custom and who is paid', async () => {
    mockBudget = budget(100);
    const utils = await render(<AIBudgetMount />);
    for (const id of ['ai-pack-option-1000', 'ai-pack-option-2500', 'ai-pack-option-9900', 'ai-pack-option-custom']) {
      expect(utils.getByTestId(id)).toBeTruthy();
    }
    expect(utils.getByTestId('ai-hard-pause-pays-tgp')).toHaveTextContent(
      'You pay TGP the pack price through Stripe checkout, which opens in your browser.',
    );
  });

  it('after Close on the pause sheet, the meter chip stays and opens the packs (U2)', async () => {
    mockBudget = budget(100);
    const utils = await render(<AIBudgetMount />);
    expect(utils.queryByTestId('ai-budget-mount-chip')).toBeNull();
    await fireEvent.press(utils.getByTestId('ai-hard-pause-close'));
    const chip = utils.getByTestId('ai-budget-mount-chip');
    expect(chip.props.accessibilityRole).toBe('button');
    await fireEvent.press(chip);
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CreditPackCheckout', params: { preselect: 'custom' } });
  });

  it('tutorial last card: packs, who is paid, and "Not now" (no first person)', async () => {
    jest.useFakeTimers();
    try {
      const utils = await render(
        <AIBudgetTutorialModal visible budget={budget(80)} onClose={jest.fn()} onSelectPack={jest.fn()} />,
      );
      for (let i = 0; i < 3; i += 1) {
        await fireEvent.press(utils.getByTestId('ai-tutorial-continue'));
        await act(() => {
          jest.advanceTimersByTime(300);
        });
      }
      const text = JSON.stringify(utils.toJSON());
      expect(utils.getByTestId('ai-pack-option-1000')).toBeTruthy();
      expect(text).toMatch(/You pay TGP the pack price through Stripe checkout/);
      expect(utils.getByTestId('ai-tutorial-later')).toHaveTextContent('Not now');
      expect(text).not.toMatch(/I'll|I&apos;ll|\bI\b/);
      // FIX-OPUS-B-131 (B1): Coach Home shows no meter at 80-94%, so the guide never points to one.
      expect(text).toMatch(/this guide appears once a month\./);
      expect(text).not.toMatch(/meter/i);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the switch never shows packs where it does not apply', () => {
  it.each([
    ['Android release, switch on', 'android' as const, true, 'all'],
    ['iOS store build, switch off', 'ios' as const, false, 'p2p-only'],
  ])('%s: packs hidden', async (_name, os, usLink, header) => {
    setRow(os, usLink);
    expect(creditPacksHidden()).toBe(true);
    expect(purchasePolicyHeader()).toBe(header);
    const row = await render(<PackOptionsRow options={[1000]} onSelect={jest.fn()} />);
    expect(row.queryByTestId('ai-pack-option-1000')).toBeNull();
    expect(COACH_PUSH_ROUTES.CreditPackCheckout()).toEqual({ root: 'SettingsStack', screen: 'SettingsHome' });
  });

  it('iOS store build, switch off: closing the pause sheet adds no chip', async () => {
    setRow('ios', false);
    mockBudget = budget(100);
    const utils = await render(<AIBudgetMount />);
    await fireEvent.press(utils.getByTestId('ai-hard-pause-close'));
    expect(utils.queryByTestId('ai-hard-pause-close')).toBeNull();
    expect(utils.queryByTestId('ai-budget-mount-chip')).toBeNull();
  });
});
