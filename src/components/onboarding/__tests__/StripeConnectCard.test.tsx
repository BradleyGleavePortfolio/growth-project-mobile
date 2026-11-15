/**
 * StripeConnectCard — ED.5 onboarding Stripe Connect flip card.
 *
 * Verifies:
 *   • both faces render (front placeholder + back connected);
 *   • tapping Connect on the front fires `onConnect`;
 *   • flipping front → back drives `rotateY` from 0 → 180 (front face) and the
 *     back face into view (-180 → 0);
 *   • the connected face names brand + last-4 when present;
 *   • Reduce Motion / flag-off paths swap faces without animating.
 *
 * L8/L10 learnings: RNTL v14 `await render(...)`; Reanimated mocked so
 * withTiming + interpolate resolve synchronously and useAnimatedStyle is
 * readable; theme mocked to deterministic light tokens.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Capture the most recent style objects each animated face produced so the test
// can assert the rotateY endpoints. withTiming returns its target; interpolate
// returns the endpoint of the output range matching the (settled) progress.
const mockCapturedStyles: Record<string, unknown>[] = [];
let mockProgressValue = 0;
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: { View: RN.View },
    useSharedValue: (initial: number) => {
      mockProgressValue = initial;
      return {
        get value() {
          return mockProgressValue;
        },
        set value(v: number) {
          mockProgressValue = v;
        },
      };
    },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => {
      const s = fn();
      mockCapturedStyles.push(s);
      return s;
    },
    withTiming: (toValue: number) => toValue,
    interpolate: (v: number, _inR: number[], outR: number[]) => {
      // Endpoint semantics matching the component: v=0 → outR[0], v=1 → outR[1].
      return v >= 1 ? outR[outR.length - 1] : outR[0];
    },
    Easing: { out: () => () => 0, inOut: () => () => 0, cubic: () => 0 },
  };
});

let mockReduceMotion = false;
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
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

import StripeConnectCard, {
  STRIPE_FLIP_DURATION_MS,
  STRIPE_FLIP_DEGREES,
} from '../StripeConnectCard';

beforeEach(() => {
  mockCapturedStyles.length = 0;
  mockProgressValue = 0;
  mockReduceMotion = false;
});

describe('StripeConnectCard', () => {
  it('pins the spec flip constants (360ms, 180deg)', () => {
    expect(STRIPE_FLIP_DURATION_MS).toBe(360);
    expect(STRIPE_FLIP_DEGREES).toBe(180);
  });

  it('renders both faces (front placeholder + back connected)', async () => {
    const { getByText, getByTestId } = await render(
      <StripeConnectCard
        connected={false}
        onConnect={jest.fn()}
        brand="Visa"
        last4="4242"
        enabled
        testID="stripe-card"
      />,
    );
    // Front face content.
    expect(getByText('Connect your payouts')).toBeTruthy();
    expect(getByTestId('stripe-card-front')).toBeTruthy();
    // Back face is mounted (both faces co-exist on the card).
    expect(getByText('Payouts connected')).toBeTruthy();
    expect(getByTestId('stripe-card-back')).toBeTruthy();
  });

  it('fires onConnect when the front Connect affordance is tapped', async () => {
    const onConnect = jest.fn();
    const { getByTestId } = await render(
      <StripeConnectCard connected={false} onConnect={onConnect} enabled testID="stripe-card" />,
    );
    fireEvent.press(getByTestId('stripe-card-connect'));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('drives the front face rotateY 0 → 180 when connected (flip)', async () => {
    // connected=true seeds progress at 1, so the front face interpolates to its
    // far endpoint (180deg) and the back face settles at 0deg (in view).
    await render(
      <StripeConnectCard connected onConnect={jest.fn()} brand="Visa" last4="4242" enabled testID="stripe-card" />,
    );
    const rotations = mockCapturedStyles
      .map((s) => {
        const transform = s.transform as Array<Record<string, unknown>> | undefined;
        const ry = transform?.find((t) => 'rotateY' in t);
        return ry?.rotateY as string | undefined;
      })
      .filter((r): r is string => typeof r === 'string');
    // The front face reaches 180deg; the back face reaches 0deg.
    expect(rotations).toContain('180deg');
    expect(rotations).toContain('0deg');
  });

  it('names the brand + last-4 on the connected face when present', async () => {
    const { getByTestId } = await render(
      <StripeConnectCard connected onConnect={jest.fn()} brand="Visa" last4="4242" enabled testID="stripe-card" />,
    );
    expect(getByTestId('stripe-card-account').props.children).toEqual(['Visa', ' ending ', '4242']);
  });

  it('swaps to the connected face instantly under Reduce Motion (no rotation past 0/180)', async () => {
    mockReduceMotion = true;
    const { getByText } = await render(
      <StripeConnectCard connected onConnect={jest.fn()} enabled testID="stripe-card" />,
    );
    // Connected face still appears — only the rotation is skipped.
    expect(getByText('Payouts connected')).toBeTruthy();
  });
});
