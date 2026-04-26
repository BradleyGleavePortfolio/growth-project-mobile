/**
 * BadgeCabinet — Wave 1: Neutralized for luxury repositioning.
 *
 * Emoji icons and decorative gamification chrome removed.
 * Rendered as a plain earned-date list with text labels.
 * Full redesign as a date-annotation list lands in Wave 3.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useBadges, ApiBadge } from '../../hooks/useApi';
import { Colors } from '../../constants/colors';
import { track } from '../../lib/analytics';

// ─── Single badge row ─────────────────────────────────────────────────────────
function BadgeRow({ badge }: { badge: ApiBadge }) {
  const earned = !!badge.awardedAt;

  return (
    <View style={[styles.badgeRow, !earned && styles.badgeRowLocked]}>
      <Text style={[styles.badgeLabel, !earned && styles.badgeLabelLocked]} numberOfLines={1}>
        {badge.label}
      </Text>

      {earned ? (
        <Text style={styles.badgeDate}>
          {new Date(badge.awardedAt!).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          })}
        </Text>
      ) : (
        <Text style={styles.badgePending}>pending</Text>
      )}
    </View>
  );
}

// ─── Cabinet ──────────────────────────────────────────────────────────────────
interface BadgeCabinetProps {
  isFoundingMember?: boolean;
}

export default function BadgeCabinet({ isFoundingMember }: BadgeCabinetProps) {
  const badgesQ = useBadges();
  const badges = badgesQ.data ?? [];

  // Analytics: badge_unlocked
  const prevEarnedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const earned = badges.filter((b) => !!b.awardedAt);
    const prev = prevEarnedRef.current;
    for (const b of earned) {
      if (!prev.has(b.slug)) {
        if (prev.size > 0) {
          track('badge_unlocked', { slug: b.slug, label: b.label });
        }
        prev.add(b.slug);
      }
    }
  }, [badges]);

  const earned = badges.filter((b) => !!b.awardedAt);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={[styles.headerText, isFoundingMember && styles.headerTextFounding]}>
          Milestones
        </Text>
        {earned.length > 0 && (
          <Text style={styles.earnedCount}>
            {earned.length} of {badges.length}
          </Text>
        )}
      </View>

      {/* List */}
      {badgesQ.isLoading ? (
        <Text style={styles.loadingText}>Loading…</Text>
      ) : badges.length === 0 ? (
        <Text style={styles.emptyText}>Keep training — milestones will appear here.</Text>
      ) : (
        <View style={styles.list}>
          {badges.map((badge) => (
            <BadgeRow key={badge.slug} badge={badge} />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerTextFounding: {
    color: '#9A6F1A',
  },
  earnedCount: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingVertical: 16,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingVertical: 16,
  },
  list: {
    gap: 0,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  badgeRowLocked: {
    opacity: 0.4,
  },
  badgeLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textPrimary,
  },
  badgeLabelLocked: {
    color: Colors.textMuted,
  },
  badgeDate: {
    fontSize: 12,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  badgePending: {
    fontSize: 11,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});
