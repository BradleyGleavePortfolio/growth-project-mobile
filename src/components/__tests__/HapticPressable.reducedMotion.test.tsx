/**
 * HapticPressable — reduced-motion regression test (Roman P1 #238 R4 P2).
 *
 * `HapticPressable` is the global press primitive behind every menu row,
 * including the client Roman entry row in `MoreScreen`. Its press feedback runs
 * a scale (`Animated.spring`) + opacity (`Animated.timing`) micro-animation on
 * press-in/press-out. Under the OS "Reduce Motion" setting this decorative
 * motion MUST be suppressed for ALL rows, not just Roman.
 *
 * The gate reads the shared `useReduceMotion()` hook. Because that resolution is
 * async + event-driven it can silently regress, so these tests pin BOTH sides of
 * the contract by mocking the hook and observing the Animated seam directly:
 *
 *   1. Reduce-motion ON  → press-in/press-out fire NO `Animated.timing` (opacity)
 *      and NO `Animated.spring` (scale), and the scale Animated.Value is never
 *      driven below its resting value of 1 (no shrink).
 *   2. Reduce-motion OFF → press-in DOES run the scale spring (toValue < 1) and
 *      the opacity timing, proving the gate is the cause of (1) and the test is
 *      not vacuously passing.
 *
 * Haptics and the forwarded button role/onPress are unaffected either way.
 *
 * NOTE: this file only adds a test plus the production gate it covers; it does
 * not weaken any existing behaviour.
 */
import React from 'react';
import { Animated, Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

import HapticPressable from '../HapticPressable';
import { useReduceMotion } from '../../screens/client/wearables/components/useReduceMotion';

// The reduce-motion preference is the single seam under test; mock the shared
// hook so each case drives a deterministic value with no async/event timing.
jest.mock('../../screens/client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: jest.fn(),
}));

// Haptics are a fire-and-forget side channel we do not assert on here; stub so
// the press handler never touches native hardware during the test.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const mockUseReduceMotion = useReduceMotion as jest.MockedFunction<
  typeof useReduceMotion
>;

const TEST_ID = 'haptic-pressable-under-test';

/** The `toValue`s of every Animated.spring call captured so far. */
function springToValues(spy: jest.SpyInstance): unknown[] {
  return spy.mock.calls.map(
    (call) => (call[1] as { toValue?: unknown } | undefined)?.toValue,
  );
}

describe('HapticPressable — reduced motion', () => {
  let timingSpy: jest.SpyInstance;
  let springSpy: jest.SpyInstance;

  beforeEach(() => {
    // Keep real animation behaviour so .start() works; we only OBSERVE.
    timingSpy = jest.spyOn(Animated, 'timing');
    springSpy = jest.spyOn(Animated, 'spring');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockUseReduceMotion.mockReset();
  });

  it('Reduce Motion ENABLED: press-in/out fire no scale/opacity animation and never shrink scale below 1', () => {
    mockUseReduceMotion.mockReturnValue(true);

    const onPress = jest.fn();
    const { getByTestId } = render(
      <HapticPressable testID={TEST_ID} onPress={onPress}>
        <Text>Roman</Text>
      </HapticPressable>,
    );

    const node = getByTestId(TEST_ID);

    // Mounting may legitimately set up Animated.Values; clear so we only count
    // animation calls caused by the press interaction itself.
    timingSpy.mockClear();
    springSpy.mockClear();

    fireEvent(node, 'pressIn');
    fireEvent(node, 'pressOut');
    fireEvent.press(node);

    // No press animation ran under Reduce Motion.
    expect(timingSpy).not.toHaveBeenCalled();
    expect(springSpy).not.toHaveBeenCalled();

    // Defensive: even if some spring slipped through, none requested a shrink.
    for (const toValue of springToValues(springSpy)) {
      expect(typeof toValue === 'number' ? toValue : 1).toBeGreaterThanOrEqual(1);
    }

    // The press itself (haptic + onPress) still fires — only motion is gated.
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Reduce Motion DISABLED: press-in runs the scale spring (toValue < 1) and opacity timing', () => {
    mockUseReduceMotion.mockReturnValue(false);

    const { getByTestId } = render(
      <HapticPressable testID={TEST_ID} pressScale={0.97}>
        <Text>Roman</Text>
      </HapticPressable>,
    );

    const node = getByTestId(TEST_ID);
    timingSpy.mockClear();
    springSpy.mockClear();

    fireEvent(node, 'pressIn');

    // The scale spring runs and DOES shrink below the resting value of 1.
    expect(springSpy).toHaveBeenCalled();
    const shrinkValues = springToValues(springSpy).filter(
      (v): v is number => typeof v === 'number' && v < 1,
    );
    expect(shrinkValues).toContain(0.97);

    // The opacity timing also runs.
    expect(timingSpy).toHaveBeenCalled();
  });
});
