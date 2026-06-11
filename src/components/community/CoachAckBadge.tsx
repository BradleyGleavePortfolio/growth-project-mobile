/**
 * CoachAckBadge — v2-2 coach ack-signal badge + SLA chip (product plan §2.4).
 *
 * Renders the MEANINGFUL ack/SLA signal of a client message for the coach inbox
 * row. These are COACH-SIDE-ONLY signals shown TO the client; the client can
 * never mutate them.
 *
 * Visibility spec (R1 UX revision — kill the badge wall, doctrine §4.3/§4.4):
 * the inbox is already an "awaiting coach" surface, so a default/untouched row
 * must NOT carry redundant chrome. The badge therefore renders ONLY signals
 * that change the coach's decision:
 *   - SLA chip: shown ONLY for `warning` (`Due soon`) and `breached`
 *     (`Overdue`). `within` ("on track") is the implicit default and renders
 *     NOTHING. A `replied` (settled) message suppresses the SLA chip entirely.
 *   - Ack-state pill: shown ONLY when the state differs from the row default
 *     (`none`). `none` ("Awaiting coach") is the row's implicit meaning and
 *     renders NOTHING. `seen` / `acked` / `replied` each render a pill with a
 *     distinct visual hierarchy.
 *   - When NEITHER a state pill NOR an SLA chip qualifies (the common
 *     `state=none` + `sla=within` row), the component renders `null` — no badge
 *     at all.
 *
 * Breached priority (UX F3): when SLA is `breached` the `Overdue` chip is
 * promoted to the row-level priority cue — it renders FIRST (before the
 * ack-state pill) with the existing `AlertRow` danger vocabulary: a left danger
 * rail + danger triad fill. Priority is encoded with text + shape (the
 * `Overdue` label and the rail), never color alone, so it is legible without
 * color perception. List re-ordering by SLA is intentionally NOT done here
 * (deferred to v2-4 AI triage).
 *
 * Accessibility (UX F4): when `labelledByRow` is true the parent inbox row owns
 * the accessibility summary (it appends the ack/SLA state, Overdue-first), so
 * this badge is hidden from the accessibility tree to avoid a duplicate
 * announcement while staying visible for sighted users.
 *
 * Quiet-luxury doctrine: line Ionicons glyphs only (never pictograph emoji),
 * tokens + semanticColors only (no raw hex), text labels carry the meaning so
 * the badge is legible without color.
 *
 * Reduced motion: the badge plays a brief fade-in on mount; when the OS "Reduce
 * Motion" setting is on the badge appears at its resting opacity with NO
 * animation (no `Animated.timing` call). Reduced motion is modeled as STATE so
 * the animation effect re-runs when the setting resolves/changes. The rendered
 * content + accessibility label are identical either way.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, semantic } from '../../theme/tokens';
import type {
  CoachAckState,
  CoachSlaState,
  AckStateDto,
} from '../../api/coachCommunityApi';

// ─── Ack-state presentation ──────────────────────────────────────────────────

const ACK_COPY: Record<
  CoachAckState,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  none: { icon: 'ellipse-outline', label: 'Awaiting coach' },
  seen: { icon: 'eye-outline', label: 'Seen' },
  // UX F5 — unified public vocabulary: the state reads `Acknowledged`
  // (the button reads `Acknowledge`), never the abbreviated `Acked`.
  acked: { icon: 'checkmark-circle-outline', label: 'Acknowledged' },
  replied: { icon: 'chatbubble-ellipses-outline', label: 'Replied' },
};

const SLA_COPY: Record<CoachSlaState, { label: string; triad: keyof typeof semantic }> = {
  within: { label: 'On track', triad: 'success' },
  warning: { label: 'Due soon', triad: 'warning' },
  breached: { label: 'Overdue', triad: 'danger' },
};

/**
 * Resolve which signals the badge should render for an ack envelope, per the
 * R1 visibility spec. Exposed so the inbox row can build its accessibility
 * label from the SAME rules (single source of truth, UX F4).
 */
export function resolveAckBadgeVisibility(ack?: AckStateDto | null): {
  state: CoachAckState;
  /** The ack-state pill is rendered only when state !== 'none'. */
  showStatePill: boolean;
  /** The SLA chip's state, or null when no chip should render. */
  slaState: CoachSlaState | null;
  /** True when the SLA is breached (Overdue) — drives priority treatment. */
  breached: boolean;
  /** True when neither a state pill nor an SLA chip qualifies. */
  empty: boolean;
} {
  const state: CoachAckState = ack?.state ?? 'none';
  // A settled (replied) thread has no live SLA pressure.
  const rawSla: CoachSlaState | null =
    state === 'replied' ? null : ack?.sla?.sla_state ?? null;
  // `within` ("on track") is the implicit default and shows nothing — only
  // `warning` / `breached` qualify as a visible SLA chip.
  const slaState: CoachSlaState | null =
    rawSla === 'warning' || rawSla === 'breached' ? rawSla : null;
  const showStatePill = state !== 'none';
  const breached = slaState === 'breached';
  const empty = !showStatePill && slaState == null;
  return { state, showStatePill, slaState, breached, empty };
}

export interface CoachAckBadgeProps {
  /**
   * The ack envelope for the message (state + SLA snapshot). When `null`/absent
   * the badge treats the message as `none` — which, with the row default, means
   * the badge renders nothing.
   */
  ack?: AckStateDto | null;
  /**
   * When true the PARENT row owns the accessibility summary (it appends the
   * ack/SLA state, Overdue-first), so the badge is hidden from the
   * accessibility tree to avoid a duplicate announcement (UX F4). Defaults to
   * false (the badge announces its own label) for standalone use.
   */
  labelledByRow?: boolean;
  testID?: string;
}

