// Style C v2 marks: each DayMark state, ring segments, Reduce Motion path,
// haptic and screen reader labels. Label strings here are fixtures only.
import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SegmentedRing, DayMark, PeakStar } from '../StyleCMarks';
import { lightTokens as t } from '../../../theme/tokens';
import { HapticService } from '../../haptics/haptics.service';
import { useReduceMotion } from '../../../screens/client/wearables/components/useReduceMotion';

jest.mock('react-native-svg', () => {
  const mockReact = require('react');
  const { View } = require('react-native');
  const make = (name: string) =>
    mockReact.forwardRef(({ children, ...p }: { children?: unknown }, ref: unknown) =>
      mockReact.createElement(View, { testID: name, ...p, ref }, children));
  return { __esModule: true, default: make('svg'), Circle: make('Circle'), Path: make('Path') };
});
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../haptics/haptics.service', () => ({ HapticService: { success: jest.fn(() => Promise.resolve()) } }));
jest.mock('../../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: jest.fn() }));

const reduce = useReduceMotion as jest.MockedFunction<typeof useReduceMotion>;
const durations = (spy: jest.SpyInstance) => spy.mock.calls.map((c) => (c[1] as { duration: number }).duration);
let timing: jest.SpyInstance;
beforeEach(() => {
  reduce.mockReturnValue(false);
  timing = jest.spyOn(Animated, 'timing');
});
afterEach(() => {
  timing.mockRestore();
  jest.clearAllMocks();
});

describe('SegmentedRing', () => {
  it('draws one segment per session: done thick, planned thin, missed dashed', async () => {
    const s = await render(
      <SegmentedRing segments={['done', 'planned', 'missed']} size={160} label="1 of 3 done"><Text>1/3</Text></SegmentedRing>,
    );
    const [done, planned, missed] = ['segment-0-done', 'segment-1-planned', 'segment-2-missed'].map((id) => s.getByTestId(id).props);
    expect([done.stroke, done.strokeWidth, done.strokeDasharray]).toEqual([t.data.forest, 16, undefined]);
    expect([planned.stroke, planned.strokeWidth, planned.strokeDasharray]).toEqual([t.data.planned, 2.5, undefined]);
    expect([missed.stroke, missed.strokeWidth, missed.strokeDasharray]).toEqual([t.data.missed, 2.5, [5, 5]]);
    expect(s.getByLabelText('1 of 3 done').props.accessibilityRole).toBe('image');
    expect(s.getByText('1/3')).toBeTruthy();
    expect(timing).not.toHaveBeenCalled();
    expect(HapticService.success).not.toHaveBeenCalled();
  });

  it('uses the on-dark marks on the masthead and closes a one-session ring', async () => {
    const s = await render(<SegmentedRing segments={['done']} size={48} label="1 of 1 done" onDark />);
    const done = s.getByTestId('segment-0-done').props;
    expect(done.stroke).toBe(t.data.leaf);
    expect(done.d.match(/A21\.6 21\.6 0 1 1/g)).toHaveLength(2); // a closed circle: two half arcs
    const dark = await render(<SegmentedRing segments={['planned', 'missed']} size={48} label="0 of 2 done" onDark />);
    expect(dark.getByTestId('segment-0-planned').props.stroke).toBe(t.data.plannedOnDark);
    expect(dark.getByTestId('segment-1-missed').props.stroke).toBe(t.data.missedOnDark);
  });

  it('draws the new segment in 300 ms with one success haptic', async () => {
    const ui = (n: number) => <SegmentedRing segments={['done', 'done']} size={48} label={`${n}`} drawIndex={1} />;
    const s = await render(ui(1));
    expect(durations(timing)).toEqual([300]);
    expect(s.getByTestId('segment-1-done').props.strokeDashoffset).toBeGreaterThan(0);
    await s.rerender(ui(2));
    expect(HapticService.success).toHaveBeenCalledTimes(1);
  });

  it('Reduce Motion: the full segment fades in over 150 ms instead', async () => {
    reduce.mockReturnValue(true);
    const s = await render(<SegmentedRing segments={['done', 'planned']} size={48} label="1 of 2 done" drawIndex={0} />);
    expect(durations(timing)).toEqual([150]);
    expect(s.getByTestId('segment-0-done').props.strokeDashoffset).toBeUndefined();
    expect(HapticService.success).toHaveBeenCalledTimes(1);
  });
});

describe('DayMark', () => {
  it('done: filled disc with a check and no number', async () => {
    const s = await render(<DayMark state="done" day={12} label="12, done" />);
    expect(s.getByTestId('day-disc').props.fill).toBe(t.data.forest);
    expect(s.getByTestId('day-check').props.stroke).toBe(t.textOnAccent);
    expect(s.queryByText('12')).toBeNull();
    expect(s.getByLabelText('12, done')).toBeTruthy();
  });

  it.each([
    ['today', 3, t.data.forest, undefined, t.textPrimary],
    ['planned', 1.5, t.data.planned, undefined, t.textPrimary],
    ['missed', 1.5, t.data.missed, [3, 3], t.data.missed],
  ] as const)('%s: ring and number', async (state, width, stroke, dash, text) => {
    const s = await render(<DayMark state={state} day={13} label={`13, ${state}`} />);
    const ring = s.getByTestId('day-ring').props;
    expect([ring.strokeWidth, ring.stroke, ring.strokeDasharray]).toEqual([width, stroke, dash]);
    expect(StyleSheet.flatten(s.getByText('13').props.style).color).toBe(text);
    expect(s.getByLabelText(`13, ${state}`).props.accessibilityRole).toBe('text');
  });

  it('rest: the number alone, muted; on the masthead done is leaf with an ink check', async () => {
    const s = await render(<DayMark state="rest" day={14} label="14, rest day" />);
    expect(s.queryByTestId('day-ring')).toBeNull();
    expect(StyleSheet.flatten(s.getByText('14').props.style).color).toBe(t.textMuted);
    const dark = await render(<DayMark state="done" day={12} label="12, done" onDark />);
    expect(dark.getByTestId('day-disc').props.fill).toBe(t.data.leaf);
  });

  it('fades in over 200 ms, or at once with Reduce Motion', async () => {
    await render(<DayMark state="done" day={12} label="12, done" animate />);
    reduce.mockReturnValue(true);
    await render(<DayMark state="done" day={12} label="12, done" animate />);
    expect(durations(timing)).toEqual([200, 0]);
  });
});

describe('PeakStar', () => {
  it('is hidden from screen readers beside words, and labelled when alone', async () => {
    const quiet = await render(<PeakStar testID="star" />);
    const hidden = { includeHiddenElements: true };
    expect(quiet.getByTestId('star', hidden).props).toEqual(expect.objectContaining({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' }));
    expect(quiet.getByTestId('peak-star', hidden).props).toEqual(expect.objectContaining({ fill: t.data.peak, stroke: t.data.peakInk }));
    const alone = await render(<PeakStar label="New best" onDark />);
    expect(alone.getByLabelText('New best').props.accessibilityRole).toBe('image');
    expect(alone.getByTestId('peak-star').props.stroke).toBe(t.data.peak);
  });

  it('fades in over 200 ms, or at once with Reduce Motion', async () => {
    await render(<PeakStar animate />);
    reduce.mockReturnValue(true);
    await render(<PeakStar animate />);
    expect(durations(timing)).toEqual([200, 0]);
  });
});
