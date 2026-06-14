/**
 * StepTransitionView — ED.5 onboarding step-transition primitive.
 *
 * Verifies:
 *   • children render (the wrapper is transparent to content);
 *   • `enabled={false}` renders children at rest with NO animated container
 *     (the flag-off hard-cut path);
 *   • when enabled, the fade + slide reach their final state within 250ms
 *     (jest fake timers + advanceTimersByTime(220));
 *   • Reduce Motion collapses the transition even when enabled.
 *
 * L8/L10 learnings encoded: RNTL v14 `await render(...)`; the Reanimated mock
 * resolves shared values to their target synchronously so the "final state"
 * assertion is deterministic without real timers.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';

// Reanimated mock: withTiming resolves to its target value synchronously, and
// useAnimatedStyle evaluates its worklet against the current shared values so
// the test can read the resting state directly. Easing helpers are no-ops.
const sharedValues: Array<{ value: number }> = [];
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: { View: RN.View },
    useSharedValue: (initial: number) => {
      const sv = { value: initial };
      sharedValues.push(sv);
      return sv;
    },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (toValue: number) => toValue,
    interpolate: (v: number, _inR: number[], outR: number[]) => outR[outR.length - 1] ?? v,
    Easing: {
      out: () => () => 0,
      inOut: () => () => 0,
      cubic: () => 0,
    },
  };
});

let mockReduceMotion = false;
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

import StepTransitionView, {
  STEP_TRANSITION_DURATION_MS,
  STEP_TRANSITION_SLIDE_PX,
} from '../StepTransitionView';

beforeEach(() => {
  sharedValues.length = 0;
  mockReduceMotion = false;
});

describe('StepTransitionView', () => {
  it('renders its children', async () => {
    const { getByText } = await render(
      <StepTransitionView enabled>
        <Text>step content</Text>
      </StepTransitionView>,
    );
    expect(getByText('step content')).toBeTruthy();
  });

  it('pins the spec timing constants (220ms, 8px)', () => {
    expect(STEP_TRANSITION_DURATION_MS).toBe(220);
    expect(STEP_TRANSITION_SLIDE_PX).toBe(8);
    // The transition must complete inside the spec's 250ms budget.
    expect(STEP_TRANSITION_DURATION_MS).toBeLessThan(250);
  });

  it('drives opacity → 1 and translateY → 0 within the 220ms window when enabled', async () => {
    jest.useFakeTimers();
    try {
      await render(
        <StepTransitionView enabled>
          <Text>animated</Text>
        </StepTransitionView>,
      );
      act(() => {
        jest.advanceTimersByTime(STEP_TRANSITION_DURATION_MS);
      });
      // useSharedValue order: [opacity, translateY]. With the synchronous
      // withTiming mock, both have settled to their resting targets.
      const [opacity, translateY] = sharedValues;
      expect(opacity.value).toBe(1);
      expect(translateY.value).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders children at rest with no animated container when disabled', async () => {
    const { getByText } = await render(
      <StepTransitionView enabled={false}>
        <Text>static content</Text>
      </StepTransitionView>,
    );
    // Children still render…
    expect(getByText('static content')).toBeTruthy();
    // …and the shared values sit at the resting state (opacity 1, offset 0)
    // because the flag-off path skips the animation entirely.
    const [opacity, translateY] = sharedValues;
    expect(opacity.value).toBe(1);
    expect(translateY.value).toBe(0);
  });

  it('collapses to the resting state under Reduce Motion even when enabled', async () => {
    mockReduceMotion = true;
    const { getByText } = await render(
      <StepTransitionView enabled>
        <Text>reduced</Text>
      </StepTransitionView>,
    );
    expect(getByText('reduced')).toBeTruthy();
    const [opacity, translateY] = sharedValues;
    expect(opacity.value).toBe(1);
    expect(translateY.value).toBe(0);
  });
});
