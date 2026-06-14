/**
 * PermanenceMarker — ED.5 onboarding package/pricing permanence marker.
 *
 * Verifies:
 *   • the Roman line appears, then fades after ~1.6s while the checkmark stays
 *     mounted (the permanence marker persists);
 *   • nothing renders when the flag is off or nothing is saved yet;
 *   • Roman-voice doctrine over both stems — no `!`, no emoji, no contractions,
 *     no "your coach" (Roman speaks to the coach about their own setup, so each
 *     stem stands alone).
 *
 * L8/L10 learnings: RNTL v14 `await render(...)`; fake timers + advanceTimersByTime
 * to step past the 1.6s dwell; Reanimated + theme mocked deterministically.
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: { View: RN.View },
    // Mirror the real hook: a STABLE shared-value ref across renders. A fresh
    // object per render would make effect deps churn and re-fire the effect.
    useSharedValue: (initial: number) => ReactLib.useRef({ value: initial }).current,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (toValue: number) => toValue,
    Easing: { out: () => () => 0, inOut: () => () => 0, cubic: () => 0 },
  };
});

let mockReduceMotion = false;
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

jest.mock('../../../theme/ThemeProvider', () => ({
  __esModule: true,
  useTheme: () => ({
    semanticColors: {
      bgPrimary: '#F5EFE4',
      bgSurface: '#FFFDF8',
      textPrimary: '#1A1A18',
      textMuted: '#6B675F',
      accent: '#4A0404',
      accentText: '#4A0404',
      textOnAccent: '#FBF7F0',
      disabledBg: '#E0D9CE',
      textOnDisabled: '#524E47',
      border: '#DCD5CC',
      overlay: 'rgba(26,26,24,0.40)',
    },
  }),
}));

import PermanenceMarker, {
  PERMANENCE_LINE_VISIBLE_MS,
  PERMANENCE_LINE_FADE_MS,
} from '../PermanenceMarker';
import { romanPermanenceMarker } from '../../../lib/roman/copy';

beforeEach(() => {
  mockReduceMotion = false;
});

describe('PermanenceMarker', () => {
  it('renders nothing when the flag is off', async () => {
    const { queryByTestId } = await render(
      <PermanenceMarker kind="packageSaved" saved enabled={false} testID="pm" />,
    );
    expect(queryByTestId('pm')).toBeNull();
  });

  it('renders nothing before the value is saved', async () => {
    const { queryByTestId } = await render(
      <PermanenceMarker kind="packageSaved" saved={false} enabled testID="pm" />,
    );
    expect(queryByTestId('pm')).toBeNull();
  });

  it('keeps the checkmark and still shows the line under Reduce Motion', async () => {
    mockReduceMotion = true;
    const { getByTestId } = await render(
      <PermanenceMarker kind="priceSaved" saved enabled testID="pm" />,
    );
    expect(getByTestId('pm-check')).toBeTruthy();
    expect(getByTestId('pm-line').props.children).toBe(romanPermanenceMarker.priceSaved);
  });

  // Timer-driven assertion last: fake timers can perturb the async render flush
  // for subsequent cases, so this runs after the plain-render expectations.
  it('shows the Roman line, fades it after 1.6s, and keeps the checkmark mounted', async () => {
    jest.useFakeTimers();
    try {
      const { getByTestId, queryByTestId } = await render(
        <PermanenceMarker kind="packageSaved" saved enabled testID="pm" />,
      );
      // The transient line is present immediately…
      expect(getByTestId('pm-line').props.children).toBe(romanPermanenceMarker.packageSaved);
      // …and the persistent checkmark is mounted.
      expect(getByTestId('pm-check')).toBeTruthy();

      // Advance past the dwell + the fade-out unmount window. The unmount is a
      // React state update fired from a timer, so flush it inside an async act.
      await act(async () => {
        jest.advanceTimersByTime(PERMANENCE_LINE_VISIBLE_MS + PERMANENCE_LINE_FADE_MS + 10);
      });

      // The transient line has unmounted…
      expect(queryByTestId('pm-line')).toBeNull();
      // …but the permanence marker (checkmark) stays.
      expect(getByTestId('pm-check')).toBeTruthy();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  // ── Roman-voice doctrine over the permanence-marker stems ──────────────────
  describe('Roman-voice doctrine (romanPermanenceMarker stems)', () => {
    const STEMS = [
      { label: 'packageSaved', value: romanPermanenceMarker.packageSaved },
      { label: 'priceSaved', value: romanPermanenceMarker.priceSaved },
    ];

    const EMOJI_RE = new RegExp(
      [
        '[\\u{1F300}-\\u{1FAFF}]',
        '[\\u{2600}-\\u{27BF}]',
        '[\\u{2B00}-\\u{2BFF}]',
        '[\\u{1F1E6}-\\u{1F1FF}]',
        '[\\u{FE00}-\\u{FE0F}]',
      ].join('|'),
      'u',
    );

    it.each(STEMS)('"$label" carries zero exclamation marks', ({ value }) => {
      expect((value.match(/!/g) ?? []).length).toBe(0);
    });

    it.each(STEMS)('"$label" contains no emoji', ({ value }) => {
      expect(EMOJI_RE.test(value)).toBe(false);
    });

    it.each(STEMS)('"$label" uses no contractions', ({ value }) => {
      // Any apostrophe-bearing contraction (You'll, can't, it's, …) is banned.
      expect(/\b\w+['\u2019]\w+\b/.test(value)).toBe(false);
    });

    it.each(STEMS)('"$label" does not say "your coach"', ({ value }) => {
      expect(/your coach/i.test(value)).toBe(false);
    });

    it.each(STEMS)('"$label" is a calm, period-terminated reassurance', ({ value }) => {
      expect(value.trim().endsWith('.')).toBe(true);
      // It states the save and offers reversibility ("any time").
      expect(/saved\./i.test(value)).toBe(true);
      expect(/any time\.$/i.test(value)).toBe(true);
    });
  });
});
