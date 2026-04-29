/**
 * MilestoneCabinet — Wave 3: replaced gamified cabinet with date-annotation layout.
 *
 * Reads reached milestones from useMilestones() and renders them as:
 *   DD · MM · YY   note
 *
 * Unreached milestones are not shown (clean slate until they are reached).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { useMilestones, ApiMilestone } from '../../hooks/useApi';
import { colors, typography } from '../../theme/tokens';
import { track } from '../../lib/analytics';
import MilestoneList, { formatMilestoneDate, MilestoneEntry } from '../MilestoneList';

interface MilestoneCabinetProps {
  isFoundingMember?: boolean;
}

export default function MilestoneCabinet({ isFoundingMember: _isFoundingMember }: MilestoneCabinetProps) {
  const milestonesQ = useMilestones();
  const milestones = milestonesQ.data ?? [];

  const prevReachedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const reached = milestones.filter((m: ApiMilestone) => !!m.reachedAt);
    const prev = prevReachedRef.current;
    for (const m of reached) {
      if (!prev.has(m.slug)) {
        if (prev.size > 0) {
          track('milestone_reached', { slug: m.slug, label: m.label });
        }
        prev.add(m.slug);
      }
    }
  }, [milestones]);

  const reached = milestones.filter((m: ApiMilestone) => !!m.reachedAt);

  const entries: MilestoneEntry[] = reached.map((m: ApiMilestone) => ({
    date: formatMilestoneDate(new Date(m.reachedAt!)),
    note: m.label,
  }));

  if (milestonesQ.isLoading) {
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
      <Text style={{ ...typography.eyebrow, color: colors.charcoal, marginBottom: 16 }}>
        MILESTONES
      </Text>
      <MilestoneList entries={entries} />
    </View>
  );
}
