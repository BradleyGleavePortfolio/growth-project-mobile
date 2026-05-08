/**
 * VerifiedProgressRow — Wave 11.
 *
 * Single-line list row for a `VerifiedProgressItem`. Shows the kind icon,
 * label, optional value, the `SignoffStatusChip`, and an optional AI
 * summary tucked beneath. Used in:
 *   - Client Path Copilot (pending submissions)
 *   - Coach Brief (latest submission per client)
 *   - Coach signoff queue
 *
 * Doctrine: no flame icon (banned by quiet-luxury doctrine test). Login
 * streak uses `trending-up-outline` to stay palette-clean.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as tokens, typography } from '../../theme/tokens';
import SignoffStatusChip from './SignoffStatusChip';
import type { VerifiedProgressItem, VerifiedProgressKind } from '../../types/wave11';
import { AI_BADGES } from '../../lib/aiHonestyCopy';

interface Props {
  item: VerifiedProgressItem;
}

const ICONS: Record<VerifiedProgressKind, keyof typeof Ionicons.glyphMap> = {
  net_worth_milestone: 'trending-up-outline',
  fitness_metric: 'fitness-outline',
  coach_report: 'document-text-outline',
  admin_report: 'shield-outline',
  // Doctrine: 'flame' / 'flame-outline' are banned by quietLuxuryDoctrine.
  // Use 'repeat-outline' to represent a consistent daily streak.
  login_streak: 'repeat-outline',
  days_logged: 'calendar-outline',
  habit_consistency: 'checkmark-circle-outline',
  check_in_consistency: 'checkbox-outline',
  self_report: 'create-outline',
  milestone_review: 'ribbon-outline',
  income_proof: 'cash-outline',
  bank_proof: 'wallet-outline',
  platform_proof: 'apps-outline',
  screenshot: 'image-outline',
};

export default function VerifiedProgressRow({ item }: Props) {
  const icon = ICONS[item.kind] ?? 'document-outline';
  const hasHumanSignoff =
    !!item.signoffActor &&
    (item.signoffActor.kind === 'coach' || item.signoffActor.kind === 'admin');
  return (
    <View
      style={styles.row}
      accessibilityRole="none"
      accessibilityLabel={`${item.label}${item.value ? `, ${item.value}` : ''}`}
    >
      <View style={styles.leading}>
        <Ionicons name={icon} size={18} color={tokens.charcoal} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
          {item.value ? <Text style={styles.value}>{item.value}</Text> : null}
        </View>
        <View style={styles.metaRow}>
          <SignoffStatusChip
            status={item.signoffStatus}
            hasHumanSignoff={hasHumanSignoff}
          />
          {item.proofUrl == null && (
            <Text style={styles.metaText}>· no source on file</Text>
          )}
        </View>
        {item.aiSummary ? (
          <Text style={styles.aiSummary}>
            <Text style={styles.aiBadge}>{AI_BADGES.summary}</Text>
            {' · '}
            {item.aiSummary}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
    backgroundColor: tokens.cream,
    borderRadius: 4,
  },
  leading: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: tokens.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 6 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  label: {
    flex: 1,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 15,
    color: tokens.ink,
    fontWeight: '500',
  },
  value: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: 13,
    color: tokens.charcoal,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaText: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: 12,
    color: tokens.stone,
  },
  aiSummary: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: tokens.charcoal,
  },
  aiBadge: {
    fontWeight: '600',
    color: tokens.charcoal,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.6,
  },
});
