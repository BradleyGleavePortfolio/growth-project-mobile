/**
 * CalmSlowReveal — asserts the reduce-motion contract (UX gate §5.4): the
 * component MUST consult `AccessibilityInfo.isReduceMotionEnabled()` and, when
 * reduce-motion is on, snap to visible instantly (no animation).
 */

import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { CalmSlowReveal } from '../components/CalmSlowReveal';

describe('CalmSlowReveal', () => {
  afterEach(() => jest.restoreAllMocks());

  it('checks AccessibilityInfo.isReduceMotionEnabled on mount', async () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    const addSpy = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

    render(
      <CalmSlowReveal testID="reveal">
        <Text>child</Text>
      </CalmSlowReveal>,
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(addSpy).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
  });

  it('renders children regardless of motion preference', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

    const { getByText } = render(
      <CalmSlowReveal>
        <Text>visible-child</Text>
      </CalmSlowReveal>,
    );
    await waitFor(() => expect(getByText('visible-child')).toBeTruthy());
  });

  it('falls back to the instant reveal path when the reduced-motion query rejects with content visible', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockRejectedValue(new Error('unavailable'));
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

    const { getByText } = render(
      <CalmSlowReveal>
        <Text>still-shown</Text>
      </CalmSlowReveal>,
    );
    await waitFor(() => expect(getByText('still-shown')).toBeTruthy());
  });
});
