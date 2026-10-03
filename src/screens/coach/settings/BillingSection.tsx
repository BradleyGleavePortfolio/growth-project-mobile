import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SettingsStyles } from './styles';

export function BillingSection({
  onOpenTeamProfile,
  onOpenBilling,
  colors,
  styles,
}: {
  onOpenTeamProfile: () => void;
  onOpenBilling: () => void;
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

      {/* Subscription & access */}
      <Text style={styles.sectionHeader}>Subscription</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenBilling}
          accessibilityRole="button"
          accessibilityLabel="Open billing and subscription"
        >
          <Ionicons name="card-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Billing & access</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </>
  );
}
