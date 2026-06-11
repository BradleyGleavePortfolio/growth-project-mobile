/**
 * CompletionToast — reduced-motion regression test (UX re-audit R3 TEST-01).
 *
 * The toast's vertical slide is an "Empty Confirmation" micro-interaction
 * (design-doctrine AP-4). When the OS "Reduce Motion" setting is on it MUST
 * suppress that slide and only cross-fade; when it is off it MUST perform the
 * normal rise from +16 to 0. The behaviour depends on two async/event seams:
 *
 *   - the mount-time `AccessibilityInfo.isReduceMotionEnabled()` resolution, and
 *   - the live `reduceMotionChanged` subscription that lets a mid-session
 *     settings flip apply to the NEXT toast.
 *
 * Because that resolution is asynchronous and event-driven, the path can
 * silently regress. These tests pin it directly by asserting BOTH observable
 * sides of the contract:
 *
 *   1. The rendered toast's resting `translateY` transform — `0` when reduced
 *      motion is on (no slide), `16` (the pre-slide offset) when it is off.
 *   2. The entrance animation shape — a single opacity-only `Animated.timing`
 *      when reduced, a composed `Animated.parallel` that also drives the
 *      `translateY` to `0` when not reduced.
 *
 * The RN test renderer resolves Animated styles to their current numeric value
 * on the host node, so the translateY transform is read as a number; the
 * animation SHAPE is asserted via spies on `Animated.timing` / `Animated.parallel`.
 *
 * NOTE: this file only adds a test. It does NOT modify any production file.
 */
import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  type EmitterSubscription,
} from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import CompletionToast, {
  type CompletionToastState,
} from '../CompletionToast';

// ── Safe-area: CompletionToast reads useSafeAreaInsets(); provide a stub so the
// component renders without a SafeAreaProvider (mirrors the repo pattern). ──
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const TEST_ID = 'completion-toast-under-test';
/** The pre-slide offset the entrance rises FROM when motion is allowed. */
const SLIDE_OFFSET = 16;

/** A remove-only EmitterSubscription stub (cleanup only ever calls remove()). */
function makeSubscription(): EmitterSubscription {
  // @ts-expect-error — intentional remove-only stub; cleanup only calls remove()
  return { remove: jest.fn() };
}

/** A toast state object; `key` increments so each show re-triggers the effect. */
function toastState(message: string, key: number): CompletionToastState {
  return { message, key };
}

/**
 * Read the current numeric `translateY` transform off the rendered toast node.
 * The RN test renderer resolves the Animated.Value transform to its current
 * numeric value, so the resting/entrance-start offset is observable directly.
 */
function translateYOf(node: { props: Record<string, unknown> }): number {
  const raw = node.props.style as
    | { transform?: Array<{ translateY?: number }> }
    | Array<{ transform?: Array<{ translateY?: number }> }>;
  const entries = Array.isArray(raw) ? raw : [raw];
  for (const entry of entries) {
    const transform = entry?.transform;
    if (!transform) continue;
    const found = transform.find((t) => t.translateY !== undefined);
    if (found && typeof found.translateY === 'number') return found.translateY;
  }
  throw new Error('toast style has no numeric translateY transform');
}

