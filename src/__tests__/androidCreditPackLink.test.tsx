/**
 * PACKS-BOTH-131 (owner 10-08: AI packs must be purchasable on Android and
 * iOS). With EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK on (eas.json preview and
 * clinic-apk profiles only, the Android test apps), an Android release build shows the AI
 * credit packs and opens Stripe Checkout in the system browser, like the iOS
 * US link. Everything else sold stays hidden on Android. The eas.json profiles
 * go through the real flag reader: iOS clinic 'external', iOS default
 * 'hidden', Android preview and clinic-apk 'external', Android store profiles 'hidden'.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockState = { hide: true, usLink: false, androidLink: true };
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  const keys: Record<string, 'hide' | 'usLink' | 'androidLink'> = {
    iosHideNonP2PPurchases: 'hide',
    iosUsCreditPackLink: 'usLink',
    androidCreditPackLink: 'androidLink',
  };
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) =>
        typeof k === 'string' && k in keys ? mockState[keys[k]] : (t as Record<string | symbol, unknown>)[k],
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
import { COACH_PUSH_ROUTES } from '../services/pushTapRouter';
import {
  CREDIT_PACK_NON_REFUNDABLE,
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

const realOS = Platform.OS;
const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;

function androidRelease(androidLink: boolean) {
  Object.assign(mockState, { hide: true, usLink: false, androidLink });
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  g.__DEV__ = false;
}

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
  g.__DEV__ = realDev;
  mockNavigate.mockClear();
});

describe('creditPackCheckoutMode with the Android switch', () => {
  it.each([
    ['android', true, false, true, 'external'],
    ['android', true, false, false, 'hidden'],
    ['android', true, true, false, 'hidden'],
    ['ios', true, false, true, 'hidden'],
    ['ios', true, true, false, 'external'],
    ['android', false, false, true, 'in-app'],
  ])('%s, digital hidden %p, iOS link %p, Android link %p → %s', (os, digitalHidden, usLink, androidLink, mode) => {
    expect(creditPackCheckoutMode(os, digitalHidden, usLink, androidLink)).toBe(mode);
  });
});

describe('eas.json profiles through the real flag reader (release bundle)', () => {
  type Profile = { extends?: string; env?: Record<string, string> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const eas = require('../../eas.json') as { build: Record<string, Profile> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const iosBuild = Number(require('../../app.json').expo.ios.buildNumber);
  const KEYS = [
    'NODE_ENV',
    'EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES',
    'EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK',
    'EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK',
  ];
  const profileEnv = (name: string | null): Record<string, string> =>
    name === null ? {} : { ...profileEnv(eas.build[name].extends ?? null), ...(eas.build[name].env ?? {}) };

  function modeFor(os: 'ios' | 'android', profile: string | null): string {
    const env = process.env as Record<string, string | undefined>;
    const saved = KEYS.map((k) => [k, env[k]] as const);
    const savedDev = g.__DEV__;
    const target: Record<string, string> = { ...profileEnv(profile), NODE_ENV: 'production' };
    for (const k of KEYS) {
      if (target[k] === undefined) delete env[k];
      else env[k] = target[k];
    }
    g.__DEV__ = false;
    let flags = { iosHideNonP2PPurchases: false, iosUsCreditPackLink: false, androidCreditPackLink: false };
    try {
      jest.isolateModules(() => {
        flags = jest.requireActual('../config/featureFlags').featureFlags;
      });
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
      g.__DEV__ = savedDev;
    }
    const digitalHidden = digitalPurchasesHidden(os, flags.iosHideNonP2PPurchases, iosBuild, false);
    return creditPackCheckoutMode(os, digitalHidden, flags.iosUsCreditPackLink, flags.androidCreditPackLink);
  }

  it.each([
    ['ios', 'clinic', 'external'],
    ['ios', 'production', 'hidden'],
    ['ios', 'preview', 'hidden'],
    ['ios', null, 'hidden'],
    ['android', 'preview', 'external'],
    ['android', 'clinic-apk', 'external'],
    ['android', 'production', 'hidden'],
    ['android', 'clinic', 'hidden'],
    ['android', null, 'hidden'],
  ] as const)('%s, profile %s → %s', (os, profile, mode) => {
    expect(modeFor(os, profile)).toBe(mode);
  });

  it('the Android switch is set only in the preview and clinic-apk profiles (never a store profile)', () => {
    expect(eas.build.preview.env?.EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK).toBe('true');
    expect(eas.build['clinic-apk'].env?.EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK).toBe('true');
    for (const name of ['development', 'production', 'clinic']) {
      expect(profileEnv(name)).not.toHaveProperty('EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK');
    }
  });
});

describe('Android release build, Android link on (preview profile)', () => {
  beforeEach(async () => {
    androidRelease(true);
    await AsyncStorage.clear();
  });

  it('packs show and a budget push opens them; seat upgrades stay hidden; the header says packs are sold', async () => {
    expect(creditPackCheckoutMode()).toBe('external');
    expect(creditPacksHidden()).toBe(false);
    expect(digitalPurchasesHidden()).toBe(true);
    expect(purchasePolicyHeader()).toBe('p2p-and-ai-credits');
    expect(COACH_PUSH_ROUTES.CreditPackCheckout()).toEqual({ root: 'SettingsStack', screen: 'CreditPackCheckout' });
    const gate = await render(<UpgradeGate />);
    expect(JSON.stringify(gate.toJSON())).not.toMatch(/Upgrade/);
  });

  it('hard pause: packs, who is paid and the non-refundable line; a pack tap carries that pack to checkout', async () => {
    mockBudget = budget(100);
    const utils = await render(<AIBudgetMount />);
    expect(utils.getByTestId('ai-hard-pause-pays-tgp')).toBeTruthy();
    expect(CREDIT_PACK_NON_REFUNDABLE).toBe('Credit packs are non-refundable.');
    expect(utils.getByTestId('ai-pack-non-refundable')).toHaveTextContent(CREDIT_PACK_NON_REFUNDABLE);
    await fireEvent.press(utils.getByTestId('ai-pack-option-2500'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', {
      screen: 'CreditPackCheckout',
      params: { preselect: 2500 },
    });
  });

  it('95% banner: Buy credits opens checkout', async () => {
    mockBudget = budget(96);
    const banner = await render(<AIBudgetMount />);
    await fireEvent.press(banner.getByText('Buy credits'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CreditPackCheckout', params: { preselect: 'custom' } });
  });

  it('tutorial last card: packs with the non-refundable line', async () => {
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
      expect(utils.getByTestId('ai-pack-option-1000')).toBeTruthy();
      expect(utils.getByTestId('ai-pack-non-refundable')).toHaveTextContent(CREDIT_PACK_NON_REFUNDABLE);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Android release build without the switch (production, clinic)', () => {
  it('no packs and no pack terms anywhere; the header stays all', async () => {
    androidRelease(false);
    expect(creditPacksHidden()).toBe(true);
    expect(purchasePolicyHeader()).toBe('all');
    const row = await render(<PackOptionsRow options={[1000]} onSelect={jest.fn()} />);
    expect(row.queryByTestId('ai-pack-option-1000')).toBeNull();
    expect(row.queryByTestId('ai-pack-non-refundable')).toBeNull();
    mockBudget = budget(100);
    const pause = await render(<AIBudgetMount />);
    expect(pause.getByTestId('ai-hard-pause-neutral')).toBeTruthy();
    expect(pause.queryByText(CREDIT_PACK_NON_REFUNDABLE)).toBeNull();
    expect(COACH_PUSH_ROUTES.CreditPackCheckout()).toEqual({ root: 'SettingsStack', screen: 'SettingsHome' });
  });
});
