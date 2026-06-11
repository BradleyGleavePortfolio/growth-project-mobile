/**
 * ChallengeProgressSheet — reduced-motion + monotonic-progress regression tests
 * (v3-1).
 *
 * Two contracts are pinned:
 *
 *   1. Reduced motion (design-doctrine AP-4): the fill bar animates with an
 *      `Animated.timing` when the OS "Reduce Motion" setting is OFF, and is set
 *      INSTANTLY (no timing animation) when it is ON. The path depends on the
 *      async `AccessibilityInfo.isReduceMotionEnabled()` resolution, so it can
 *      silently regress — we assert the animation shape via a spy.
 *
 *   2. Monotonic progress (§3.4 no public failure / no shame): submitting a
 *      value BELOW the current total cannot lower it — the sheet clamps the
 *      submitted value to at least the current progress.
 *
 * This file only adds tests; it modifies no production file.
 */
import React from 'react';
import { AccessibilityInfo, Animated, type EmitterSubscription } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

import ChallengeProgressSheet from '../ChallengeProgressSheet';

function makeSubscription(): EmitterSubscription {
  // @ts-expect-error — remove-only stub; cleanup only calls remove()
  return { remove: jest.fn() };
}

const challenge = {
  id: 'ch-1',
  workspace_id: 'ws-1',
  cohort_id: null,
  created_by_user_id: 'coach-1',
  title: 'Protein streak',
  description: null,
  status: 'active',
  starts_at: null,
  ends_at: null,
  metric_key: 'days',
  target_value: 30,
  unit: 'days',
  leaderboard_enabled: false,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  archived: false,
} as never;

const participation = {
  challenge_id: 'ch-1',
  user_id: 'me-1',
  progress_value: 12,
  target_value: 30,
  progress_fraction: 0.4,
  completed: false,
  completed_at: null,
  last_logged_at: null,
  leaderboard_opted_in: false,
} as never;

let isReduceMotionSpy: jest.SpyInstance;
let addListenerSpy: jest.SpyInstance;
let timingSpy: jest.SpyInstance;

beforeEach(() => {
  addListenerSpy = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue(makeSubscription());
  timingSpy = jest.spyOn(Animated, 'timing');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ChallengeProgressSheet — reduced motion', () => {
  it('animates the fill with Animated.timing when reduce motion is OFF', async () => {
    isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);

    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onClose={jest.fn()}
        testID="sheet"
      />,
    );

    await waitFor(() => expect(isReduceMotionSpy).toHaveBeenCalled());
    await waitFor(() => expect(timingSpy).toHaveBeenCalled());
  });

  it('sets the fill instantly (no Animated.timing) when reduce motion is ON', async () => {
    isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);

    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onClose={jest.fn()}
        testID="sheet"
      />,
    );

    await waitFor(() => expect(isReduceMotionSpy).toHaveBeenCalled());
    // Allow the reduce-motion state to flush and the effect to re-run.
    await act(async () => {
      await Promise.resolve();
    });
    expect(timingSpy).not.toHaveBeenCalled();
  });
});

describe('ChallengeProgressSheet — monotonic progress', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });

  it('clamps a submitted value below the current total up to the current value', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={onSubmit}
        onClose={jest.fn()}
        testID="sheet"
      />,
    );

    // Attempt to lower the total from 12 to 3.
    fireEvent.changeText(screen.getByTestId('sheet-input'), '3');
    fireEvent.press(screen.getByTestId('sheet-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Monotonic: never below the current 12.
    expect(onSubmit).toHaveBeenCalledWith(12);
  });

  it('passes a higher value straight through', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={onSubmit}
        onClose={jest.fn()}
        testID="sheet"
      />,
    );

    fireEvent.changeText(screen.getByTestId('sheet-input'), '20');
    fireEvent.press(screen.getByTestId('sheet-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(20));
  });
});
