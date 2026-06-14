/**
 * CoachAckBadge — v2-2 coach ack-signal badge tests (R1 visibility revision).
 *
 * Coverage (R1 "kill the badge wall" spec — doctrine §4.3/§4.4):
 *   - All 4 ack states (none / seen / acked / replied) x 3 SLA states
 *     (within / warning / breached) = 12 combinations, asserting the R1
 *     visibility rules:
 *       · state pill renders ONLY when state !== 'none' (the row default
 *         `none` is implicit and shows no pill);
 *       · SLA chip renders ONLY for `warning` (Due soon) / `breached`
 *         (Overdue) — `within` (on track) is the implicit default and shows
 *         NOTHING;
 *       · a settled `replied` thread SUPPRESSES the SLA chip entirely;
 *       · when NEITHER a pill nor a chip qualifies (the common
 *         `none` + `within` row) the component renders `null` — no badge.
 *   - The unified public vocabulary: `acked` reads `Acknowledged` (never the
 *     abbreviated `Acked`).
 *   - Breached priority: `Overdue` renders FIRST (before the state pill) with
 *     the dedicated priority chip testID.
 *   - `labelledByRow` hides the badge from the accessibility tree (the row owns
 *     the summary) while keeping it visible for sighted users.
 *   - Reduced-motion: when the OS "Reduce Motion" setting is ON the badge rests
 *     at full opacity with NO entrance timing (`Animated.timing` is never
 *     called); when OFF it plays a single opacity fade-in toward 1. The
 *     rendered content is identical either way.
 *
 * useTheme is mocked to the real light tokens so semanticColors resolve without
 * a ThemeProvider (mirrors the established repo pattern).
 */
import React from 'react';
import { AccessibilityInfo, Animated, type EmitterSubscription } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import CoachAckBadge, {
  resolveAckBadgeVisibility,
} from '../CoachAckBadge';
import type {
  AckStateDto,
  CoachAckState,
  CoachSlaState,
} from '../../../api/coachCommunityApi';

// ── Theme: real tokens, no ThemeProvider ─────────────────────────────────────
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

const TEST_ID = 'ack-badge-under-test';

/** A remove-only EmitterSubscription stub (cleanup only ever calls remove()). */
function makeSubscription(): EmitterSubscription {
  // @ts-expect-error — intentional remove-only stub; cleanup only calls remove()
  return { remove: jest.fn() };
}

function envelope(state: CoachAckState, sla: CoachSlaState): AckStateDto {
  return {
    state,
    seen_at: state === 'none' ? null : '2026-06-09T12:00:00.000Z',
    acked_at:
      state === 'acked' || state === 'replied'
        ? '2026-06-09T12:05:00.000Z'
        : null,
    replied_at: state === 'replied' ? '2026-06-09T12:10:00.000Z' : null,
    sla: {
      sla_state: sla,
      elapsed_ms: 1_000,
      soft_target_ms: 24 * 60 * 60 * 1000,
      hard_target_ms: 48 * 60 * 60 * 1000,
    },
  };
}

// R1 vocabulary: the state pill reads `Acknowledged` for `acked`.
const ACK_LABEL: Record<CoachAckState, string> = {
  none: 'Awaiting coach',
  seen: 'Seen',
  acked: 'Acknowledged',
  replied: 'Replied',
};
const SLA_LABEL: Record<CoachSlaState, string> = {
  within: 'On track',
  warning: 'Due soon',
  breached: 'Overdue',
};

const ACK_STATES: CoachAckState[] = ['none', 'seen', 'acked', 'replied'];
const SLA_STATES: CoachSlaState[] = ['within', 'warning', 'breached'];

// Which SLA states render a visible chip (R1: only warning / breached).
function slaChipVisible(state: CoachAckState, sla: CoachSlaState): boolean {
  if (state === 'replied') return false; // settled thread suppresses SLA
  return sla === 'warning' || sla === 'breached';
}
// Which states render a visible state pill (R1: only non-`none`).
function statePillVisible(state: CoachAckState): boolean {
  return state !== 'none';
}

