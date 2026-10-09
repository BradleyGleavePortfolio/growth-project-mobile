/**
 * ONB-SWEEP U4 (agent 135): the consultation wheel (birth year, height,
 * weight). On Android it keeps its own drag inside the scrolling page
 * (nestedScrollEnabled). A flick settles where its momentum ends, not at
 * the row under the finger on release; a still release settles at once.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Wheel } from '../components';
import { lightTokens } from '../../../theme/tokens';

const mockTokens = lightTokens;
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => ({ semanticColors: mockTokens }) }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: mockTokens }) }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));

const YEARS = Array.from({ length: 60 }, (_, i) => 1950 + i);
const ROW = 44;
const at = (row: number, extra: Record<string, unknown> = {}) => ({
  nativeEvent: { contentOffset: { x: 0, y: row * ROW }, ...extra },
});

async function mount() {
  const change = jest.fn();
  const r = await render(<Wheel label="Birth year" values={YEARS} value={1990} onChange={change} testID="wheel" />);
  return { r, change, scroll: r.getByTestId('wheel-scroll', { includeHiddenElements: true }) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// The rows are hidden from screen readers (the frame is the adjustable control).
it('keeps its drag inside the page on Android', async () => {
  const { scroll } = await mount();
  expect(scroll.props.nestedScrollEnabled).toBe(true);
});

it('a flick is not stopped at the release row: it settles on momentum end', async () => {
  const { scroll, change } = await mount();
  // Released at 1993 with velocity (Android: no target offset).
  await fireEvent(scroll, 'scrollEndDrag', at(43, { velocity: { x: 0, y: -2.4 } }));
  expect(change).not.toHaveBeenCalled();
  await fireEvent(scroll, 'momentumScrollEnd', at(52));
  expect(change.mock.calls).toEqual([[2002]]);
});

it('an iOS flick heading to another row waits for momentum end too', async () => {
  const { scroll, change } = await mount();
  await fireEvent(scroll, 'scrollEndDrag', at(43, { velocity: { x: 0, y: 1.8 }, targetContentOffset: { x: 0, y: 50 * ROW } }));
  expect(change).not.toHaveBeenCalled();
  await fireEvent(scroll, 'momentumScrollEnd', at(50));
  expect(change.mock.calls).toEqual([[2000]]);
});

it('a still release (no velocity, or already at its snap row) settles at once', async () => {
  const { scroll, change } = await mount();
  await fireEvent(scroll, 'scrollEndDrag', at(42, { velocity: { x: 0, y: 0 } }));
  await fireEvent(scroll, 'scrollEndDrag', at(44));
  await fireEvent(scroll, 'scrollEndDrag', at(45, { velocity: { x: 0, y: 0.3 }, targetContentOffset: { x: 0, y: 45 * ROW } }));
  expect(change.mock.calls).toEqual([[1992], [1994], [1995]]);
});
