import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import WeightTrendChart from '../WeightTrendChart';
import PeriodTabs from '../PeriodTabs';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { WEIGHT_DAY as D } from '../weightTrend';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { clientProgressV2: true } }));
const mockFlags = jest.requireMock('../../../config/featureFlags').featureFlags as { clientProgressV2: boolean };
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('../../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
// Assert the resolved SVG layer props before native brush conversion.
jest.mock('react-native-svg', () => {
  const mockReact = require('react');
  const { View, Text } = require('react-native');
  const mark = ({ children, ...props }: { children?: React.ReactNode }) =>
    mockReact.createElement(View, props, children);
  const label = ({ children, ...props }: { children?: React.ReactNode }) =>
    mockReact.createElement(Text, props, children);
  return { __esModule: true, default: mark, Circle: mark, Line: mark, Path: mark, Polyline: mark, Rect: mark, Text: label };
});
// Keep the real chart, layers and assistive actions. Expose only the gesture callbacks.
let mockGesture: Record<string, (e?: { x: number }) => void> = {};
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: { Pan: () => {
    const chain: Record<string, jest.Mock> = {};
    ['runOnJS', 'activateAfterLongPress', 'onStart', 'onUpdate', 'onEnd', 'onFinalize'].forEach((key) => {
      chain[key] = jest.fn((value) => { if (key.startsWith('on')) mockGesture[key] = value; return chain; });
    });
    return chain;
  } },
}));
const data = [{ x: D, y: 170 }, { x: 2 * D, y: 169 }, { x: 6 * D, y: 168, pending: true }];
beforeEach(() => { mockFlags.clientProgressV2 = true; jest.clearAllMocks(); mockGesture = {}; });

it.each([
  ['7D', false, false], ['30D', false, true], ['All', false, true], ['7D', true, true],
] as const)('goal rule for %s, overview %s', async (period, overview, visible) => {
  const v = await render(<WeightTrendChart variant="dark" data={data} through={6 * D} period={period} overview={overview}
    goal={{ value: 165, coachName: 'Sam' }} />);
  expect(!!v.queryByTestId('weight-goal-line')).toBe(visible);
  expect(!!v.queryByTestId('weight-usual-band')).toBe(!overview);
  if (visible) expect(v.getByText('Goal 165 lb, set with Sam')).toBeTruthy();
});
it('has no invented goal or coach, and no coachless lock', async () => {
  const v = await render(<WeightTrendChart variant="dark" data={data} through={6 * D} />);
  expect(v.queryByTestId('weight-goal-line')).toBeNull();
  await v.rerender(<WeightTrendChart variant="dark" data={data} through={6 * D} goal={{ value: 165 }} />);
  expect(v.getByText('Your goal 165 lb')).toBeTruthy();
  expect(v.queryByText(/Sam/)).toBeNull();
});
it('draws dots, the decorative band, dashed gap, latest point and hollow pending ring', async () => {
  const v = await render(<WeightTrendChart variant="dark" data={data} through={6 * D} />);
  expect(v.getAllByTestId('weight-reading')).toHaveLength(2);
  expect(v.getAllByTestId('weight-gap')).toHaveLength(1);
  expect(v.getByTestId('weight-pending').props).toMatchObject({ fill: 'none', strokeDasharray: '3 2.4' });
  expect(v.getByTestId('weight-latest')).toBeTruthy();
  expect(v.getByText(/Usual range today:/)).toBeTruthy();
  expect(v.getByText(/Each weigh-in moves/)).toBeTruthy();
});
it('first reading is a dot without an invented trend segment', async () => {
  const v = await render(<WeightTrendChart variant="dark" data={data.slice(0, 1)} through={D} />);
  expect(v.queryByTestId('weight-segment')).toBeNull();
  expect(v.getAllByTestId('weight-reading')).toHaveLength(1);
  expect(v.getByText('The trend line starts at your second weigh-in.')).toBeTruthy();
});
it('missed week keeps the trend and a hollow carry ring; empty makes no claim', async () => {
  const v = await render(<WeightTrendChart variant="dark" data={data.slice(0, 2)} through={9 * D} />);
  expect(v.getByText(/Your trend is kept where it was/)).toBeTruthy();
  expect(v.getByTestId('weight-latest').props.fill).not.toBe(v.getByTestId('weight-latest').props.stroke);
  await v.rerender(<WeightTrendChart variant="dark" data={[]} through={9 * D} />);
  expect(v.queryByRole('adjustable')).toBeNull();
});
it('day-by-day assistive actions reach the same chip as hold and drag, with one haptic per day', async () => {
  const v = await render(<WeightTrendChart variant="dark" data={data} through={6 * D} />);
  await fireEvent(v.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  expect(v.getByTestId('weight-touch-chip')).toBeTruthy();
  expect(v.getByRole('adjustable').props.accessibilityValue.text).toContain('No weigh-ins.');
  await fireEvent(v.getByRole('adjustable'), 'layout', { nativeEvent: { layout: { width: 312 } } });
  await act(() => { mockGesture.onStart({ x: 296 }); });
  expect(v.getByRole('adjustable').props.accessibilityValue.text).toContain('on this phone');
  const calls = (HapticService.selection as jest.Mock).mock.calls.length;
  await act(() => { mockGesture.onUpdate({ x: 296 }); });
  expect(HapticService.selection).toHaveBeenCalledTimes(calls);
  await act(() => { mockGesture.onFinalize(); });
  expect(v.queryByTestId('weight-touch-chip')).toBeNull();
});
it('all three 44 pt tabs change the real selected period', async () => {
  function PeriodChart() {
    const [value, setValue] = React.useState<'7D' | '30D' | '90D' | 'All'>('All');
    return <>
      <PeriodTabs variant="dark" value={value} onChange={setValue} />
      <WeightTrendChart variant="dark" data={data} through={6 * D}
        period={value === '90D' ? 'All' : value} goal={{ value: 165 }} />
    </>;
  }
  const v = await render(<PeriodChart />);
  for (const [label, goalVisible] of [['Week', false], ['Month', true], ['All', true]] as const) {
    const tab = v.getByRole('tab', { name: label });
    expect(StyleSheet.flatten(tab.props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
    await fireEvent.press(tab);
    expect(v.getByRole('tab', { name: label, selected: true })).toBeTruthy();
    expect(!!v.queryByTestId('weight-goal-line')).toBe(goalVisible);
  }
});
it('flag off preserves the legacy chart and all four legacy period tabs', async () => {
  mockFlags.clientProgressV2 = false;
  const v = await render(<WeightTrendChart variant="dark" data={data} />);
  expect(v.queryByRole('adjustable')).toBeNull();
  await v.rerender(<PeriodTabs variant="dark" value="All" onChange={jest.fn()} />);
  expect(v.getByText('90D')).toBeTruthy();
  expect(v.queryByRole('tab')).toBeNull();
});
