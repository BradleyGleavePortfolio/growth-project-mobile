/**
 * EventCard — a single community EVENT row in a feed (v2-3). Mirrors PostCard:
 * a >= 48dp HapticPressable on semanticColors / tokens.ts, an Ionicons line
 * icon, a state badge, the start time, and a compact RSVP summary. Tapping
 * routes into the event detail.
 *
 * NO NATIVE LIVE ROOM (Step 0): the card never offers a "join room" affordance.
 * The live/replay link is an external URL surfaced only on the detail screen.
 *
 * Optimistic (provisional) events render with a subtle "saving" treatment until
 * the server reconciles.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha } from '../../theme/tokens';
import { isOptimisticEventId } from '../../hooks/useCommunityEvents';
import type {
  CommunityEvent,
  CommunityEventState,
} from '../../api/communityEventsApi';

export interface EventCardProps {
  event: CommunityEvent;
  onPress: (event: CommunityEvent) => void;
  /** Override "now" for deterministic rendering in tests. */
  nowMs?: number;
  testID?: string;
}

/** Line-icon glyph + human, status-honest label for each lifecycle state. */
export interface EventStateMeta {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/**
 * Lifecycle copy is STATUS-HONEST (UX): "Live now" / "Replay available" /
 * "Recap posted" tell the member what they can actually do right now, not a
 * bare noun. These labels are shared across the card badge, the client detail
 * badge, and the coach manage surface so the vocabulary never diverges.
 */
const STATE_META: Record<CommunityEventState, EventStateMeta> = {
  scheduled: { label: 'Scheduled', icon: 'calendar-outline' },
  tomorrow: { label: 'Tomorrow', icon: 'time-outline' },
  live: { label: 'Live now', icon: 'radio-outline' },
  replay: { label: 'Replay available', icon: 'play-circle-outline' },
  reflected: { label: 'Recap posted', icon: 'document-text-outline' },
};

/**
 * Resolve the badge label + icon for an event state, with a CALM fallback for
 * any value not in the known set. A backend that adds a sixth state, or a
 * malformed/hostile payload that slips a bogus state past the type system,
 * must never crash a `meta.label` / `meta.icon` dereference — it degrades to a
 * neutral "Event" + calendar glyph. (F5: unknown-state safety.)
 */
export function stateMeta(state: CommunityEventState | string): EventStateMeta {
  return (
    STATE_META[state as CommunityEventState] ?? {
      label: 'Event',
      icon: 'calendar-outline',
    }
  );
}

/**
 * Format an ISO start time as a compact, locale-aware "Mon 14 · 6:00 PM" label.
 * Pure (epoch-based) and degrades to a calm dash on an unparseable input rather
 * than printing "Invalid Date".
 */
export function formatEventStart(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}

/** Compact RSVP summary, e.g. "12 going · 3 maybe". Empty string when none. */
export function rsvpSummary(event: CommunityEvent): string {
  const parts: string[] = [];
  if (event.rsvp_counts.going > 0) {
    parts.push(`${event.rsvp_counts.going} going`);
  }
  if (event.rsvp_counts.maybe > 0) {
    parts.push(`${event.rsvp_counts.maybe} maybe`);
  }
  return parts.join(' · ');
}

export default function EventCard({
  event,
  onPress,
  testID,
}: EventCardProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const saving = isOptimisticEventId(event.id);
  const meta = stateMeta(event.state);
  const start = formatEventStart(event.starts_at);
  const summary = rsvpSummary(event);
  const accessibilityLabel = `Open event ${event.title}, ${meta.label}, starts ${start}`;

  return (
    // The outer wrapper carries `listitem` semantics so assistive tech receives
    // the list structure, while the inner press target keeps `button`. RN types
    // the W3C `role` prop (not `accessibilityRole`) for list/listitem.
    <View role="listitem">
    <HapticPressable
      intent="light"
      onPress={() => onPress(event)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      disabled={saving}
      style={[
        styles.card,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
          opacity: saving ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.badge,
            { backgroundColor: withAlpha(semanticColors.accent, 0.12) },
          ]}
        >
          <Ionicons
            name={meta.icon}
            size={13}
            color={semanticColors.accent}
            style={styles.badgeIcon}
          />
          <Text style={[styles.badgeLabel, { color: semanticColors.accent }]}>
            {event.canceled ? 'Canceled' : meta.label}
          </Text>
        </View>
        <Text
          style={[styles.start, { color: semanticColors.textMuted }]}
          numberOfLines={1}
        >
          {start}
        </Text>
      </View>

      <Text
        style={[styles.title, { color: semanticColors.textPrimary }]}
        numberOfLines={2}
      >
        {event.title}
      </Text>

      <Text style={[styles.summary, { color: semanticColors.textMuted }]}>
        {saving
          ? 'Saving…'
          : summary.length > 0
            ? summary
            : 'No RSVPs yet'}
      </Text>
    </HapticPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 48,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  badgeIcon: {
    marginRight: 0,
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  start: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  summary: {
    fontSize: 13,
  },
});