describe('CompletionToast — reduced motion', () => {
  let isReduceMotionEnabled: jest.SpyInstance;
  let addEventListener: jest.SpyInstance;
  let timingSpy: jest.SpyInstance;
  let parallelSpy: jest.SpyInstance;
  /** The callback the component registered for the `reduceMotionChanged` event. */
  let capturedReduceMotionChanged: ((enabled: boolean) => void) | null;

  beforeEach(() => {
    capturedReduceMotionChanged = null;
    isReduceMotionEnabled = jest.spyOn(
      AccessibilityInfo,
      'isReduceMotionEnabled',
    );
    addEventListener = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      // The RN type for addEventListener is overloaded across accessibility
      // events; this generic implementation captures the reduceMotionChanged
      // handler regardless of which overload the type resolver picks.
      .mockImplementation((...args: unknown[]): EmitterSubscription => {
        const [event, cb] = args as [string, (enabled: boolean) => void];
        if (event === 'reduceMotionChanged') {
          capturedReduceMotionChanged = cb;
        }
        return makeSubscription();
      });
    // Keep the real animation behaviour so .start() works; we only OBSERVE.
    timingSpy = jest.spyOn(Animated, 'timing');
    parallelSpy = jest.spyOn(Animated, 'parallel');
    // Announcements are a side channel we do not assert on here.
    jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The `toValue`s of every Animated.timing call captured so far. */
  function timingToValues(): unknown[] {
    return timingSpy.mock.calls.map(
      (call) => (call[1] as { toValue?: unknown } | undefined)?.toValue,
    );
  }

  it('Case 1 — reduced motion ENABLED: suppresses the translateY slide and registers the reduceMotionChanged subscription', async () => {
    isReduceMotionEnabled.mockResolvedValue(true);

    const { getByTestId, rerender } = render(
      <CompletionToast state={null} testID={TEST_ID} />,
    );

    // The component must consult the OS setting and subscribe to live changes.
    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
    expect(addEventListener).toHaveBeenCalledWith(
      'reduceMotionChanged',
      expect.any(Function),
    );

    timingSpy.mockClear();
    parallelSpy.mockClear();

    // Fire the toast now that reduce-motion has resolved to `true`.
    await act(async () => {
      rerender(
        <CompletionToast state={toastState('Cohort created.', 1)} testID={TEST_ID} />,
      );
    });

    const node = getByTestId(TEST_ID);

    // The toast sits at its resting position: no rise from +16.
    expect(translateYOf(node)).toBe(0);
    // The entrance is opacity-only: no composed parallel, and no timing drives
    // a value toward the slide target as part of a translateY animation. The
    // single entrance animation is the opacity cross-fade (toValue 1).
    expect(parallelSpy).not.toHaveBeenCalled();
    expect(timingSpy).toHaveBeenCalledTimes(1);
    expect(timingToValues()).toEqual([1]);
  });

  it('Case 2 — reduced motion DISABLED: animates the translateY slide from +16 to 0', async () => {
    isReduceMotionEnabled.mockResolvedValue(false);

    const { getByTestId, rerender } = render(
      <CompletionToast state={null} testID={TEST_ID} />,
    );

    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());

    timingSpy.mockClear();
    parallelSpy.mockClear();

    await act(async () => {
      rerender(
        <CompletionToast state={toastState('Invite sent.', 1)} testID={TEST_ID} />,
      );
    });

    const node = getByTestId(TEST_ID);

    // The entrance starts the slide from +16 (the renderer shows the start-frame
    // offset because the animation has not run to completion synchronously).
    expect(translateYOf(node)).toBe(SLIDE_OFFSET);
    // The entrance is a composed parallel of opacity + translateY, both driven
    // to 0/1 respectively — so two timings ran, including the slide (toValue 0).
    expect(parallelSpy).toHaveBeenCalledTimes(1);
    expect(timingSpy).toHaveBeenCalledTimes(2);
    expect(timingToValues()).toEqual(expect.arrayContaining([1, 0]));
  });

  it('Case 3 — reduceMotionChanged flips behaviour at runtime: a live ENABLE suppresses the slide on the next toast', async () => {
    // Start with reduce-motion OFF; render but do not show a toast yet.
    isReduceMotionEnabled.mockResolvedValue(false);

    const { getByTestId, rerender } = render(
      <CompletionToast state={null} testID={TEST_ID} />,
    );

    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
    await waitFor(() => expect(capturedReduceMotionChanged).not.toBeNull());

    // The OS setting flips ON mid-session via the live subscription.
    await act(async () => {
      capturedReduceMotionChanged?.(true);
    });

    timingSpy.mockClear();
    parallelSpy.mockClear();

    // Now show the toast: it must honour the runtime flip and NOT slide.
    await act(async () => {
      rerender(
        <CompletionToast state={toastState('Hidden.', 1)} testID={TEST_ID} />,
      );
    });

    const node = getByTestId(TEST_ID);

    // Same boundary as Case 1: rests at 0, opacity-only entrance, no slide.
    expect(translateYOf(node)).toBe(0);
    expect(parallelSpy).not.toHaveBeenCalled();
    expect(timingSpy).toHaveBeenCalledTimes(1);
    expect(timingToValues()).toEqual([1]);
  });
});
