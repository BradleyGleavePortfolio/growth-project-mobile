/**
 * BadgeCabinet — Wave 3: replaced with MilestoneList date-annotation layout.
 *
 * Reads earned badges from useBadges() and renders them as:
 *   DD · MM · YY   badge label
 *
 * Unearned badges are not shown (clean slate until milestones are met).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { useBadges, ApiBadge } from '../../hooks/useApi';
import { colors, typography } from '../../theme/tokens';
import { track } from '../../lib/analytics';
import MilestoneList, { formatMilestoneDate, MilestoneEntry } from '../MilestoneList';

// ─── Cabinet ──────────────────────────────────────────────────────────────────
interface BadgeCabinetProps {
  isFoundingMember?: boolean;
}

export default function BadgeCabinet({ isFoundingMember: _isFoundingMember }: BadgeCabinetProps) {
  const badgesQ = useBadges();
  const badges = badgesQ.data ?? [];

  // Analytics: badge_unlocked
  const prevEarnedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const earned = badges.filter((b: ApiBadge) => !!b.awardedAt);
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

  const earned = badges.filter((b: ApiBadge) => !!b.awardedAt);

  // Convert earned badges → MilestoneEntry format
  const entries: MilestoneEntry[] = earned.map((b: ApiBadge) => ({
    date: formatMilestoneDate(new Date(b.awardedAt!)),
    note: b.label,
  }));

  if (badgesQ.isLoading) {
    return (
      <Text style={{ ...typography.body, color: colors.stone, paddingVertical: 16 }}>
        Loading…
      </Text>
    );
  }

  if (entries.length === 0) {
    return (
      <Text style={{ ...typography.body, color: colors.stone, paddingVertical: 16 }}>
        Keep training — milestones will appear here.
      </Text>
    );
  }

  return (
    <View>
      {/* Section label */}
      <Text style={{ ...typography.eyebrow, color: colors.charcoal, marginBottom: 16 }}>
        MILESTONES
      </Text>
      <MilestoneList entries={entries} />
    </View>
  );
}
