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
        onSubmit={jest.fn().mockResolvedValue({ completed: false })}
        onClose={jest.fn()}
        testID="sheet"
      />,
    );

    await waitFor(() => expect(isReduceMotionSpy).toHaveBeenCalled());
    // Flush the reduce-motion resolution, then drive a NEW fill target by
    // raising the draft — the bar should animate via Animated.timing.
    await act(async () => {
      await Promise.resolve();
    });
    timingSpy.mockClear();
    fireEvent.changeText(screen.getByTestId('sheet-input'), '20');
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
        onSubmit={jest.fn().mockResolvedValue({ completed: false })}
        onClose={jest.fn()}
        testID="sheet"
      />,
    );

    await waitFor(() => expect(isReduceMotionSpy).toHaveBeenCalled());
    // Allow the reduce-motion state to flush, THEN clear any mount-time call and
    // drive a new fill target — with reduce motion on, no timing must run.
    await act(async () => {
      await Promise.resolve();
    });
    timingSpy.mockClear();
    fireEvent.changeText(screen.getByTestId('sheet-input'), '20');
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
    const onSubmit = jest.fn().mockResolvedValue({ completed: false });
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
    const onSubmit = jest.fn().mockResolvedValue({ completed: false });
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

  it('shows the always-on monotonic explanation and an inline clamp note (F11)', () => {
    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={jest.fn().mockResolvedValue({ completed: false })}
        onClose={jest.fn()}
        testID="sheet"
      />,
    );

    // The explanatory helper is always present (calm, no error styling).
    expect(screen.getByTestId('sheet-monotonic-help')).toBeTruthy();
    // No clamp note until the typed value is below the saved total.
    expect(screen.queryByTestId('sheet-monotonic-clamp')).toBeNull();

    fireEvent.changeText(screen.getByTestId('sheet-input'), '3');
    const clamp = screen.getByTestId('sheet-monotonic-clamp');
    expect(clamp).toBeTruthy();
    expect(screen.getByText('Keeping your saved total at 12 days.')).toBeTruthy();
  });
});

describe('ChallengeProgressSheet — completion peak (F9)', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });

  it('stays open in a closure state with a Done button when the server confirms completion', async () => {
    const onSubmit = jest.fn().mockResolvedValue({ completed: true });
    const onClose = jest.fn();
    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={onSubmit}
        onClose={onClose}
        testID="sheet"
      />,
    );

    fireEvent.changeText(screen.getByTestId('sheet-input'), '30');
    fireEvent.press(screen.getByTestId('sheet-submit'));

    // The sheet does NOT auto-close on completion; it presents the peak + Done.
    await waitFor(() => expect(screen.getByTestId('sheet-celebrate')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Goal reached — progress saved.')).toBeTruthy();

    // The user dismisses with the explicit Done affordance.
    fireEvent.press(screen.getByTestId('sheet-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately (no peak) when the submit is not a completion', async () => {
    const onSubmit = jest.fn().mockResolvedValue({ completed: false });
    const onClose = jest.fn();
    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={onSubmit}
        onClose={onClose}
        testID="sheet"
      />,
    );

    fireEvent.changeText(screen.getByTestId('sheet-input'), '20');
    fireEvent.press(screen.getByTestId('sheet-submit'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('sheet-celebrate')).toBeNull();
  });
});

describe('ChallengeProgressSheet — rejected submit (F3)', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });

  it('surfaces a calm error and keeps the sheet open + draft on a rejected write', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('save failed'));
    const onClose = jest.fn();
    render(
      <ChallengeProgressSheet
        visible
        challenge={challenge}
        participation={participation}
        onSubmit={onSubmit}
        onClose={onClose}
        testID="sheet"
      />,
    );

    fireEvent.changeText(screen.getByTestId('sheet-input'), '20');
    fireEvent.press(screen.getByTestId('sheet-submit'));

    // The failure is SURFACED to the user as an inline error and the sheet stays
    // open with the draft intact so the user can retry.
    await waitFor(() => expect(screen.getByTestId('sheet-error')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet-input').props.value).toBe('20');
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
