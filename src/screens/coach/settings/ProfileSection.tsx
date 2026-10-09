import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SettingsStyles } from './styles';
import { Overline } from '../../../ui';

export function ProfileSection({
  initials,
  firstName,
  lastName,
  email,
  bioText,
  onOpenBio,
  onOpenPassword,
  colors,
  styles,
}: {
  initials: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  bioText: string;
  onOpenBio: () => void;
  onOpenPassword: () => void;
  colors: ThemeColors;
  styles: SettingsStyles;
}) {
  return (
    <>
      {/* Coach Profile */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileRole}>Coach</Text>
          <Text style={styles.profileName} numberOfLines={2}>
            {firstName} {lastName}
          </Text>
          <Text style={styles.profileEmail}>{email}</Text>
        </View>
      </View>

      {/* Account */}
      <Overline style={styles.sectionHeader}>Account</Overline>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Name</Text>
          <Text style={styles.rowValue}>
            {firstName} {lastName}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Email</Text>
          <Text style={styles.rowValue}>{email}</Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenBio}
          accessibilityRole="button"
          accessibilityLabel="Edit bio"
        >
          <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Bio</Text>
          <Text style={styles.rowValueMuted} numberOfLines={1}>
            {bioText || 'Add a bio'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenPassword}
          accessibilityRole="button"
          accessibilityLabel="Change password"
        >
          <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Change password</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </>
  );
}
