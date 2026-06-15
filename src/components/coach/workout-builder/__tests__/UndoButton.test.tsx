/**
 * UndoButton.test — EW2 toolbar undo button + two-finger swipe gesture.
 *
 * Verifies the presentation + gesture contract:
 *   - enabled (canUndo=true): tap fires onUndo;
 *   - a two-finger swipe-down past threshold fires onUndo;
 *   - disabled (canUndo=false): tap does NOT fire, accessibilityState.disabled,
 *     and the gesture is inert;
 *   - the line glyph (arrow-undo-outline) renders and the calm surface token
 *     `semanticColors.bgSurface` is used (no raw hex, no `surface` shorthand).
 *
 * RNTL v14: `await render(...)` (NEVER sync). The gesture-handler is mocked to
 * capture the Pan `onEnd` callback so the test can drive a two-finger swipe
 * synchronously (mirrors the repo's ProgressChartCard gesture-capture pattern).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ── gesture-handler — capture the Pan onEnd callback + the pointer constraints
// so the test can drive a two-finger swipe-down synchronously. jest.setup.js
// does NOT mock gesture-handler, so the component test owns this. ────────────
interface PanCapture {
  onEnd?: (e: { translationY: number }) => void;
  minPointers?: number;
  maxPointers?: number;
  ranOnJS?: boolean;
}
const pan: PanCapture = {};

jest.mock('react-native-gesture-handler', () => {
  const mockReact = require('react');
  const makeGesture = () => {
    const g: Record<string, unknown> = {};
    g.runOnJS = (v: boolean) => {
      pan.ranOnJS = v;
      return g;
    };
    g.minPointers = (n: number) => {
      pan.minPointers = n;
      return g;
    };
    g.maxPointers = (n: number) => {
      pan.maxPointers = n;
      return g;
    };
    g.onEnd = (fn: PanCapture['onEnd']) => {
      pan.onEnd = fn;
      return g;
    };
    return g;
  };
  return {
    Gesture: { Pan: makeGesture },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      mockReact.createElement(mockReact.Fragment, null, children),
  };
});

// ── @expo/vector-icons — a light stub so the glyph name is assertable. ───────
jest.mock('@expo/vector-icons', () => {
  const mockReact = require('react');
  return {
    Ionicons: ({ name, color }: { name: string; color: string }) =>
      mockReact.createElement('Ionicons', { name, color, testID: `icon-${name}` }),
  };
});

// ── ThemeProvider — the real light tokens so we assert the actual bgSurface. ─
jest.mock('../../../../theme/ThemeProvider', () => {
  const { lightTokens } = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ semanticColors: lightTokens }) };
});

import UndoButton from '../UndoButton';
import { lightTokens } from '../../../../theme/tokens';

beforeEach(() => {
  pan.onEnd = undefined;
  pan.minPointers = undefined;
  pan.maxPointers = undefined;
  pan.ranOnJS = undefined;
});

describe('UndoButton', () => {
  it('renders the line undo glyph and the calm surface container token', async () => {
    const { getByTestId } = await render(
      <UndoButton onUndo={jest.fn()} canUndo />,
    );
    // Line glyph (no emoji, doctrine line-icon rule).
    expect(getByTestId('icon-arrow-undo-outline')).toBeTruthy();
    // Container uses the bgSurface semantic token (NOT a raw hex, NOT `surface`).
    const container = getByTestId('mwb-undo-button-container');
    const flat = Array.isArray(container.props.style)
      ? Object.assign({}, ...container.props.style)
      : container.props.style;
    expect(flat.backgroundColor).toBe(lightTokens.bgSurface);
  });

  it('fires onUndo on tap when enabled', async () => {
    const onUndo = jest.fn();
    const { getByTestId } = await render(<UndoButton onUndo={onUndo} canUndo />);
    fireEvent.press(getByTestId('mwb-undo-button'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('fires onUndo on a two-finger swipe-down past threshold', async () => {
    const onUndo = jest.fn();
    await render(<UndoButton onUndo={onUndo} canUndo />);
    // The gesture must be a JS-thread, exactly-two-pointer pan.
    expect(pan.ranOnJS).toBe(true);
    expect(pan.minPointers).toBe(2);
    expect(pan.maxPointers).toBe(2);
    expect(typeof pan.onEnd).toBe('function');
    // A downward fling past the threshold fires onUndo.
    pan.onEnd?.({ translationY: 60 });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onUndo for a sub-threshold or upward swipe', async () => {
    const onUndo = jest.fn();
    await render(<UndoButton onUndo={onUndo} canUndo />);
    pan.onEnd?.({ translationY: 10 }); // too small
    pan.onEnd?.({ translationY: -80 }); // upward
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('is disabled when canUndo=false: tap is inert + accessibilityState.disabled', async () => {
    const onUndo = jest.fn();
    const { getByTestId } = await render(
      <UndoButton onUndo={onUndo} canUndo={false} />,
    );
    const btn = getByTestId('mwb-undo-button');
    expect(btn.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(btn);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('gesture is inert when canUndo=false', async () => {
    const onUndo = jest.fn();
    await render(<UndoButton onUndo={onUndo} canUndo={false} />);
    pan.onEnd?.({ translationY: 80 });
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('honours a custom testID', async () => {
    const { getByTestId } = await render(
      <UndoButton onUndo={jest.fn()} canUndo testID="custom-undo" />,
    );
    expect(getByTestId('custom-undo')).toBeTruthy();
    expect(getByTestId('custom-undo-container')).toBeTruthy();
  });
});
