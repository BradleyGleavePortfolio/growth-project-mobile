/**
 * CoachAckBadge — v2-2 coach ack-signal badge + SLA chip (product plan §2.4).
 *
 * Renders the current ack state of a client message AND its read-time SLA
 * posture, side by side, for the coach inbox row. These are COACH-SIDE-ONLY
 * signals shown TO the client; the client can never mutate them.
 *
 * Two parts:
 *   1. Ack-state pill — one of `none` / `seen` / `acked` / `replied`, with a
 *      DISTINCT visual hierarchy. Precedence is `replied > acked > seen > none`:
 *        - replied  STRONGEST — accent fill + on-accent ink (a settled thread).
 *        - acked    strong    — accent-tinted text + accent border.
 *        - seen     soft       — muted text + hairline border.
 *        - none     weakest    — muted text, dashed-weight hairline, lowest
 *                                contrast (an untouched item that still needs
 *                                the coach).
 *   2. SLA chip — `within` / `warning` / `breached`, mapped to the old-money
 *      semantic triads (success / warning / danger). The chip is omitted for a
 *      `replied` message (a settled thread has no live SLA pressure).
 *
 * Quiet-luxury doctrine: line Ionicons glyphs only (never pictograph emoji),
 * tokens + semanticColors only (no raw hex), text labels carry the meaning so
 * the badge is legible without color (accessibility).
 *
 * Reduced motion: the badge plays a brief fade-in on mount; when the OS
 * "Reduce Motion" setting is on the badge appears at its resting opacity with
 * no animation. The rendered content + accessibility label are identical either
 * way.
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
  acked: { icon: 'checkmark-circle-outline', label: 'Acked' },
  replied: { icon: 'chatbubble-ellipses-outline', label: 'Replied' },
};

const SLA_COPY: Record<CoachSlaState, { label: string; triad: keyof typeof semantic }> = {
  within: { label: 'On track', triad: 'success' },
  warning: { label: 'Due soon', triad: 'warning' },
  breached: { label: 'Overdue', triad: 'danger' },
};

export interface CoachAckBadgeProps {
  /**
   * The ack envelope for the message (state + SLA snapshot). When `null`/absent
   * the badge treats the message as `none` so a row with no ack data still
   * renders a coherent weakest-state pill.
   */
  ack?: AckStateDto | null;
  testID?: string;
}

export default function CoachAckBadge({
  ack,
  testID,
}: CoachAckBadgeProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const state: CoachAckState = ack?.state ?? 'none';
  const slaState: CoachSlaState | null =
    state === 'replied' ? null : ack?.sla?.sla_state ?? null;

  // ── Reduced-motion-aware fade-in ──────────────────────────────────────────
  const opacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);
  const [, setReduceMotionTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    const apply = (enabled: boolean): void => {
      if (reduceMotion.current === enabled) return;
      reduceMotion.current = enabled;
      setReduceMotionTick((t) => t + 1);
    };
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!mounted) return;
      apply(enabled);
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (!mounted) return;
        apply(enabled);
      },
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion.current) {
      // Resting opacity, no animation.
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
  }, [opacity, state, slaState]);

  const { icon, label } = ACK_COPY[state];

  // Ack pill colors — distinct hierarchy keyed off the state rank.
  const ackPillStyle = ackPillColors(state, semanticColors);

  const accessibilityLabel =
    slaState != null
      ? `Coach ack ${label}. SLA ${SLA_COPY[slaState].label}.`
      : `Coach ack ${label}.`;

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, { opacity }]}
    >
      <View
        testID={testID != null ? `${testID}-state-${state}` : undefined}
        style={[
          styles.pill,
          {
            backgroundColor: ackPillStyle.bg,
            borderColor: ackPillStyle.border,
            borderWidth: state === 'none' ? StyleSheet.hairlineWidth : 1,
          },
        ]}
      >
        <Ionicons name={icon} size={12} color={ackPillStyle.fg} />
        <Text style={[styles.pillLabel, { color: ackPillStyle.fg }]}>
          {label}
        </Text>
      </View>

      {slaState != null ? (
        <View
          testID={testID != null ? `${testID}-sla-${slaState}` : undefined}
          style={[
            styles.pill,
            {
              backgroundColor: semantic[SLA_COPY[slaState].triad].bg,
              borderColor: semantic[SLA_COPY[slaState].triad].border,
              borderWidth: 1,
            },
          ]}
        >
          <Ionicons
            name="time-outline"
            size={12}
            color={semantic[SLA_COPY[slaState].triad].icon}
          />
          <Text
            style={[
              styles.pillLabel,
              { color: semantic[SLA_COPY[slaState].triad].fg },
            ]}
          >
            {SLA_COPY[slaState].label}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Resolve the ack-pill fill / border / foreground for a state, encoding the
 * distinct visual hierarchy: `replied` is the strongest (accent fill), `acked`
 * is accent-tinted, `seen` is a soft muted chip, and `none` is the weakest,
 * lowest-contrast chip (an item still awaiting the coach).
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
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});
