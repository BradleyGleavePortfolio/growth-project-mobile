import React from 'react';
import { Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { CoachSettings } from './types';
import type { SettingsStyles } from './styles';

export function SettingsToggles({
  settings,
  onUpdateSetting,
  onOpenNotificationPreferences,
  colors,
  styles,
}: {
  settings: CoachSettings;
  onUpdateSetting: <K extends keyof CoachSettings>(key: K, value: CoachSettings[K]) => void;
  onOpenNotificationPreferences: () => void;
  colors: ThemeColors;
  styles: SettingsStyles;
}) {
  return (
    <>
      {/* Notifications */}
      <Text style={styles.sectionHeader}>Notifications</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="alarm-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Daily Check-in</Text>
          <Switch
            value={settings.dailyCheckin}
            onValueChange={(v) => onUpdateSetting('dailyCheckin', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="person-add-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>New Client Alerts</Text>
          <Switch
            value={settings.newClientAlerts}
            onValueChange={(v) => onUpdateSetting('newClientAlerts', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Ionicons name="stats-chart-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Weekly Summary</Text>
          <Switch
            value={settings.weeklySummary}
            onValueChange={(v) => onUpdateSetting('weeklySummary', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
        <View style={styles.divider} />
        {/* Audit P1: surface the canonical NotificationPreferences screen. */}
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenNotificationPreferences}
          accessibilityRole="button"
          accessibilityLabel="Notification preferences"
          accessibilityHint="Channel and quiet-hour controls"
        >
          <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Notification preferences</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* App Preferences */}
      <Text style={styles.sectionHeader}>App Preferences</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Ionicons name="phone-portrait-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Haptics</Text>
          <Switch
            value={settings.hapticsEnabled}
            onValueChange={(v) => onUpdateSetting('hapticsEnabled', v)}
            trackColor={{ false: colors.surfaceElevated, true: colors.primary }}
            thumbColor={colors.textOnPrimary}
          />
        </View>
      </View>
    </>
  );
}
