/**
 * LessonReleaseLockBadge — a calm "releases later" affordance for a classroom
 * lesson that is published but whose `release_at` is still in the future
 * (v3-2). The lock is a content-pacing cue, NOT an error or a paywall: the
 * lesson exists and is on its way, so the copy is reassuring ("Unlocks soon"),
 * never a "denied"/"locked out" framing (DESIGN_INTELLIGENCE §3.4 — no public
 * failure / no punitive states).
 *
 * `release_locked` is derived server-side (the client never compares clocks),
 * so this badge renders purely from the boolean the API hands it. When a
 * release time is known it is surfaced as a relative hint ("Unlocks in 3 days")
 * so the student has a sense of when to come back, without leaking exact server
 * time semantics.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). The badge is a
 * non-interactive status chip with an `accessibilityRole="text"` label so a
 * screen reader announces it as state, not a control.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';

export interface LessonReleaseLockBadgeProps {
  /** ISO timestamp the lesson unlocks, or null when the time is unknown. */
  releaseAt: string | null;
  /** Pin the "now" used for the relative hint (tests pass a fixed clock). */
  now?: Date;
  testID?: string;
}

/**
 * A coarse, friendly relative hint ("in 3 days", "soon"). Intentionally low
 * precision: the exact unlock moment is a server concern, and a coarse hint
 * avoids a misleading "in 0 minutes" countdown flicker near the boundary.
 * Returns null when no usable future time is available.
 */
export function relativeUnlockHint(
  releaseAt: string | null,
  now: Date,
): string | null {
  if (!releaseAt) return null;
  const target = Date.parse(releaseAt);
  if (Number.isNaN(target)) return null;
  const deltaMs = target - now.getTime();
  if (deltaMs <= 0) return null; // already releasable — caller shows no badge
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return 'soon';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export default function LessonReleaseLockBadge({
  releaseAt,
  now,
  testID,
}: LessonReleaseLockBadgeProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const hint = relativeUnlockHint(releaseAt, now ?? new Date());
  const label = hint ? `Unlocks ${hint}` : 'Unlocks soon';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: semanticColors.disabledBg,
          borderColor: semanticColors.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID ?? 'lesson-release-lock-badge'}
    >
      <Ionicons
        name="time-outline"
        size={14}
        color={semanticColors.textOnDisabled}
      />
      <Text
        style={[styles.label, { color: semanticColors.textOnDisabled }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 28,
  },
  label: { fontSize: 12, fontWeight: '600' },
});
