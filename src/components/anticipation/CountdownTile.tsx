/**
 * CountdownTile — UX Psych #4 "Healthy Anticipation"
 *
 * Small tile that shows a time-until countdown for upcoming events:
 *   • Next coach check-in
 *   • New plan drop
 *   • Next scheduled review
 *
 * All time math is pure (no backend) — the parent passes target date ISO strings.
 * The tile renders nothing when no valid future date is provided.
 *
 * Analytics: fires `countdown_tile_viewed` on mount with event type + days remaining.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { Colors, Spacing, Radius } from '../../theme/index';
import { track } from '../../lib/analytics';
import type { IoniconName } from '../../types/common';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CountdownEventType =
  | 'coach_checkin'
  | 'new_plan'
  | 'plan_review'
  | 'custom';

export interface CountdownTileProps {
  /** ISO 8601 date string for the target event */
  targetDate: string;
  /** Semantic type of the event */
  eventType?: CountdownEventType;
  /** Override the display label (falls back to eventType default) */
  label?: string;
  /** Called when user taps the tile */
  onPress?: () => void;
  /** Optional outer style override */
  style?: ViewStyle;
}

// ─── Label defaults per event type ────────────────────────────────────────────

const EVENT_LABELS: Record<CountdownEventType, string> = {
  coach_checkin: 'Next coach check-in',
  new_plan:      'New plan drops',
  plan_review:   'Next plan review',
  custom:        'Coming up',
};

const EVENT_ICONS: Record<CountdownEventType, string> = {
  coach_checkin: 'person-circle-outline',
  new_plan:      'calendar-outline',
  plan_review:   'clipboard-outline',
  custom:        'time-outline',
};

// ─── Time math ────────────────────────────────────────────────────────────────

interface CountdownResult {
  daysLeft:  number;
  hoursLeft: number;
  label:     string;
}

function computeCountdown(targetDateIso: string): CountdownResult | null {
  const now    = Date.now();
  const target = new Date(targetDateIso).getTime();
  const diffMs = target - now;

  if (Number.isNaN(diffMs) || diffMs <= 0) return null;

  const daysLeft  = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  let label: string;
  if (daysLeft === 0) {
    label = hoursLeft <= 1 ? 'in less than an hour' : `in ${hoursLeft} hours`;
  } else if (daysLeft === 1) {
    label = 'tomorrow';
  } else {
    // "Monday", "Tuesday", etc. when ≤6 days away; otherwise "in N days"
    const targetDate = new Date(targetDateIso);
    const dayName = daysLeft <= 6
      ? targetDate.toLocaleDateString('en-US', { weekday: 'long' })
      : `in ${daysLeft} days`;
    label = dayName;
  }

  return { daysLeft, hoursLeft, label };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CountdownTile({
  targetDate,
  eventType = 'custom',
  label,
  onPress,
  style,
}: CountdownTileProps) {
  const countdown = useMemo(() => computeCountdown(targetDate), [targetDate]);

  // Analytics — fire once on mount if countdown is valid
  useEffect(() => {
    if (countdown) {
      track('countdown_tile_viewed', {
        event_type:  eventType,
        days_left:   countdown.daysLeft,
        hours_left:  countdown.hoursLeft,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render nothing if date is invalid or already past
  if (!countdown) return null;

  const displayLabel  = label ?? EVENT_LABELS[eventType];
  const iconName      = EVENT_ICONS[eventType];

  // Urgency accent: orange if today/tomorrow, brand green otherwise
  const isUrgent      = countdown.daysLeft <= 1;
  const accentColor   = isUrgent ? Colors.orange : Colors.primary;
  const bgColor       = isUrgent ? Colors.orange + '12' : Colors.primaryPale;

  return (
    <HapticPressable
      intent="light"
      onPress={() => {
        track('countdown_tile_tapped', { event_type: eventType, days_left: countdown.daysLeft });
        onPress?.();
      }}
      style={[styles.tile, { backgroundColor: bgColor }, style]}
      accessibilityRole="button"
      accessibilityLabel={`${displayLabel} ${countdown.label}`}
      accessibilityHint="Tap for more details"
    >
      {/* Icon */}
      <View style={[styles.iconWrap, { backgroundColor: accentColor + '1A' }]}>
        <Ionicons name={iconName as IoniconName} size={18} color={accentColor} />
      </View>

      {/* Text */}
      <View style={styles.textBlock}>
        <Text style={[styles.eventLabel, { color: accentColor }]} numberOfLines={1}>
          {displayLabel}
        </Text>
        <Text style={styles.timeLabel} numberOfLines={1}>
          {countdown.label.charAt(0).toUpperCase() + countdown.label.slice(1)}
        </Text>
      </View>

      {/* Chevron */}
      <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
    </HapticPressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tile: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
    borderRadius:   Radius.md,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderWidth:    1,
    borderColor:    Colors.border,
  },
  iconWrap: {
    width:           36,
    height:          36,
    borderRadius:    18,
    justifyContent:  'center',
    alignItems:      'center',
    flexShrink:      0,
  },
  textBlock: {
    flex: 1,
    gap:  2,
  },
  eventLabel: {
    fontSize:      11,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  timeLabel: {
    fontSize:   14,
    fontWeight: '500',
    color:      Colors.dark,
  },
});
