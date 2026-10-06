// Phase 9 — NotificationPreferencesScreen.
//
// Lets the user control:
//   - Per-kind, per-channel toggles (email / push / in-app) for the kinds
//     the backend has a switch for (KIND_PREFS_PREFIX)
//   - Mute-all toggle (overrides everything)
// and states the quiet hours (B-NOTIF-6): one fixed window, 9:00 PM to
// 8:00 AM in the user's own zone, applied by the backend to everyone, so
// there is nothing to set and nothing is sent for it.
//
// All toggles have a label and a 1-sentence explanation of what they control.
// Preferences are saved on change: each toggle PATCHes only what changed.
// B-341-1: one save at a time; the switches wait while it is in flight, so a
// reply or a rollback never overwrites a later change.
// B-341-2: a failed save says what happened by status (offline, signed out,
// busy, server with a reference and the support address), the same rules as
// Settings > Notifications (notificationPreferenceErrors.ts).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  KIND_PREFS_PREFIX,
  fetchNotificationPreferences,
  saveNotificationPreferences,
} from '../../services/notificationsApi';
import { preferenceSaveFailureOf } from '../settings/notificationPreferenceErrors';
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

// ─── Main screen ──────────────────────────────────────────────────────────────

// Only kinds with a backend switch are offered; a toggle for any other kind
// would not change what is delivered.
const ORDERED_KINDS: NotificationKind[] = (
  ['coach', 'message', 'build_week', 'milestone', 'check_in', 'reminder', 'tip', 'system'] as NotificationKind[]
).filter((kind) => KIND_PREFS_PREFIX[kind] !== undefined);

export const QUIET_HOURS_COPY = {
  label: 'Quiet hours, 9:00 PM to 8:00 AM',
  description:
    'Your time. Notifications that arrive overnight wait until 8:00 AM. A reminder for a session that starts within the hour still comes through.',
};

export const MUTE_ALL_COPY =
  'Turns off all push, in-app and email notifications, session reminders included.';

const CHANNELS: NotificationChannel[] = ['push', 'in_app', 'email'];

export default function NotificationPreferencesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  // B-341-1: set synchronously, so a second tap before the re-render is ignored.
  const savingRef = useRef(false);

  useEffect(() => {
    let live = true;
    fetchNotificationPreferences()
      .then((loaded) => {
        if (live) setPrefs(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setIsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // `next` is shown at once; only `patch` (what changed) is sent. One save at
  // a time (B-341-1): `previous` is then the only other state there is.
  const save = useCallback(
    async (next: NotificationPreferences, patch: Partial<NotificationPreferences>, noun: string) => {
      if (savingRef.current) return;
      savingRef.current = true;
      const previous = prefs;
      setPrefs(next);
      setIsSaving(true);
      setSaveFailure(null);
      try {
        const saved = await saveNotificationPreferences(patch);
        setPrefs(saved);
      } catch (err: unknown) {
        // Put the switch back and say what happened and what to do next.
        setPrefs(previous);
        const failure = preferenceSaveFailureOf(err, noun);
        setSaveFailure(failure.message);
        // B-341-2: with no answer, or an unexpected one, the change may still
        // have reached the server: show what the server has.
        if (failure.kind === 'offline' || failure.kind === 'server') {
          try {
            setPrefs(await fetchNotificationPreferences());
          } catch {
            // Still unreachable: the restored switch and the notice stand.
          }
        }
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [prefs],
  );

  const setMuteAll = useCallback((value: boolean) => {
    if (!prefs) return;
    save({ ...prefs, muteAll: value }, { muteAll: value }, 'mute all');
  }, [prefs, save]);

  const setKindChannel = useCallback(
    (kind: NotificationKind, channel: NotificationChannel, value: boolean) => {
      if (!prefs) return;
      const kindChannels = { ...prefs.channels[kind], [channel]: value };
      save(
        { ...prefs, channels: { ...prefs.channels, [kind]: kindChannels } },
        { channels: { [kind]: { [channel]: value } } as NotificationPreferences['channels'] },
        `${KIND_COPY[kind].label.toLowerCase()} ${CHANNEL_LABELS[channel].toLowerCase()}`,
      );
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
          description={MUTE_ALL_COPY}
          value={prefs.muteAll}
          disabled={isSaving}
          onValueChange={setMuteAll}
          accessibilityLabel="Mute all notifications"
        />

        {saveFailure ? (
          <Text
            selectable
            testID="notification-prefs-save-failed"
            accessibilityLiveRegion="polite"
            style={[styles.notice, { color: colors.textSecondary }]}
          >
            {saveFailure}
          </Text>
        ) : null}

        {/* Quiet hours: fixed, stated, never sent (B-NOTIF-6). */}
        <SectionHeader title="Quiet hours" />
        <View
          testID="quiet-hours-fixed"
          accessible
          accessibilityLabel={`${QUIET_HOURS_COPY.label}. ${QUIET_HOURS_COPY.description}`}
          style={[styles.quietRow, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.kindLabel, { color: colors.textPrimary }]}>{QUIET_HOURS_COPY.label}</Text>
          <Text style={[styles.kindDescription, { color: colors.textSecondary }]}>
            {QUIET_HOURS_COPY.description}
          </Text>
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
                      // Mute all stops every channel, email too (backend
                      // gate: muted blocks all of them).
                      disabled={prefs.muteAll || isSaving}
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
    quietRow: {
      marginHorizontal: 16,
      borderRadius: 4,
      padding: 14,
      gap: 4,
    },
    notice: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: 20,
      marginTop: 16,
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