describe('CoachAckBadge — R1 visibility matrix (4 ack x 3 SLA)', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((): EmitterSubscription => makeSubscription());
  });
  afterEach(() => jest.restoreAllMocks());

  for (const state of ACK_STATES) {
    for (const sla of SLA_STATES) {
      const wantPill = statePillVisible(state);
      const wantChip = slaChipVisible(state, sla);
      const wantBadge = wantPill || wantChip;

      it(`state=${state} + sla=${sla} → ${
        wantBadge ? 'renders qualifying signals only' : 'renders nothing'
      }`, async () => {
        const { getByTestId, getByText, queryByTestId, queryByText } = await render(
          <CoachAckBadge ack={envelope(state, sla)} testID={TEST_ID} />,
        );

        if (!wantBadge) {
          // Kill the badge wall: a default/untouched row renders no badge.
          expect(queryByTestId(TEST_ID)).toBeNull();
          expect(queryByTestId(`${TEST_ID}-state-${state}`)).toBeNull();
          expect(queryByTestId(`${TEST_ID}-sla-${sla}`)).toBeNull();
          return;
        }

        // The container is present when at least one signal qualifies.
        expect(getByTestId(TEST_ID)).toBeTruthy();

        // State pill: present iff state !== 'none'.
        if (wantPill) {
          expect(getByTestId(`${TEST_ID}-state-${state}`)).toBeTruthy();
          expect(getByText(ACK_LABEL[state])).toBeTruthy();
        } else {
          expect(queryByTestId(`${TEST_ID}-state-${state}`)).toBeNull();
        }

        // SLA chip: present iff warning/breached and not settled.
        if (wantChip) {
          expect(getByTestId(`${TEST_ID}-sla-${sla}`)).toBeTruthy();
          expect(getByText(SLA_LABEL[sla])).toBeTruthy();
        } else {
          expect(queryByTestId(`${TEST_ID}-sla-${sla}`)).toBeNull();
          // `within` never announces an "On track" chip.
          if (sla === 'within') {
            expect(queryByText('On track')).toBeNull();
          }
        }
      });
    }
  }

  it('none + within renders null (no badge, no testID)', async () => {
    const { queryByTestId } = await render(
      <CoachAckBadge ack={envelope('none', 'within')} testID={TEST_ID} />,
    );
    expect(queryByTestId(TEST_ID)).toBeNull();
  });

  it('null/absent ack envelope renders null (treated as none + within)', async () => {
    const { queryByTestId } = await render(
      <CoachAckBadge ack={null} testID={TEST_ID} />,
    );
    expect(queryByTestId(TEST_ID)).toBeNull();
  });

  it('none + breached shows ONLY the Overdue chip (no state pill)', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <CoachAckBadge ack={envelope('none', 'breached')} testID={TEST_ID} />,
    );
    expect(getByTestId(`${TEST_ID}-sla-breached`)).toBeTruthy();
    expect(getByText('Overdue')).toBeTruthy();
    expect(queryByTestId(`${TEST_ID}-state-none`)).toBeNull();
  });

  it('replied + breached suppresses the SLA chip (settled thread)', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <CoachAckBadge ack={envelope('replied', 'breached')} testID={TEST_ID} />,
    );
    expect(getByTestId(`${TEST_ID}-state-replied`)).toBeTruthy();
    expect(getByText('Replied')).toBeTruthy();
    expect(queryByTestId(`${TEST_ID}-sla-breached`)).toBeNull();
  });

  it('acked reads "Acknowledged", never the abbreviated "Acked"', async () => {
    const { getByText, queryByText } = await render(
      <CoachAckBadge ack={envelope('acked', 'warning')} testID={TEST_ID} />,
    );
    expect(getByText('Acknowledged')).toBeTruthy();
    expect(queryByText('Acked')).toBeNull();
  });
});

describe('CoachAckBadge — resolveAckBadgeVisibility (single source of truth)', () => {
  it('none + within is empty (no pill, no chip)', () => {
    const v = resolveAckBadgeVisibility(envelope('none', 'within'));
    expect(v).toMatchObject({
      showStatePill: false,
      slaState: null,
      breached: false,
      empty: true,
    });
  });

  it('none + breached surfaces the Overdue chip only', () => {
    const v = resolveAckBadgeVisibility(envelope('none', 'breached'));
    expect(v).toMatchObject({
      showStatePill: false,
      slaState: 'breached',
      breached: true,
      empty: false,
    });
  });

  it('acked + within shows the state pill, no SLA chip', () => {
    const v = resolveAckBadgeVisibility(envelope('acked', 'within'));
    expect(v).toMatchObject({
      showStatePill: true,
      slaState: null,
      breached: false,
      empty: false,
    });
  });

  it('replied + breached suppresses SLA (settled)', () => {
    const v = resolveAckBadgeVisibility(envelope('replied', 'breached'));
    expect(v).toMatchObject({ showStatePill: true, slaState: null });
  });
});

