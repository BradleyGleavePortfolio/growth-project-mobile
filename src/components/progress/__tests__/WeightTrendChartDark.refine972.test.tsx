/**
 * REFINE-972 (m#972, B1): what the dark weight chart draws for a weigh-in kept on this phone, as C8 Style C v2 draws it
 * (planning/MOCKUP3/C8/style-c-v2/C2_offline_*: the dashed hollow ring at today's point with the cream pill
 * "168.4 lb today" beside it, and, still on the masthead under the dates, a phone glyph and "On this phone. Goes to Sam
 * when you are back online."; index-v2.md:215, :339 C8V2-S-29). Data with no pending sample draws as before
 * (WeightTrendChartDark.test.tsx, unedited). Harness: WeightTrendChartDark.test.tsx's mocks.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import WeightTrendChartDark from '../WeightTrendChartDark';
import { WEIGHT_DAY as D } from '../weightTrend';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { clientProgressV2: true } }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('../../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('react-native-svg', () => {
  const mockReact = require('react');
  const { View, Text } = require('react-native');
  const mark = ({ children, ...props }: { children?: React.ReactNode }) =>
    mockReact.createElement(View, props, children);
  const label = ({ children, ...props }: { children?: React.ReactNode }) =>
    mockReact.createElement(Text, props, children);
  return { __esModule: true, default: mark, Circle: mark, Line: mark, Path: mark, Polyline: mark, Rect: mark, Text: label };
});
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: { Pan: () => {
    const chain: Record<string, jest.Mock> = {};
    ['runOnJS', 'activateAfterLongPress', 'onStart', 'onUpdate', 'onEnd', 'onFinalize'].forEach((key) => {
      chain[key] = jest.fn(() => chain);
    });
    return chain;
  } },
}));

const LINE = 'On this phone. Goes to Sam when you are back online.';
const HIDDEN = { includeHiddenElements: true };
/** Server weigh-ins, and one kept on this phone dated today (`through`). */
const waiting = [{ x: D, y: 170 }, { x: 2 * D, y: 169 }, { x: 5 * D, y: 168.6 }, { x: 6 * D, y: 168.4, pending: true }];

describe('REFINE-972 B1: the chart for a weigh-in kept on this phone', () => {
  it('today\'s waiting weigh-in: the dashed ring and its callout "{weight} lb today" (RF972-W3), not focusable', async () => {
    const v = await render(<WeightTrendChartDark data={waiting} through={6 * D} />);
    expect(v.getByTestId('weight-pending')).toBeTruthy();
    // Hidden from screen readers on purpose (the ring's spoken day says ", on this phone"), so queried with hidden ones.
    const callout = v.getByTestId('weight-today-callout', HIDDEN);
    expect(v.getByText('168.4 lb today', HIDDEN)).toBeTruthy();
    expect(callout.props.accessible).toBe(false);
    expect(callout.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('in kilograms for a kg client (the chart\'s own unit)', async () => {
    const v = await render(<WeightTrendChartDark data={waiting} through={6 * D} unit="kg" />);
    expect(v.getByText('76.4 kg today', HIDDEN)).toBeTruthy();
    expect(v.queryByText(/ lb today/, HIDDEN)).toBeNull();
  });

  it('a waiting weigh-in of an earlier day: the ring only, no callout (no frame draws one)', async () => {
    const v = await render(<WeightTrendChartDark data={waiting} through={8 * D} />);
    expect(v.getByTestId('weight-pending')).toBeTruthy();
    expect(v.queryByTestId('weight-today-callout', HIDDEN)).toBeNull();
    expect(v.queryByText(/today$/, HIDDEN)).toBeNull();
  });

  it('the callout hides while the touch chip shows', async () => {
    const v = await render(<WeightTrendChartDark data={waiting} through={6 * D} />);
    expect(v.getByTestId('weight-today-callout', HIDDEN)).toBeTruthy();
    await act(async () => {
      fireEvent(v.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    });
    expect(v.getByTestId('weight-touch-chip')).toBeTruthy();
    expect(v.queryByTestId('weight-today-callout', HIDDEN)).toBeNull();
  });

  it('the line under the chart, on the masthead, with its phone glyph (RF972-W4)', async () => {
    const v = await render(<WeightTrendChartDark data={waiting} through={6 * D} phoneLine={LINE} />);
    expect(v.getByText(LINE)).toBeTruthy();
    expect(v.getByTestId('weight-phone-line')).toBeTruthy();
  });

  it('data with no pending sample: no callout and no line, as before', async () => {
    const plain = waiting.map(({ x, y }) => ({ x, y }));
    const v = await render(<WeightTrendChartDark data={plain} through={6 * D} />);
    expect(v.queryByTestId('weight-pending')).toBeNull();
    expect(v.queryByTestId('weight-today-callout', HIDDEN)).toBeNull();
    expect(v.queryByTestId('weight-phone-line')).toBeNull();
    expect(v.queryByText(/today$/, HIDDEN)).toBeNull();
  });
});
