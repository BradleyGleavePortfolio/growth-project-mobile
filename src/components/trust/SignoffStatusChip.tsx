/**
 * SignoffStatusChip — Wave 11.
 *
 * Renders the lifecycle status of a verified-progress claim using the
 * `SignoffStatus` enum. The chip never claims approval if the underlying
 * `signoffActor` is missing — the parent must pass `hasHumanSignoff` so the
 * chip can refuse to show the "approved" treatment for malformed payloads.
 *
 * Doctrine: only a human coach or admin can produce an approval chip.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as tokens, semantic, typography } from '../../theme/tokens';
import type { SignoffStatus } from '../../types/wave11';

interface SignoffStatusChipProps {
  status: SignoffStatus;
  /** Set true when a human signoff actor (coach/admin) is present on the
   *  underlying record. The chip downgrades to `pending` when an
   *  "approved" status arrives with no actor — defensive against payload
   *  drift or a future bug that omits the actor. */
  hasHumanSignoff?: boolean;
}

interface ChipStyle {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  bg: string;
  fg: string;
  border: string;
}

function styleFor(status: SignoffStatus, hasHumanSignoff?: boolean): ChipStyle {
  // Refuse to render "approved" treatments without a human actor.
  if (
    !hasHumanSignoff &&
    (status === 'coach_approved' || status === 'admin_reviewed')
  ) {
    return {
      label: 'Pending review',
      icon: 'time-outline',
      bg: semantic.info.bg,
      fg: semantic.info.fg,
      border: semantic.info.border,
    };
  }

  switch (status) {
    case 'pending':
      return {
        label: 'Pending review',
        icon: 'time-outline',
        bg: semantic.info.bg,
        fg: semantic.info.fg,
        border: semantic.info.border,
      };
    case 'coach_approved':
      return {
        label: 'Coach-approved',
        icon: 'checkmark-circle-outline',
        bg: semantic.success.bg,
        fg: semantic.success.fg,
        border: semantic.success.border,
      };
    case 'admin_reviewed':
      return {
        label: 'Admin-reviewed',
        icon: 'shield-checkmark-outline',
        bg: semantic.success.bg,
        fg: semantic.success.fg,
        border: semantic.success.border,
      };
    case 'disputed':
      return {
        label: 'Disputed',
        icon: 'alert-circle-outline',
        bg: semantic.warning.bg,
        fg: semantic.warning.fg,
        border: semantic.warning.border,
      };
    case 'flagged':
      return {
        label: 'Flagged',
        icon: 'flag-outline',
        bg: semantic.danger.bg,
        fg: semantic.danger.fg,
        border: semantic.danger.border,
      };
    case 'source_missing':
      return {
        label: 'Source missing',
        icon: 'link-outline',
        bg: semantic.warning.bg,
        fg: semantic.warning.fg,
        border: semantic.warning.border,
      };
    case 'source_stale':
      return {
        label: 'Source stale',
        icon: 'refresh-outline',
        bg: semantic.warning.bg,
        fg: semantic.warning.fg,
        border: semantic.warning.border,
      };
    default: {
      // Exhaustiveness guard. New enum members fall through to a neutral chip.
      const _exhaust: never = status;
      void _exhaust;
      return {
        label: 'Unknown',
        icon: 'help-circle-outline',
        bg: tokens.cream,
        fg: tokens.charcoal,
        border: tokens.stone,
      };
    }
  }
}

export default function SignoffStatusChip({
  status,
  hasHumanSignoff,
}: SignoffStatusChipProps) {
  const s = styleFor(status, hasHumanSignoff);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Status: ${s.label}`}
      style={[styles.chip, { backgroundColor: s.bg, borderColor: s.border }]}
    >
      <Ionicons name={s.icon} size={14} color={s.fg} />
      <Text style={[styles.label, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
  },
  label: {
    fontFamily: typography.body.fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
});
