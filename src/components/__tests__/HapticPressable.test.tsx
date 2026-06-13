/**
 * HapticPressable — reduce-motion regression tests (v3-1 #235 R4 P2-3).
 *
 * The shared press-feedback component runs a scale/opacity Animated.spring +
 * Animated.timing on press-in/out. The audited P2 was that this animation
 * IGNORED the OS "Reduce Motion" setting unless each callsite manually wired
 * `disableAnimation`. The fix centralizes reduce-motion handling INSIDE the
 * component: it reads `AccessibilityInfo.isReduceMotionEnabled()` and subscribes
 * to `reduceMotionChanged`, suppressing the scale/opacity animation when ON —
 * but KEEPS firing haptics. These tests pin both halves of that contract:
 *
 *   1. Reduce motion OFF  -> press runs Animated.spring/timing AND fires haptic.
 *   2. Reduce motion ON   -> press fires haptic but runs NO Animated.spring/timing.
 *   3. Explicit `disableAnimation` still suppresses animation (haptic fires).
 *
 * This file only adds tests; it modifies no production file.
 */
import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Text,
  type EmitterSubscription,
} from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockImpact = jest.fn((_style: string) => Promise.resolve(undefined));
const mockNotification = jest.fn((_type: string) => Promise.resolve(undefined));
jest.mock('expo-haptics', () => ({
  impactAsync: (style: string) => mockImpact(style),
  notificationAsync: (type: string) => mockNotification(type),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import HapticPressable from '../HapticPressable';

function makeSubscription(): EmitterSubscription {
  // @ts-expect-error — remove-only stub; cleanup only calls remove()
  return { remove: jest.fn() };
}

let isReduceMotionSpy: jest.SpyInstance;
let addListenerSpy: jest.SpyInstance;
let springSpy: jest.SpyInstance;
let timingSpy: jest.SpyInstance;

beforeEach(() => {
  mockImpact.mockClear();
  mockNotification.mockClear();
  addListenerSpy = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue(makeSubscription());
  springSpy = jest.spyOn(Animated, 'spring');
  timingSpy = jest.spyOn(Animated, 'timing');
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderButton(props: { disableAnimation?: boolean } = {}) {
  return render(
    <HapticPressable
      intent="light"
      onPress={jest.fn()}
      testID="hp"
      {...props}
    >
      <Text>Tap</Text>
    </HapticPressable>,
  );
}

describe('HapticPressable — reduce motion (P2-3)', () => {
  it('runs the press animation AND fires a haptic when reduce motion is OFF', async () => {
    isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);

    renderButton();
    await waitFor(() => expect(isReduceMotionSpy).toHaveBeenCalled());
    // Subscribed to live changes so a mid-session toggle takes effect.
    expect(addListenerSpy).toHaveBeenCalledWith(
      'reduceMotionChanged',
      expect.any(Function),
    );
    await act(async () => {
      await Promise.resolve();
    });

    springSpy.mockClear();
    timingSpy.mockClear();
    const target = screen.getByTestId('hp');
    await fireEvent(target, 'pressIn');
    await fireEvent(target, 'pressOut');
    await fireEvent.press(target);

    expect(springSpy).toHaveBeenCalled();
    expect(timingSpy).toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledWith('light');
  });

  it('fires a haptic but runs NO press animation when reduce motion is ON', async () => {
    isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);

    renderButton();
    await waitFor(() => expect(isReduceMotionSpy).toHaveBeenCalled());
    // Flush the async reduce-motion resolution so shouldAnimate settles to false.
    await act(async () => {
      await Promise.resolve();
    });

    springSpy.mockClear();
    timingSpy.mockClear();
    const target = screen.getByTestId('hp');
    await fireEvent(target, 'pressIn');
    await fireEvent(target, 'pressOut');
    await fireEvent.press(target);

    // Animation suppressed …
    expect(springSpy).not.toHaveBeenCalled();
    expect(timingSpy).not.toHaveBeenCalled();
    // … but the haptic STILL fires.
    expect(mockImpact).toHaveBeenCalledWith('light');
  });

  it('honors an explicit disableAnimation override (no animation, haptic still fires)', async () => {
    isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);

    renderButton({ disableAnimation: true });
    await waitFor(() => expect(isReduceMotionSpy).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    springSpy.mockClear();
    timingSpy.mockClear();
    const target = screen.getByTestId('hp');
    await fireEvent(target, 'pressIn');
    await fireEvent(target, 'pressOut');
    await fireEvent.press(target);

    expect(springSpy).not.toHaveBeenCalled();
    expect(timingSpy).not.toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledWith('light');
  });
});