describe('CoachAckBadge — accessibility ownership (labelledByRow)', () => {
  beforeEach(() => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((): EmitterSubscription => makeSubscription());
  });
  afterEach(() => jest.restoreAllMocks());

  it('labelledByRow hides the badge from the a11y tree but keeps it visible', async () => {
    const { getByTestId } = await render(
      <CoachAckBadge
        ack={envelope('acked', 'breached')}
        labelledByRow
        testID={TEST_ID}
      />,
    );
    // The badge is hidden from the a11y tree, so RTL only surfaces it when we
    // opt into hidden elements — which is exactly the intended behavior.
    const node = getByTestId(TEST_ID, { includeHiddenElements: true });
    expect(node.props.accessibilityElementsHidden).toBe(true);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
    // No self-owned role/label when the row owns the summary.
    expect(node.props.accessibilityLabel).toBeUndefined();
    // Still visually rendered (its signal children mount).
    expect(
      getByTestId(`${TEST_ID}-sla-breached`, { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('standalone (no labelledByRow) announces an Overdue-first label', async () => {
    const { getByTestId } = await render(
      <CoachAckBadge ack={envelope('acked', 'breached')} testID={TEST_ID} />,
    );
    const node = getByTestId(TEST_ID);
    expect(node.props.accessibilityElementsHidden).toBe(false);
    expect(node.props.accessibilityRole).toBe('text');
    // Overdue leads the label, then the ack state.
    expect(node.props.accessibilityLabel).toBe('Overdue. Acknowledged.');
  });
});

describe('CoachAckBadge — reduced motion', () => {
  let isReduceMotionEnabled: jest.SpyInstance;
  let timingSpy: jest.SpyInstance;

  beforeEach(() => {
    isReduceMotionEnabled = jest.spyOn(
      AccessibilityInfo,
      'isReduceMotionEnabled',
    );
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((): EmitterSubscription => makeSubscription());
    timingSpy = jest.spyOn(Animated, 'timing');
  });
  afterEach(() => jest.restoreAllMocks());

  it('reduced motion ON: NO entrance timing, rests at full opacity', async () => {
    isReduceMotionEnabled.mockResolvedValue(true);
    timingSpy.mockClear();
    const { getByTestId, getByText } = await render(
      // acked + warning so the badge actually renders (qualifying signals).
      <CoachAckBadge ack={envelope('acked', 'warning')} testID={TEST_ID} />,
    );
    // The badge consults the OS reduce-motion setting (the seam).
    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
    // Suppression: Animated.timing is NEVER called when reduce-motion is on.
    await waitFor(() => {
      expect(timingSpy).not.toHaveBeenCalled();
    });
    // Resting opacity is 1 (no animation interpolation).
    const node = getByTestId(TEST_ID);
    const flat = Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style.filter(Boolean))
      : node.props.style;
    const opacityVal =
      flat.opacity && typeof flat.opacity === 'object'
        ? // Animated.Value exposes its current value via __getValue()
          (flat.opacity as { __getValue: () => number }).__getValue()
        : flat.opacity;
    expect(opacityVal).toBe(1);
    // Content is identical regardless of motion.
    expect(getByText('Acknowledged')).toBeTruthy();
  });

  it('reduced motion OFF: plays a single opacity fade-in toward 1', async () => {
    isReduceMotionEnabled.mockResolvedValue(false);
    timingSpy.mockClear();
    const { getByTestId } = await render(
      // acked + warning so the badge renders under the R1 spec.
      <CoachAckBadge ack={envelope('acked', 'warning')} testID={TEST_ID} />,
    );
    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
    // The entrance is a single opacity timing toward 1.
    await waitFor(() => expect(timingSpy).toHaveBeenCalled());
    const toValues = timingSpy.mock.calls.map(
      (c) => (c[1] as { toValue?: unknown } | undefined)?.toValue,
    );
    expect(toValues).toContain(1);
    expect(getByTestId(`${TEST_ID}-state-acked`)).toBeTruthy();
  });
});
