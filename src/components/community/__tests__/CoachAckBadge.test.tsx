/**
 * CoachAckBadge — v2-2 coach ack-signal badge tests.
 *
 * Coverage (per builder brief §Tests required):
 *   - All 4 ack states (none / seen / acked / replied) x 3 SLA states
 *     (within / warning / breached) = 12 combinations render the right
 *     state-pill testID, the right human label, and (for the non-replied
 *     states) the right SLA chip testID + label.
 *   - The strongest state `replied` SUPPRESSES the SLA chip (a settled thread
 *     has no live SLA pressure) regardless of the snapshot's sla_state.
 *   - A null/absent ack envelope renders the weakest `none` state.
 *   - Reduced-motion: when the OS "Reduce Motion" setting is ON the badge rests
 *     at full opacity with NO entrance timing; when OFF it plays a single
 *     opacity fade-in. The rendered content + accessibility label are identical
 *     either way.
 *
 * useTheme is mocked to the real light tokens so semanticColors resolve without
 * a ThemeProvider (mirrors the established repo pattern).
 */
import React from 'react';
import { AccessibilityInfo, Animated, type EmitterSubscription } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import CoachAckBadge from '../CoachAckBadge';
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

const ACK_LABEL: Record<CoachAckState, string> = {
  none: 'Awaiting coach',
  seen: 'Seen',
  acked: 'Acked',
  replied: 'Replied',
};
const SLA_LABEL: Record<CoachSlaState, string> = {
  within: 'On track',
  warning: 'Due soon',
  breached: 'Overdue',
};

const ACK_STATES: CoachAckState[] = ['none', 'seen', 'acked', 'replied'];
const SLA_STATES: CoachSlaState[] = ['within', 'warning', 'breached'];

describe('CoachAckBadge — 4 ack states x 3 SLA states', () => {
  beforeEach(() => {
    // Default reduce-motion OFF; resolve synchronously enough for the tests
    // that do not assert on motion (they only read static content).
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
      it(`renders state=${state} + sla=${sla}`, () => {
        const { getByTestId, getByText, queryByTestId } = render(
          <CoachAckBadge ack={envelope(state, sla)} testID={TEST_ID} />,
        );
        // The state pill is keyed by the derived state.
        expect(getByTestId(`${TEST_ID}-state-${state}`)).toBeTruthy();
        expect(getByText(ACK_LABEL[state])).toBeTruthy();

        if (state === 'replied') {
          // A settled thread suppresses the SLA chip regardless of snapshot.
          expect(queryByTestId(`${TEST_ID}-sla-${sla}`)).toBeNull();
        } else {
          expect(getByTestId(`${TEST_ID}-sla-${sla}`)).toBeTruthy();
          expect(getByText(SLA_LABEL[sla])).toBeTruthy();
        }
      });
    }
  }

  it('renders the weakest none state when the ack envelope is null', () => {
    const { getByTestId, getByText } = render(
      <CoachAckBadge ack={null} testID={TEST_ID} />,
    );
    expect(getByTestId(`${TEST_ID}-state-none`)).toBeTruthy();
    expect(getByText('Awaiting coach')).toBeTruthy();
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

  it('reduced motion ON: never plays the entrance timing, renders identical content', async () => {
    isReduceMotionEnabled.mockResolvedValue(true);
    timingSpy.mockClear();
    const { getByTestId, getByText } = render(
      <CoachAckBadge ack={envelope('acked', 'warning')} testID={TEST_ID} />,
    );
    // The badge consults the OS reduce-motion setting and subscribes to live
    // changes (the seam that decides whether to animate).
    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
    // v2-2 (R1 fixer, M-P2): with the preference resolved to TRUE the badge must
    // NOT fire Animated.timing at all — it rests at full opacity. (The prior
    // ref-based impl could animate for a frame before the async preference
    // resolved; the tri-state useState fix holds resting until known.)
    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
    expect(timingSpy).not.toHaveBeenCalled();
    // Content is identical regardless of motion: the state pill + label render.
    expect(getByTestId(`${TEST_ID}-state-acked`)).toBeTruthy();
    expect(getByText('Acked')).toBeTruthy();
  });

  it('reduced motion UNKNOWN (unresolved): holds resting, never animates before the preference resolves', async () => {
    // Never resolve the promise — preference stays `null` (unknown). The badge
    // must hold at resting opacity and NOT animate while the setting is unknown.
    isReduceMotionEnabled.mockReturnValue(new Promise(() => {}));
    timingSpy.mockClear();
    const { getByTestId } = render(
      <CoachAckBadge ack={envelope('seen', 'within')} testID={TEST_ID} />,
    );
    expect(getByTestId(`${TEST_ID}-state-seen`)).toBeTruthy();
    expect(timingSpy).not.toHaveBeenCalled();
  });

  it('reduced motion OFF: plays a single opacity fade-in toward 1', async () => {
    isReduceMotionEnabled.mockResolvedValue(false);
    timingSpy.mockClear();
    const { getByTestId } = render(
      <CoachAckBadge ack={envelope('seen', 'within')} testID={TEST_ID} />,
    );
    await waitFor(() => expect(isReduceMotionEnabled).toHaveBeenCalled());
    // The entrance is a single opacity timing toward 1.
    await waitFor(() => expect(timingSpy).toHaveBeenCalled());
    const toValues = timingSpy.mock.calls.map(
      (c) => (c[1] as { toValue?: unknown } | undefined)?.toValue,
    );
    expect(toValues).toContain(1);
    // Content still renders.
    expect(getByTestId(`${TEST_ID}-state-seen`)).toBeTruthy();
  });
});

// ── v2-2 (R1 fixer, M-P1c): ack-pill contrast matrix ─────────────────────────
// Pins that EVERY ack-state pill clears WCAG AA (4.5:1 normal text) in BOTH
// light and dark mode. This is the regression guard for the dark-mode `acked`
// pill, which previously rendered accent-tinted text on the surface (~3.02:1,
// AA FAIL); the fix fills it with the accent + on-accent ink (same as
// `replied`). The pairs below mirror `ackPillColors` in CoachAckBadge; the
// `none` pill is transparent so it is checked against the row background
// (bgPrimary), the realistic backdrop.
describe('CoachAckBadge — ack-pill contrast matrix (AA, light + dark)', () => {
  const { lightTokens, darkTokens } = jest.requireActual('../../../theme/tokens');
  const { contrastRatio, AA_NORMAL } = jest.requireActual('../../../theme/contrast');

  // fg/bg for each state, mirroring ackPillColors(). `none` uses transparent
  // bg → evaluated against the page background (bgPrimary).
  const pairFor = (
    state: CoachAckState,
    c: typeof lightTokens,
  ): { fg: string; bg: string } => {
    switch (state) {
      case 'replied':
        return { fg: c.textOnAccent, bg: c.accent };
      case 'acked':
        return { fg: c.textOnAccent, bg: c.accent };
      case 'seen':
        return { fg: c.textPrimary, bg: c.bgSurface };
      case 'none':
      default:
        return { fg: c.textMuted, bg: c.bgPrimary };
    }
  };

  for (const [mode, tokens] of [
    ['light', lightTokens],
    ['dark', darkTokens],
  ] as const) {
    for (const state of ACK_STATES) {
      it(`${mode} ${state} pill clears AA`, () => {
        const { fg, bg } = pairFor(state, tokens);
        const ratio = contrastRatio(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }
});