export default function CoachAckBadge({
  ack,
  labelledByRow = false,
  testID,
}: CoachAckBadgeProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const { state, showStatePill, slaState, breached, empty } =
    resolveAckBadgeVisibility(ack);

  // ── Reduced-motion-aware fade-in (modeled as STATE) ───────────────────────
  // Start at resting opacity (1): if reduce-motion turns out to be ON we must
  // never animate, so the badge must be fully visible from the first paint
  // without a timing call. When reduce-motion is OFF the entrance effect resets
  // to 0 and fades in. Starting at 1 also means the suppression path requires
  // zero `Animated.timing` calls (the test seam).
  const opacity = useRef(new Animated.Value(1)).current;
  // Reduced motion is React state (not a ref) so the animation effect below
  // re-runs when the OS setting resolves/changes — that is the seam the
  // suppression test asserts on. `null` means "not resolved yet": we hold the
  // entrance until the OS setting is known so we never fire a timing the
  // setting would have suppressed.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (mounted) setReduceMotion(enabled);
      },
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    // Hold until the OS setting resolves — never animate speculatively.
    if (reduceMotion == null) return;
    if (reduceMotion) {
      // Resting opacity, no animation — `Animated.timing` is never called.
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [opacity, reduceMotion, state, slaState]);

  // Kill the badge wall: a default/untouched row (state=none + sla=within)
  // renders no badge at all.
  if (empty) return null;

  const { icon, label } = ACK_COPY[state];
  const ackPillStyle = ackPillColors(state, semanticColors);

  // Accessibility label, Overdue-first (UX F4). When the row owns the summary
  // the badge is hidden from the a11y tree, but we still compute a coherent
  // label for the standalone case.
  const accessibilityLabel = [
    slaState != null ? SLA_COPY[slaState].label : null,
    showStatePill ? label : null,
  ]
    .filter((s): s is string => s != null)
    .map((s) => `${s}.`)
    .join(' ');

  // The breached SLA chip is the priority cue and renders FIRST (UX F3).
  const slaChip =
    slaState != null ? (
      <View
        key="sla"
        testID={testID != null ? `${testID}-sla-${slaState}` : undefined}
        style={[
          styles.pill,
          breached ? styles.priorityPill : null,
          {
            backgroundColor: semantic[SLA_COPY[slaState].triad].bg,
            borderColor: semantic[SLA_COPY[slaState].triad].border,
            borderWidth: 1,
            // Breached: a left danger rail mirrors the AlertRow risk vocabulary
            // (text + shape, never color alone).
            borderLeftWidth: breached ? 3 : 1,
            borderLeftColor: semantic.danger.border,
          },
        ]}
      >
        <Ionicons
          name={breached ? 'alert-circle-outline' : 'time-outline'}
          size={12}
          color={semantic[SLA_COPY[slaState].triad].icon}
        />
        <Text
          style={[
            styles.pillLabel,
            breached ? styles.priorityLabel : null,
            { color: semantic[SLA_COPY[slaState].triad].fg },
          ]}
        >
          {SLA_COPY[slaState].label}
        </Text>
      </View>
    ) : null;

  const statePill = showStatePill ? (
    <View
      key="state"
      testID={testID != null ? `${testID}-state-${state}` : undefined}
      style={[
        styles.pill,
        {
          backgroundColor: ackPillStyle.bg,
          borderColor: ackPillStyle.border,
          borderWidth: 1,
        },
      ]}
    >
      <Ionicons name={icon} size={12} color={ackPillStyle.fg} />
      <Text style={[styles.pillLabel, { color: ackPillStyle.fg }]}>
        {label}
      </Text>
    </View>
  ) : null;

  // Breached out-shouts everything: SLA chip first, then the (muted) state
  // pill. Otherwise the state pill leads.
  const children = breached ? [slaChip, statePill] : [statePill, slaChip];

  return (
    <Animated.View
      testID={testID}
      // UX F4: when the row owns the summary, hide the badge from the a11y tree
      // so the urgent status is announced once (by the row), not duplicated.
      accessibilityElementsHidden={labelledByRow}
      importantForAccessibility={labelledByRow ? 'no-hide-descendants' : 'yes'}
      accessibilityRole={labelledByRow ? undefined : 'text'}
      accessibilityLabel={labelledByRow ? undefined : accessibilityLabel}
      style={[styles.container, { opacity }]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Resolve the ack-pill fill / border / foreground for a state, encoding the
 * distinct visual hierarchy: `replied` is the strongest (accent fill), `acked`
 * is accent-tinted, and `seen` is a soft muted chip. (`none` never renders a
 * pill under the R1 visibility spec.)
 */
function ackPillColors(
  state: CoachAckState,
  c: {
    accent: string;
    textOnAccent: string;
    bgSurface: string;
    border: string;
    textMuted: string;
    textPrimary: string;
  },
): { bg: string; border: string; fg: string } {
  switch (state) {
    case 'replied':
      return { bg: c.accent, border: c.accent, fg: c.textOnAccent };
    case 'acked':
      return { bg: c.bgSurface, border: c.accent, fg: c.accent };
    case 'seen':
      return { bg: c.bgSurface, border: c.border, fg: c.textPrimary };
    case 'none':
    default:
      return { bg: 'transparent', border: c.border, fg: c.textMuted };
  }
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  // Breached priority: a touch more presence than a peer pill (still calm).
  priorityPill: {
    paddingHorizontal: spacing.md,
    borderTopLeftRadius: radius.sm,
    borderBottomLeftRadius: radius.sm,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  priorityLabel: {
    fontWeight: '700',
  },
});
