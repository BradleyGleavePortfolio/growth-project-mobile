/**
 * MilestoneList — Wave 3: replaces prior gamified cabinet chrome with a date-annotation list.
 *
 * Renders a date-annotation list:
 *   03 · 04 · 26   first session
 *   01 · 06 · 26   $5,000 returned
 *   14 · 09 · 26   Day 90 — milestone met
 *
 * Date format: DD · MM · YY (non-breaking spaces around ·)
 */

import React from 'react';
import { View, Text } from 'react-native';
import { colors, typography } from '../theme/tokens';

export interface MilestoneEntry {
  date: string;  // DD · MM · YY format — or pass a Date and we'll format it
  note: string;
}

/** Format a JS Date → DD\u00a0·\u00a0MM\u00a0·\u00a0YY */
export function formatMilestoneDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}\u00a0·\u00a0${mm}\u00a0·\u00a0${yy}`;
}

interface MilestoneListProps {
  entries: MilestoneEntry[];
}

export default function MilestoneList({ entries }: MilestoneListProps) {
  return (
    <View>
      {entries.map((e, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            paddingVertical: 16,
            borderTopWidth: i === 0 ? 0 : 0.5,
            borderColor: colors.stone,
          }}
        >
          <Text style={{ ...typography.eyebrow, color: colors.charcoal, width: 100 }}>
            {e.date}
          </Text>
          <Text style={{ ...typography.body, color: colors.ink, flex: 1 }}>
            {e.note}
          </Text>
        </View>
      ))}
    </View>
  );
}
