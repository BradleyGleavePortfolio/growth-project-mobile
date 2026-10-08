import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SettingsStyles } from './styles';

export function BillingSection({
  onOpenTeamProfile,
  colors,
  styles,
}: {
  onOpenTeamProfile: () => void;
  /** Unused: the Subscription row is hidden, coaching needs no coach plan (owner 10-06). */
  onOpenBilling?: () => void;
  colors: ThemeColors;
  styles: SettingsStyles;
}) {
  return (
    <>
      {/* Business — Stripe Connect-backed business metrics + team profile.
          Both screens render honest empty states when the backend hasn't
          provisioned the relevant endpoints. */}
      <Text style={styles.sectionHeader}>Business</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenTeamProfile}
          accessibilityRole="button"
          accessibilityLabel="Open team profile"
        >
          <Ionicons name="business-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Team / Gym profile</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        {/* C-332-12 (Opus): Money opens from the Payments section only. */}
      </View>
      {/* CF-COACH-BILLING-129: no Subscription / "Billing & access" row. Coach
          plans were removed (owner 10-06), so the row would point every coach
          at a plan that does not exist. */}
    </>
  );
}
