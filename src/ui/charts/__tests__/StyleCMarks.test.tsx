// Style C v2 marks: each DayMark state, ring segments, Reduce Motion path,
// one animation per event with no haptic from the parts, and screen reader
// labels. Label strings here are fixtures only. Svg parts are found by the
// mock's element name (Path, Circle).
import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SegmentedRing, DayMark, PeakStar, type SegmentState } from '../StyleCMarks';
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
  it('draws one segment per session: done thick, planned thin, missed dashed; only a done segment draws in', async () => {
    const s = await render(
      <SegmentedRing segments={['done', 'planned', 'missed']} size={160} label="1 of 3 done" drawIndex={1}><Text>1/3</Text></SegmentedRing>,
    );
    const [done, planned, missed] = s.getAllByTestId('Path').map((p) => p.props);
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
    const done = s.getByTestId('Path').props;
    expect(done.stroke).toBe(t.data.leaf);
    expect(done.d.match(/A21\.6 21\.6 0 1 1/g)).toHaveLength(2); // a closed circle: two half arcs
    const dark = await render(<SegmentedRing segments={['planned', 'missed']} size={48} label="0 of 2 done" onDark />);
    expect(dark.getAllByTestId('Path').map((p) => p.props.stroke)).toEqual([t.data.plannedOnDark, t.data.missedOnDark]);
  });

  it('draws the new segment in 300 ms from undrawn', async () => {
    const s = await render(<SegmentedRing segments={['done', 'done']} size={48} label="2 of 2 done" drawIndex={1} />);
    expect(durations(timing)).toEqual([300]);
    expect(s.getAllByTestId('Path')[1].props.strokeDashoffset).toBeGreaterThan(0);
  });

  it('Reduce Motion: the full segment fades in over 150 ms instead', async () => {
    reduce.mockReturnValue(true);
    const s = await render(<SegmentedRing segments={['done', 'planned']} size={48} label="1 of 2 done" drawIndex={0} />);
    expect(durations(timing)).toEqual([150]);
    expect(s.getAllByTestId('Path')[0].props.strokeDashoffset).toBeUndefined();
  });
});

describe('DayMark', () => {
  it('done: filled disc with a check and no number', async () => {
    const s = await render(<DayMark state="done" day={12} label="12, done" />);
    expect(s.getByTestId('Circle').props.fill).toBe(t.data.forest);
    expect(s.getByTestId('Path').props.stroke).toBe(t.textOnAccent);
    expect(s.queryByText('12')).toBeNull();
    expect(s.getByLabelText('12, done')).toBeTruthy();
  });

  it.each([
    ['today', 3, t.data.forest, undefined, t.textPrimary],
    ['planned', 1.5, t.data.planned, undefined, t.textPrimary],
    ['missed', 1.5, t.data.missed, [3, 3], t.data.missed],
  ] as const)('%s: ring and number', async (state, width, stroke, dash, text) => {
    const s = await render(<DayMark state={state} day={13} label={`13, ${state}`} />);
    const ring = s.getByTestId('Circle').props;
    expect([ring.strokeWidth, ring.stroke, ring.strokeDasharray]).toEqual([width, stroke, dash]);
    expect(StyleSheet.flatten(s.getByText('13').props.style).color).toBe(text);
    expect(s.getByLabelText(`13, ${state}`).props.accessibilityRole).toBe('text');
  });

  it('rest: the number alone, muted; on the masthead done is leaf with an ink check', async () => {
    const s = await render(<DayMark state="rest" day={14} label="14, rest day" />);
    expect(s.queryByTestId('Circle')).toBeNull();
    expect(StyleSheet.flatten(s.getByText('14').props.style).color).toBe(t.textMuted);
    const dark = await render(<DayMark state="done" day={12} label="12, done" onDark />);
    expect(dark.getByTestId('Circle').props.fill).toBe(t.data.leaf);
  });

  // FIX718 B1: on the masthead the parts draw only the on-dark roles that
  // contrastStyleC.test.ts checks there.
  it.each([
    ['today', t.data.leaf, t.textOnAccent],
    ['planned', t.data.plannedOnDark, t.textOnAccent],
    ['missed', t.data.missedOnDark, t.data.missedOnDark],
    ['rest', undefined, t.textOnMastheadMuted],
  ] as const)('on the masthead, %s: ring and number use the on-dark roles', async (state, stroke, text) => {
    const s = await render(<DayMark state={state} day={13} label={`13, ${state}`} onDark />);
    expect(s.queryByTestId('Circle')?.props.stroke).toBe(stroke);
    expect(StyleSheet.flatten(s.getByText('13').props.style).color).toBe(text);
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
    expect(quiet.queryByTestId('star', { includeHiddenElements: false })).toBeNull();
    const star = quiet.getByTestId('Path', { includeHiddenElements: true }).props;
    expect([star.fill, star.stroke]).toEqual([t.data.peak, t.data.peakInk]);
    const alone = await render(<PeakStar label="New best" onDark />);
    expect(alone.getByLabelText('New best').props.accessibilityRole).toBe('image');
    expect(alone.getByTestId('Path').props.stroke).toBe(t.data.peak);
  });

  it('fades in over 200 ms, or at once with Reduce Motion', async () => {
    await render(<PeakStar animate />);
    reduce.mockReturnValue(true);
    await render(<PeakStar animate />);
    expect(durations(timing)).toEqual([200, 0]);
  });
});

// FIX718 B2: a newly done segment animates and gives its haptic as one
// confirmation. Every change the parts react to (each useAppear caller) plays
// once per event, an unchanged re-render does not replay, and the parts fire no
// haptic: the Send to Sam handler that sets drawIndex fires the one success().
const ring = (segments: SegmentState[], drawIndex?: number) => (
  <SegmentedRing segments={segments} size={48} label="ring" drawIndex={drawIndex} />
);
const day = (state: 'today' | 'done') => <DayMark state={state} day={12} label="12" animate />;
describe('one animation per event, no haptic from the parts', () => {
  it.each<[string, boolean, Array<React.ReactElement | 'remount'>, number[]]>([
    ['ring: first draw after mount', false, [ring(['planned', 'planned']), ring(['done', 'planned'], 0)], [300]],
    ['ring: sequential second segment on a mounted ring', false, [ring(['done', 'planned'], 0), ring(['done', 'done'], 1)], [300, 300]],
    ['ring: re-mount mid-draw', false, [ring(['done', 'done'], 1), 'remount'], [300, 300]],
    ['ring: Reduce Motion, first and second segment', true, [ring(['done', 'planned'], 0), ring(['done', 'done'], 1)], [150, 150]],
    ['ring: a planned or missed index draws nothing', false, [ring(['done', 'planned', 'missed'], 1), ring(['done', 'planned', 'missed'], 2)], []],
    ['DayMark: a new state on a mounted mark', false, [day('today'), day('done')], [200, 200]],
    ['PeakStar: appears after mount', false, [<PeakStar key="s" />, <PeakStar key="s" animate />], [200]],
  ])('%s', async (_case, rm, steps, want) => {
    reduce.mockReturnValue(rm);
    let last = steps[0] as React.ReactElement;
    let s = await render(last);
    for (const step of steps.slice(1)) {
      if (step === 'remount') {
        await s.unmount();
        s = await render(last);
      } else {
        await s.rerender(step);
        last = step;
      }
    }
    await s.rerender(last);
    expect(durations(timing)).toEqual(want);
    expect(HapticService.success).not.toHaveBeenCalled();
  });
});
