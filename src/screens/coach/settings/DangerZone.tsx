import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AccountStatus } from '../../../services/api';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SettingsStyles } from './styles';

export function DangerZone({
  accountStatus,
  accountStatusLoading,
  deletionBusy,
  permanentDate,
  onOpenTrustCenter,
  onOpenDataExport,
  onOpenDeleteAccount,
  onCancelDeletion,
  onSignOut,
  colors,
  styles,
}: {
  accountStatus: AccountStatus | null;
  accountStatusLoading: boolean;
  deletionBusy: boolean;
  permanentDate: string | null;
  onOpenTrustCenter: () => void;
  onOpenDataExport: () => void;
  onOpenDeleteAccount: () => void;
  onCancelDeletion: () => void;
  onSignOut: () => void;
  colors: ThemeColors;
  styles: SettingsStyles;
}) {
  return (
    <>
      {/* Privacy & data */}
      <Text style={styles.sectionHeader}>Privacy & Data</Text>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenTrustCenter}
          accessibilityRole="button"
          accessibilityLabel="Open trust and privacy center"
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Trust & Privacy</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {/* Phase 10 — GDPR Article 20 data portability */}
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenDataExport}
          accessibilityRole="button"
          accessibilityLabel="Request my data export"
          accessibilityHint="Download a complete copy of all your personal data"
        >
          <Ionicons name="download-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>My data</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        {accountStatusLoading ? (
          <View style={styles.row}>
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>Account deletion</Text>
            <Text style={styles.rowValueMuted}>Checking…</Text>
          </View>
        ) : accountStatus?.deletionScheduled ? (
          <TouchableOpacity
            style={styles.row}
            onPress={onCancelDeletion}
            disabled={deletionBusy}
            accessibilityRole="button"
            accessibilityLabel="Cancel scheduled deletion"
          >
            <Ionicons name="time-outline" size={20} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.warning }]}>
                Deletion scheduled
              </Text>
              {permanentDate ? (
                <Text style={styles.rowSubLabel}>
                  Permanent on {permanentDate} — tap to cancel
                </Text>
              ) : (
                <Text style={styles.rowSubLabel}>Tap to cancel deletion</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.row}
            onPress={onOpenDeleteAccount}
            disabled={deletionBusy}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityHint="Opens the account deletion screen with a 14-day grace period"
          >
            <Ionicons name="trash-outline" size={20} color={colors.error} />
            <Text style={[styles.rowLabel, { color: colors.error }]}>Delete my account</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Sign Out */}
      <TouchableOpacity
        style={styles.signOutButton}
        onPress={onSignOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </>
  );
}
