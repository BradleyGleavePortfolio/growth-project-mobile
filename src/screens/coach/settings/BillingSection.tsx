import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SettingsStyles } from './styles';

export function BillingSection({
  onOpenTeamProfile,
  onOpenBusinessMetrics,
  onOpenPackages,
  onOpenEarnings,
  onOpenBilling,
  colors,
  styles,
}: {
  onOpenTeamProfile: () => void;
  onOpenBusinessMetrics: () => void;
  onOpenPackages: () => void;
  onOpenEarnings: () => void;
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
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenBusinessMetrics}
          accessibilityRole="button"
          accessibilityLabel="Open business metrics"
        >
          <Ionicons name="trending-up-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Revenue & metrics</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {/* Packages CRUD — backend PR #215. */}
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenPackages}
          accessibilityRole="button"
          accessibilityLabel="Open packages"
        >
          <Ionicons name="pricetags-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Packages</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {/* Earnings + payout readiness — backend PR #216. */}
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenEarnings}
          accessibilityRole="button"
          accessibilityLabel="Open earnings and payouts"
        >
          <Ionicons name="cash-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Earnings & payouts</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
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
