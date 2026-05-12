// Phase 9 — NotificationPreferencesScreen.
//
// Lets the user control:
//   - Per-kind, per-channel toggles (email / push / in-app)
//   - Mute-all toggle (overrides everything)
//   - Quiet hours (24-hour time pickers, theme-tokened)
//
// All toggles have a label and a 1-sentence explanation of what they control.
// Preferences are saved on change (each toggle fires a PATCH immediately).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Switch,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import {
  NotificationPreferences,
  NotificationKind,
  NotificationChannel,
  fetchNotificationPreferences,
  saveNotificationPreferences,
} from '../../services/notificationsApi';
import type { IoniconName } from '../../types/common';

// ─── Copy table ───────────────────────────────────────────────────────────────
// Every toggle must have a label and a 1-sentence explanation.

const KIND_COPY: Record<NotificationKind, { label: string; description: string }> = {
  coach: {
    label: 'Coach messages',
    description: 'Sent when your coach writes a note, approves a task, or posts a check-in reply.',
  },
  milestone: {
    label: 'Milestones',
    description: 'Sent when you reach a streak or programme marker that your coach has set.',
  },
  check_in: {
    label: 'Check-in reminders',
    description: 'Reminds you to submit your daily check-in if it has not been logged by midday.',
  },
  message: {
    label: 'Direct messages',
    description: 'Sent when a new direct message arrives in your coaching inbox.',
  },
  build_week: {
    label: 'Build week gates',
    description: 'Notifies you when a coach approves a gated day and the next day unlocks.',
  },
  system: {
    label: 'Platform updates',
    description: 'Sent for account changes, terms updates, and service announcements.',
  },
  reminder: {
    label: 'Habit reminders',
    description: 'Sent when a tracked habit (weight, water, meal log) has not been recorded.',
  },
  tip: {
    label: 'Coaching tips',
    description: 'Periodic short-form guidance from the platform based on your current programme.',
  },
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email:  'Email',
  push:   'Push',
  in_app: 'In-app',
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

/** Returns the 24-hour minutes since midnight for a "HH:MM" string. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Converts minutes since midnight to "HH:MM". */
function minutesToTime(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Cycles through 30-minute increments. */
function adjustTime(time: string, direction: 'up' | 'down'): string {
  const mins = timeToMinutes(time);
  const step = 30;
  const next = direction === 'up' ? mins + step : mins - step;
  return minutesToTime(((next % 1440) + 1440) % 1440);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontFamily: 'Inter_500Medium',
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.98,
        textTransform: 'uppercase',
        color: colors.textMuted,
        marginBottom: 8,
        marginTop: 24,
        paddingHorizontal: 20,
      }}
      accessibilityRole="header"
    >
      {title}
    </Text>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel: string;
}

