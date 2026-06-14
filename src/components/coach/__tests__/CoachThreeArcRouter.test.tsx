/**
 * CoachThreeArcRouter — Roman ED.2 three-arc router render + interaction tests.
 *
 * Coverage:
 *   - renders all three arcs (CHECK-INS / BRIEF / REVIEW) with their fractions;
 *   - renders three empty 0/0 + 0/1 arcs when `rings` is undefined (loading /
 *     backend-flag-OFF) — never a "Coming soon" placeholder;
 *   - per-arc onPress fires the matching deep-link callback;
 *   - the Roman voice line is the ENCOURAGEMENT copy while any arc is open and
 *     flips to the CELEBRATION copy only when all three arcs close (3/3);
 *   - the brief arc is binary (opened → 1/1, not opened → 0/1);
 *   - the fraction text uses the Cormorant value font, never a 700/800 weight;
 *   - degenerate counts (reviewed > submitted, zero totals) clamp without
 *     throwing and never produce NaN in the rendered fraction.
 *
 * useTheme is mocked to the real light tokens so `semanticColors` resolve
 * without a ThemeProvider (the established repo pattern, mirrors CoachAckBadge).
 * RNTL v14: render is always awaited; fireEvent is wrapped in act implicitly.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CoachThreeArcRouter from '../CoachThreeArcRouter';
import type { DailyRings } from '../../../api/coachDailyRingsApi';
import {
  romanDailyRingsCelebration,
  romanDailyRingsEncouragement,
} from '../../../lib/roman/copy';

// ── Theme: real light tokens, no ThemeProvider ───────────────────────────────
jest.mock('../../../theme/ThemeProvider', () => {
  const actual = jest.requireActual('../../../theme/ThemeProvider');
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    ...actual,
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

function makeRings(over: Partial<DailyRings> = {}): DailyRings {
  return {
    checkIns: { reviewed: 0, submitted: 0 },
    brief: { opened: false },
    review: { reviewed: 0, totalConversations: 0 },
    ...over,
  };
}

function noop(): void {
  /* intentional no-op handler */
}

describe('CoachThreeArcRouter', () => {
  it('renders all three arc labels', async () => {
    const { getByText } = await render(
      <CoachThreeArcRouter
        rings={makeRings()}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    expect(getByText('CHECK-INS')).toBeTruthy();
    expect(getByText('BRIEF')).toBeTruthy();
    expect(getByText('REVIEW')).toBeTruthy();
  });

  it('renders the partial fractions for each arc', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings({
          checkIns: { reviewed: 3, submitted: 5 },
          brief: { opened: false },
          review: { reviewed: 2, totalConversations: 4 },
        })}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    expect(getByTestId('coach-arc-checkIns-fraction').props.children).toBe('3/5');
    expect(getByTestId('coach-arc-brief-fraction').props.children).toBe('0/1');
    expect(getByTestId('coach-arc-review-fraction').props.children).toBe('2/4');
  });

  it('renders three empty arcs when rings is undefined (loading / flag OFF)', async () => {
    const { getByTestId, queryByText } = await render(
      <CoachThreeArcRouter
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    expect(getByTestId('coach-arc-checkIns-fraction').props.children).toBe('0/0');
    expect(getByTestId('coach-arc-brief-fraction').props.children).toBe('0/1');
    expect(getByTestId('coach-arc-review-fraction').props.children).toBe('0/0');
    // Empty state is real arcs at zero — never a placeholder gate (R77 posture).
    expect(queryByText(/coming soon/i)).toBeNull();
    expect(queryByText(/in development/i)).toBeNull();
  });

  it('fires onPressCheckIns when the check-ins arc is pressed', async () => {
    const onPressCheckIns = jest.fn();
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings()}
        onPressCheckIns={onPressCheckIns}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    fireEvent.press(getByTestId('coach-arc-checkIns'));
    expect(onPressCheckIns).toHaveBeenCalledTimes(1);
  });

  it('fires onPressBrief when the brief arc is pressed', async () => {
    const onPressBrief = jest.fn();
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings()}
        onPressCheckIns={noop}
        onPressBrief={onPressBrief}
        onPressReview={noop}
      />,
    );
    fireEvent.press(getByTestId('coach-arc-brief'));
    expect(onPressBrief).toHaveBeenCalledTimes(1);
  });

  it('fires onPressReview when the review arc is pressed', async () => {
    const onPressReview = jest.fn();
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings()}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={onPressReview}
      />,
    );
    fireEvent.press(getByTestId('coach-arc-review'));
    expect(onPressReview).toHaveBeenCalledTimes(1);
  });

  it('shows the ENCOURAGEMENT line while at least one arc is open', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings({
          checkIns: { reviewed: 5, submitted: 5 },
          brief: { opened: true },
          review: { reviewed: 1, totalConversations: 4 },
        })}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    expect(getByTestId('coach-three-arc-voice-line').props.children).toBe(
      romanDailyRingsEncouragement,
    );
  });

  it('shows the CELEBRATION line only when all three arcs are closed (3/3)', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings({
          checkIns: { reviewed: 5, submitted: 5 },
          brief: { opened: true },
          review: { reviewed: 4, totalConversations: 4 },
        })}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    expect(getByTestId('coach-three-arc-voice-line').props.children).toBe(
      romanDailyRingsCelebration,
    );
  });

  it('the all-zero empty state is NOT a celebration (totals of 0 are not "closed")', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    // brief is 0/1 (open) so the row is not 3/3 — encouragement, not celebration.
    expect(getByTestId('coach-three-arc-voice-line').props.children).toBe(
      romanDailyRingsEncouragement,
    );
  });

  it('renders the brief arc as 1/1 when the brief is opened', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings({ brief: { opened: true } })}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    expect(getByTestId('coach-arc-brief-fraction').props.children).toBe('1/1');
  });

  it('clamps a degenerate reviewed>submitted count without throwing or NaN', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings({ checkIns: { reviewed: 9, submitted: 5 } })}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    const fractionText = getByTestId('coach-arc-checkIns-fraction').props
      .children as string;
    expect(fractionText).toBe('9/5');
    expect(fractionText).not.toMatch(/NaN/);
  });

  it('the fraction value uses the Cormorant font and never a 700/800 weight', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings({ checkIns: { reviewed: 1, submitted: 2 } })}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    const style = getByTestId('coach-arc-checkIns-fraction').props.style as
      | Record<string, unknown>
      | Array<Record<string, unknown>>;
    const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flat.fontFamily).toBe('CormorantGaramond_500Medium');
    expect(flat.fontWeight).not.toBe('700');
    expect(flat.fontWeight).not.toBe('800');
  });

  it('exposes a button accessibility role + label on each arc', async () => {
    const { getByTestId } = await render(
      <CoachThreeArcRouter
        rings={makeRings({ checkIns: { reviewed: 3, submitted: 5 } })}
        onPressCheckIns={noop}
        onPressBrief={noop}
        onPressReview={noop}
      />,
    );
    const arc = getByTestId('coach-arc-checkIns');
    expect(arc.props.accessibilityRole).toBe('button');
    expect(arc.props.accessibilityLabel).toContain('CHECK-INS');
    expect(arc.props.accessibilityLabel).toContain('3/5');
  });
});
