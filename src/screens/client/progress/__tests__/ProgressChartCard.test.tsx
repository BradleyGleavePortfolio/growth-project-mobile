/**
 * ProgressChartCard — ED.4 component contract.
 *
 * Pins:
 *   1. PR detection renders the flag (star) + glow ring on the record point.
 *   2. Roman commentary renders the romanPRDetected line beside RomanAvatar
 *      (FACE+VOICE invariant — face + voice in the same tree).
 *   3. The haptic scrubber fires Haptics.selectionAsync() on a data-point
 *      crossover (driven via the captured pan handler), and only once per
 *      column (no per-frame spam).
 *   4. No PR → no flag, no commentary.
 *
 * Reduce-motion is forced ON (via the prop override) so the draw-in does not
 * depend on async timing; the line + flag + commentary still render.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

// ── expo-haptics — assert selection feedback on scrubber crossover. ─────────
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));
const Haptics = require('expo-haptics');

// ── gesture-handler — capture the pan callbacks so the test can drive the
// scrubber synchronously (mirrors the repo's tgpCharts gesture-capture). ─────
interface PanCb {
  begin?: (e: { x: number; y: number }) => void;
  update?: (e: { x: number; y: number }) => void;
  finalize?: () => void;
}
const panCb: PanCb = {};

jest.mock('react-native-gesture-handler', () => {
  const mockReact = require('react');
  const makeGesture = () => {
    const g: Record<string, unknown> = {};
    g.runOnJS = () => g;
    g.onBegin = (fn: PanCb['begin']) => { panCb.begin = fn; return g; };
    g.onUpdate = (fn: PanCb['update']) => { panCb.update = fn; return g; };
    g.onFinalize = (fn: PanCb['finalize']) => { panCb.finalize = fn; return g; };
    return g;
  };
  return {
    Gesture: { Pan: makeGesture },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      mockReact.createElement(mockReact.Fragment, null, children),
  };
});

import ProgressChartCard from '../ProgressChartCard';

const PR_SERIES = [
  { x: 1, y: 185 },
  { x: 2, y: 205 },
  { x: 3, y: 225 }, // PR
  { x: 4, y: 215 },
];

/** Drive an onLayout so the chart computes pixel geometry (width > 0). */
function layout(node: ReturnType<typeof render>) {
  const plot = node.getByLabelText(/progress chart/i);
  fireEvent(plot, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 220 } },
  });
}

beforeEach(() => {
  panCb.begin = undefined;
  panCb.update = undefined;
  panCb.finalize = undefined;
  jest.clearAllMocks();
});

describe('ProgressChartCard — ED.4', () => {
  it('renders the PR flag + glow and the Roman commentary (FACE+VOICE)', () => {
    const node = render(
      <ProgressChartCard data={PR_SERIES} liftName="Back Squat" reduceMotionOverride />,
    );
    layout(node);

    // PR flag + glow on the record point.
    expect(node.getByTestId('progress-pr-flag')).toBeTruthy();
    expect(node.getByTestId('progress-pr-glow')).toBeTruthy();

    // VOICE — the exact romanPRDetected line.
    const prText = node.getByTestId('progress-pr-text');
    expect(prText.props.children).toBe(
      'A personal best on Back Squat — 225 pounds. Noted with admiration.',
    );
    // P2-1: the commentary is a polite live region so it is announced when the
    // PR appears (the row only mounts when a PR is detected).
    expect(prText.props.accessibilityLiveRegion).toBe('polite');
    // FACE — RomanAvatar present in the same commentary row, in the §3.8
    // milestone register ('slight smile'), not the legacy crop label.
    const avatar = node.getByTestId('progress-pr-avatar');
    expect(avatar.props.accessibilityLabel).toBe('Roman, slight smile');
  });

  it('fires a selection haptic on a data-point crossover, once per column', () => {
    const node = render(
      <ProgressChartCard data={PR_SERIES} liftName="Back Squat" reduceMotionOverride />,
    );
    layout(node);

    act(() => {
      // Begin near the first column.
      panCb.begin?.({ x: 20, y: 100 });
    });
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

    act(() => {
      // Stay on the SAME column — must NOT re-fire (no per-frame spam).
      panCb.update?.({ x: 22, y: 100 });
    });
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

    act(() => {
      // Cross to the far column — fires again.
      panCb.update?.({ x: 290, y: 100 });
    });
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
  });

  it('renders no flag and no commentary when there is no PR', () => {
    const flat = [
      { x: 1, y: 200 },
      { x: 2, y: 190 },
      { x: 3, y: 180 },
    ];
    const node = render(
      <ProgressChartCard data={flat} liftName="Back Squat" reduceMotionOverride />,
    );
    layout(node);
    expect(node.queryByTestId('progress-pr-flag')).toBeNull();
    expect(node.queryByTestId('progress-pr-commentary')).toBeNull();
  });
});
