/**
 * onboardingPolishFlagOff — R79 doctrine pin for ED.5.
 *
 * Proves the ED.5 onboarding polish layer is fully contained when
 * `featureFlags.romanOnboardingPolish` is OFF (the production default):
 *
 *   1. RENDER — with the flag forced OFF, OnboardingLayout (the shared chrome
 *      that hosts every OnboardingStep1–10 screen) mounts its content WITHOUT
 *      the animated StepTransitionView container: the children render at rest
 *      and no Reanimated animation is started. A PermanenceMarker mounted with
 *      the flag off renders NOTHING, and a StripeConnectCard with the flag off
 *      shows the correct static face with no flip.
 *
 *   2. STATIC GUARD — every onboarding surface that hosts an ED.5 component
 *      passes the flag through `enabled={featureFlags.romanOnboardingPolish}`
 *      (or, for the OnboardingStep screens, via OnboardingLayout which does).
 *      A surface that mounted a polish component unconditionally — or hard-coded
 *      `enabled` true — would fail here.
 *
 * The flag is the kill switch: OFF ⇒ the onboarding flow behaves exactly as it
 * did before ED.5 (hard-cut transitions, static Stripe card, no permanence
 * marker). This is a presentation-only flag with no backend dependency.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

// Force the ED.5 flag OFF — the production default posture.
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    romanOnboardingPolish: false,
  },
}));

// Track whether any Reanimated timing animation is started. With the flag off,
// the StepTransitionView's animated branch must never run, so withTiming must
// not be invoked during a flag-off mount.
const withTimingCalls: number[] = [];
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: { View: (props: Record<string, unknown>) => RN.createElement(RN.View, props) },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (toValue: number) => {
      withTimingCalls.push(toValue);
      return toValue;
    },
    interpolate: (v: number, _inR: number[], outR: number[]) => outR[0] ?? v,
    Easing: { out: () => () => 0, inOut: () => () => 0, cubic: () => 0 },
  };
});

jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

jest.mock('../../../theme/ThemeProvider', () => ({
  __esModule: true,
  useTheme: () => ({
    semanticColors: {
      bgPrimary: '#F5EFE4',
      bgSurface: '#FFFDF8',
      textPrimary: '#1A1A18',
      textMuted: '#6B675F',
      accent: '#4A0404',
      accentText: '#4A0404',
      textOnAccent: '#FBF7F0',
      disabledBg: '#E0D9CE',
      textOnDisabled: '#524E47',
      border: '#DCD5CC',
      overlay: 'rgba(26,26,24,0.40)',
    },
  }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import OnboardingLayout from '../../../components/OnboardingLayout';
import PermanenceMarker from '../../../components/onboarding/PermanenceMarker';
import StripeConnectCard from '../../../components/onboarding/StripeConnectCard';

beforeEach(() => {
  withTimingCalls.length = 0;
});

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
function readSrc(...rel: string[]): string {
  return fs.readFileSync(path.join(ROOT, 'src', ...rel), 'utf8');
}

describe('ED.5 onboarding polish — flag OFF containment (R79 pin)', () => {
  it('OnboardingLayout renders step content with NO animation when the flag is OFF', async () => {
    const { getByText } = await render(
      <OnboardingLayout step={1} totalSteps={10} title="Step" onContinue={jest.fn()}>
        <Text>step body</Text>
      </OnboardingLayout>,
    );
    // Content still renders…
    expect(getByText('step body')).toBeTruthy();
    expect(getByText('Step')).toBeTruthy();
    // …but the flag-off StepTransitionView never starts a timing animation.
    expect(withTimingCalls).toHaveLength(0);
  });

  it('PermanenceMarker renders nothing when the flag is OFF', async () => {
    const { queryByTestId } = await render(
      <PermanenceMarker kind="packageSaved" saved enabled={false} testID="pm" />,
    );
    expect(queryByTestId('pm')).toBeNull();
  });

  it('StripeConnectCard does not flip (no timing animation) when the flag is OFF', async () => {
    const { getByText } = await render(
      <StripeConnectCard connected onConnect={jest.fn()} enabled={false} testID="stripe-card" />,
    );
    // The connected face is shown statically; no flip animation is started.
    expect(getByText('Payouts connected')).toBeTruthy();
    expect(withTimingCalls).toHaveLength(0);
  });

  // ── Static guard: every onboarding host gates ED.5 on the flag ────────────
  it('OnboardingLayout gates StepTransitionView on featureFlags.romanOnboardingPolish', () => {
    const src = readSrc('components', 'OnboardingLayout.tsx');
    expect(src).toMatch(/enabled=\{featureFlags\.romanOnboardingPolish\}/);
    expect(src).toMatch(/StepTransitionView/);
  });

  it.each([
    ['LeanQ2ExperienceScreen.tsx'],
    ['LeanQ3IntentScreen.tsx'],
    ['LeanQ5Screen.tsx'],
    ['OnboardingResults.tsx'],
  ])('%s gates StepTransitionView on the flag', (file) => {
    const src = readSrc('screens', 'onboarding', file);
    expect(src).toMatch(/StepTransitionView/);
    expect(src).toMatch(/enabled=\{featureFlags\.romanOnboardingPolish\}/);
  });

  it('the ED.5 flag exists and defaults OFF (read from env, fallback false)', () => {
    const src = readSrc('config', 'featureFlags.ts');
    expect(src).toMatch(/romanOnboardingPolish:\s*readFlag\(\s*'EXPO_PUBLIC_FF_ROMAN_ONBOARDING_POLISH',\s*false,?\s*\)/);
  });
});
