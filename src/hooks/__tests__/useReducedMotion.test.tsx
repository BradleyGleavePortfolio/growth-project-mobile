/**
 * useReducedMotion — reduced-motion accessibility hook (F7).
 *
 * Verifies the hook (a) reads `AccessibilityInfo.isReduceMotionEnabled()` on
 * mount, (b) subscribes to `reduceMotionChanged`, and (c) returns the live
 * value so animated surfaces (the coach event modals) can drop their entrance
 * animation to `none`.
 */
import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';

import { useReducedMotion } from '../useReducedMotion';

function Probe(): React.ReactElement {
  const reduced = useReducedMotion();
  return <Text testID="probe">{reduced ? 'reduced' : 'full'}</Text>;
}

describe('useReducedMotion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reflects the initial isReduceMotionEnabled() probe', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const { getByTestId } = await render(<Probe />);
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('reduced'));
  });

  it('defaults to full motion when reduce-motion is off', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    const { getByTestId } = await render(<Probe />);
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('full'));
  });

  it('updates live when the OS reduceMotionChanged event fires', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    let handler: ((enabled: boolean) => void) | undefined;
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation(((event: string, cb: (e: boolean) => void) => {
        if (event === 'reduceMotionChanged') handler = cb;
        return { remove: jest.fn() };
      }) as unknown as typeof AccessibilityInfo.addEventListener);
    const { getByTestId } = await render(<Probe />);
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('full'));
    await act(() => handler?.(true));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('reduced'));
  });
});
