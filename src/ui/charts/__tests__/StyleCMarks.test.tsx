// Style C v2 marks: each DayMark state, ring segments, the rest band's leaf-only
// path, Reduce Motion, one animation per real event with no haptic from the
// parts, and screen reader labels. Label strings here are fixtures only. Svg parts are found by the
// mock's element name (Path, Circle).
import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SegmentedRing, DayMark, PeakStar, type DayState, type SegmentState } from '../StyleCMarks';
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

  // FIX718B R1: the rest band (surface.forestBand) draws only the leaf ring.
  it('on the rest band: done segments in leaf; the types refuse planned and missed there', async () => {
    const s = await render(<SegmentedRing segments={['done']} size={44} label="rest" onBand />);
    expect(s.getByTestId('Path').props.stroke).toBe(t.data.leaf);
    const refused = [
      // @ts-expect-error planned (2.89:1) is not drawn on the rest band
      <SegmentedRing key="p" segments={['done', 'planned']} size={44} label="rest" onBand />,
      // @ts-expect-error missed (4.19:1 as a number) is not drawn on the rest band
      <SegmentedRing key="m" segments={['missed']} size={44} label="rest" onBand />,
    ];
    expect(refused).toHaveLength(2);
  });

  it('draws the new segment in 300 ms from undrawn', async () => {
    const s = await render(<SegmentedRing segments={['done', 'done']} size={48} label="2 of 2 done" drawIndex={1} event="t1" />);
    expect(durations(timing)).toEqual([300]);
    expect(s.getAllByTestId('Path')[1].props.strokeDashoffset).toBeGreaterThan(0);
  });

  it('Reduce Motion: the full segment fades in over 150 ms instead', async () => {
    reduce.mockReturnValue(true);
    const s = await render(<SegmentedRing segments={['done', 'planned']} size={48} label="1 of 2 done" drawIndex={0} event="t2" />);
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
});

// FIX718B R2: returning to an already confirmed workout never replays its
// confirmation. Each row walks one part: the first event plays once, the same
// event after a remount mounts drawn and plays nothing, a new segment or day
// state plays once; Reduce Motion keeps its timings. The parts fire no haptic:
// the Send to Sam tap does.
type Screen = Awaited<ReturnType<typeof render>>;
const ring = (event?: string, drawIndex = 0, segments: SegmentState[] = ['done', 'done']) => (
  <SegmentedRing segments={segments} size={48} label="ring" drawIndex={drawIndex} event={event} />
);
const day = (state: DayState, event?: string) => <DayMark testID="m" state={state} day={12} label="12" event={event} />;
const star = (event?: string) => <PeakStar testID="m" event={event} />;
const ringShown = (s: Screen) => {
  const p = s.getAllByTestId('Path')[0].props;
  return p.opacity ?? (p.strokeDashoffset === 0 ? 1 : 0);
};
const fadeShown = (s: Screen) => StyleSheet.flatten(s.getByTestId('m', { includeHiddenElements: true }).props.style).opacity;
describe('once per real event, no haptic from the parts', () => {
  it.each<[string, boolean, Array<React.ReactElement | 'remount'>, number[], (s: Screen) => unknown]>([
    ['ring', false, [ring(), ring('r1'), 'remount', ring('r2', 1)], [300, 300], ringShown],
    ['ring, Reduce Motion', true, [ring(), ring('r3'), 'remount', ring('r4', 1)], [150, 150], ringShown],
    ['ring: a planned or missed index plays nothing', false, [ring('r5', 1, ['done', 'planned']), ring('r6', 2, ['done', 'planned', 'missed'])], [], ringShown],
    ['DayMark', false, [day('today'), day('done', 'd1'), 'remount', day('missed', 'd2')], [200, 200], fadeShown],
    ['DayMark, Reduce Motion', true, [day('today'), day('done', 'd3'), 'remount', day('missed', 'd4')], [0, 0], fadeShown],
    ['PeakStar', false, [star(), star('s1'), 'remount', star('s2')], [200, 200], fadeShown],
    ['PeakStar, Reduce Motion', true, [star(), star('s3'), 'remount', star('s4')], [0, 0], fadeShown],
  ])('%s', async (_case, rm, steps, want, shown) => {
    reduce.mockReturnValue(rm);
    let last = steps[0] as React.ReactElement;
    let s = await render(last);
    for (const step of steps.slice(1)) {
      if (step === 'remount') {
        const plays = timing.mock.calls.length;
        await s.unmount();
        s = await render(last);
        expect([timing.mock.calls.length, shown(s)]).toEqual([plays, 1]); // the seen event mounts drawn
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
