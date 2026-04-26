/**
 * BadgeCabinet — Contribution Loops (UX Psych #5)
 *
 * Displays a 2-column grid of earned and locked badges on ProfileScreen.
 * Earned badges show full colour and awardedAt date.
 * Locked badges render in greyscale with the unlock criterion as subtitle.
 * Founding members get a gold ring around the header.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBadges, ApiBadge } from '../../hooks/useApi';
import { Colors } from '../../constants/colors';
import { track } from '../../lib/analytics';

// ─── Badge metadata (icon + colour) ──────────────────────────────────────────
const BADGE_VISUAL: Record<string, { icon: string; color: string }> = {
  first_win: { icon: 'star', color: '#F4A261' },
  encourager: { icon: 'heart', color: '#E63946' },
  inner_circle_builder: { icon: 'people', color: Colors.primary },
  consistency_hero: { icon: 'flame', color: '#F77F00' },
};

// ─── Single badge cell ────────────────────────────────────────────────────────
function BadgeCell({ badge }: { badge: ApiBadge }) {
  const earned = !!badge.awardedAt;
  const visual = BADGE_VISUAL[badge.slug] ?? { icon: 'ribbon', color: Colors.textMuted };

  return (
    <View style={[styles.badgeCell, !earned && styles.badgeCellLocked]}>
      {/* Icon */}
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: earned ? `${visual.color}22` : Colors.background },
        ]}
      >
        <Ionicons
          name={visual.icon as any}
          size={28}
          color={earned ? visual.color : Colors.textMuted}
        />
      </View>

      {/* Label */}
      <Text style={[styles.badgeLabel, !earned && styles.badgeLabelLocked]} numberOfLines={2}>
        {badge.label}
      </Text>

      {/* Sub-line: earned date OR unlock criterion */}
      {earned ? (
        <Text style={styles.badgeEarned}>
          {new Date(badge.awardedAt!).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </Text>
      ) : (
        <Text style={styles.badgeCriterion} numberOfLines={2}>
          {badge.description}
        </Text>
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

  // Analytics: badge_unlocked — fires when a badge is newly earned vs. prior cache
  const prevEarnedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const earned = badges.filter((b) => !!b.awardedAt);
    const prev = prevEarnedRef.current;
    for (const b of earned) {
      if (!prev.has(b.slug)) {
        if (prev.size > 0) {
          // Only fire badge_unlocked when we previously had data (not first load)
          track('badge_unlocked', { slug: b.slug, label: b.label });
        }
        prev.add(b.slug);
      }
    }
  }, [badges]);
  const earned = badges.filter((b) => !!b.awardedAt);

  return (
    <View style={styles.container}>
      {/* Header — gold ring for founding members */}
      <View style={[styles.headerRow, isFoundingMember && styles.headerRowFounding]}>
        <Ionicons
          name="ribbon"
          size={18}
          color={isFoundingMember ? '#C4922A' : Colors.primary}
        />
        <Text style={[styles.headerText, isFoundingMember && styles.headerTextFounding]}>
          Your Badges
        </Text>
        {earned.length > 0 ? (
          <View style={styles.earnedPill}>
            <Text style={styles.earnedPillText}>
              {earned.length} / {badges.length}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Grid */}
      {badgesQ.isLoading ? (
        <View style={styles.loadingRow}>
          <Text style={styles.loadingText}>Loading badges…</Text>
        </View>
      ) : badges.length === 0 ? (
        <Text style={styles.emptyText}>Keep training — badges will appear here.</Text>
      ) : (
        <View style={styles.grid}>
          {badges.map((badge) => (
            <BadgeCell key={badge.slug} badge={badge} />
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
    marginHorizontal: 0,
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
  headerRowFounding: {
    borderBottomColor: '#C4922A',
  },
  headerText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerTextFounding: {
    color: '#9A6F1A',
  },
  earnedPill: {
    backgroundColor: Colors.primaryPale,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  earnedPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  loadingRow: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingVertical: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  badgeCell: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeCellLocked: {
    opacity: 0.55,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  badgeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  badgeLabelLocked: {
    color: Colors.textMuted,
  },
  badgeEarned: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
  },
  badgeCriterion: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 13,
  },
});