function ToggleRow({ label, description, value, disabled, onValueChange, accessibilityLabel }: ToggleRowProps) {
  const { colors } = useTheme();
  return (
    <View style={[rowStyles.row, { backgroundColor: colors.surface }]}>
      <View style={rowStyles.text}>
        <Text style={[rowStyles.label, { color: colors.textPrimary }]}>{label}</Text>
        <Text style={[rowStyles.description, { color: colors.textSecondary }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="switch"
        trackColor={{ false: colors.textMuted, true: colors.primary }}
        thumbColor={Platform.OS === 'android' ? (value ? colors.textOnPrimary : colors.background) : undefined}
      />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 4,
    marginBottom: 2,
    gap: 12,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
});

interface TimePickerRowProps {
  label: string;
  value: string;
  onAdjust: (direction: 'up' | 'down') => void;
  disabled?: boolean;
}

function TimePickerRow({ label, value, onAdjust, disabled }: TimePickerRowProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        timeStyles.row,
        { backgroundColor: colors.surface, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={[timeStyles.label, { color: colors.textPrimary }]}>{label}</Text>
      <View style={timeStyles.controls}>
        <TouchableOpacity
          onPress={() => onAdjust('down')}
          disabled={disabled}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
        >
          <Ionicons
            name={'remove-circle-outline' as IoniconName}
            size={22}
            color={disabled ? colors.textMuted : colors.primary}
          />
        </TouchableOpacity>
        <Text
          style={[timeStyles.value, { color: colors.textPrimary }]}
          accessibilityLabel={`${label} set to ${value}`}
        >
          {value}
        </Text>
        <TouchableOpacity
          onPress={() => onAdjust('up')}
          disabled={disabled}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
        >
          <Ionicons
            name={'add-circle-outline' as IoniconName}
            size={22}
            color={disabled ? colors.textMuted : colors.primary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const timeStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 4,
    marginBottom: 2,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  value: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    minWidth: 52,
    textAlign: 'center',
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

const ORDERED_KINDS: NotificationKind[] = [
  'coach',
  'message',
  'build_week',
  'milestone',
  'check_in',
  'reminder',
  'tip',
  'system',
];

const CHANNELS: NotificationChannel[] = ['push', 'in_app', 'email'];

export default function NotificationPreferencesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchNotificationPreferences()
      .then(setPrefs)
      .finally(() => setIsLoading(false));
  }, []);

  const save = useCallback(async (updated: NotificationPreferences) => {
    setPrefs(updated);
    setIsSaving(true);
    try {
      const saved = await saveNotificationPreferences(updated);
      setPrefs(saved);
    } catch {
      // Restore previous state on failure.
      setPrefs(prefs);
    } finally {
      setIsSaving(false);
    }
  }, [prefs]);

  const setMuteAll = useCallback((value: boolean) => {
    if (!prefs) return;
    save({ ...prefs, muteAll: value });
  }, [prefs, save]);

  const setKindChannel = useCallback(
    (kind: NotificationKind, channel: NotificationChannel, value: boolean) => {
      if (!prefs) return;
      save({
        ...prefs,
        channels: {
          ...prefs.channels,
          [kind]: { ...prefs.channels[kind], [channel]: value },
        },
      });
    },
    [prefs, save],
  );

  const setQuietHoursEnabled = useCallback((value: boolean) => {
    if (!prefs) return;
    save({ ...prefs, quietHours: { ...prefs.quietHours, enabled: value } });
  }, [prefs, save]);

  const adjustQuietTime = useCallback(
    (field: 'startTime' | 'endTime', direction: 'up' | 'down') => {
      if (!prefs) return;
      const newTime = adjustTime(prefs.quietHours[field], direction);
      save({ ...prefs, quietHours: { ...prefs.quietHours, [field]: newTime } });
    },
    [prefs, save],
  );

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading preferences" />
      </View>
    );
  }

  if (!prefs) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name={'arrow-back-outline' as IoniconName} size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Notification settings</Text>
        {isSaving ? (
          <ActivityIndicator color={colors.primary} size="small" accessibilityLabel="Saving" />
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Mute all */}
        <SectionHeader title="Global" />
        <ToggleRow
          label="Mute all notifications"
          description="Suppresses all push and in-app notifications. Email notifications continue unless turned off individually."
          value={prefs.muteAll}
          onValueChange={setMuteAll}
          accessibilityLabel="Mute all notifications"
        />

        {/* Quiet hours */}
        <SectionHeader title="Quiet hours" />
        <View style={{ marginHorizontal: 16 }}>
          <ToggleRow
            label="Enable quiet hours"
            description="Suppresses push notifications between the start and end times you set below."
            value={prefs.quietHours.enabled}
            onValueChange={setQuietHoursEnabled}
            accessibilityLabel="Enable quiet hours"
          />
          <TimePickerRow
            label="Start time"
            value={prefs.quietHours.startTime}
            onAdjust={(dir) => adjustQuietTime('startTime', dir)}
            disabled={!prefs.quietHours.enabled}
          />
          <TimePickerRow
            label="End time"
            value={prefs.quietHours.endTime}
            onAdjust={(dir) => adjustQuietTime('endTime', dir)}
            disabled={!prefs.quietHours.enabled}
          />
        </View>

        {/* Per-kind, per-channel toggles */}
        <SectionHeader title="Notification types" />
        <Text style={[styles.channelHeader, { color: colors.textMuted }]}>
          Push — In-app — Email
        </Text>

        {ORDERED_KINDS.map((kind) => {
          const { label, description } = KIND_COPY[kind];
          return (
            <View
              key={kind}
              style={[styles.kindBlock, { backgroundColor: colors.surface }]}
            >
              <View style={styles.kindHeader}>
                <Text style={[styles.kindLabel, { color: colors.textPrimary }]}>{label}</Text>
                <Text style={[styles.kindDescription, { color: colors.textSecondary }]}>
                  {description}
                </Text>
              </View>
              <View style={styles.channelToggles}>
                {CHANNELS.map((channel) => (
                  <View key={channel} style={styles.channelToggle}>
                    <Text style={[styles.channelLabel, { color: colors.textMuted }]}>
                      {CHANNEL_LABELS[channel]}
                    </Text>
                    <Switch
                      value={prefs.channels[kind][channel]}
                      onValueChange={(v) => setKindChannel(kind, channel, v)}
                      disabled={prefs.muteAll && channel !== 'email'}
                      accessibilityLabel={`${label} via ${CHANNEL_LABELS[channel]}`}
                      accessibilityRole="switch"
                      trackColor={{ false: colors.textMuted, true: colors.primary }}
                      thumbColor={Platform.OS === 'android'
                        ? (prefs.channels[kind][channel] ? colors.textOnPrimary : colors.background)
                        : undefined}
                    />
                  </View>
                ))}
              </View>
            </View>
          );
        })}

        <View style={styles.footerSpacer} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 56,
      paddingBottom: 12,
    },
    title: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 24,
      lineHeight: 29,
      color: colors.textPrimary,
      letterSpacing: 0.5,
    },
    headerSpacer: {
      width: 24,
    },
    scrollContent: {
      paddingBottom: 48,
    },
    channelHeader: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 16,
      paddingHorizontal: 20,
      marginBottom: 6,
    },
    kindBlock: {
      marginHorizontal: 16,
      marginBottom: 2,
      borderRadius: 4,
      padding: 14,
    },
    kindHeader: {
      marginBottom: 12,
      gap: 4,
    },
    kindLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      lineHeight: 20,
    },
    kindDescription: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
    },
    channelToggles: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(176,141,87,0.2)', // tokens.colors.divider equivalent
    },
    channelToggle: {
      alignItems: 'center',
      gap: 6,
    },
    channelLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      lineHeight: 13,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    footerSpacer: {
      height: 32,
    },
  });
