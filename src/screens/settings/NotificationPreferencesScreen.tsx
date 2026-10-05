/**
 * NotificationPreferencesScreen — per-category push notification controls.
 *
 * Phase 11 / Push Notification Taxonomy.
 *
 * Exposes four per-category toggles matching the push-channels taxonomy:
 *   - Coach Messages  (coach_direct)  — direct messages from the assigned coach
 *   - Reminders       (client_bot)    — meal, water, check-in nudges
 *   - Milestones      (milestones)    — streak and PR celebrations
 *   - System          (system)        — billing and app updates
 *   - Workout reminders (workout_reminders) — C05 item 7: a note from Roman at
 *     the client's preferred training time on session days. Default on. The
 *     backend is the source of truth (workout_reminder_push/_inapp); the
 *     server value is read on mount so the switch never shows a stale state.
 *     Hidden for coach and owner accounts (reminders go to clients only).
 *
 * A failed save rolls the switch back and shows an inline notice chosen by
 * status (notificationPreferenceErrors.ts), never a generic alert.
 *
 * Preferences are persisted to AsyncStorage and synced to the backend
 * notifications preferences API where a backend field exists.
 * Additive on top of the existing Phase 9 coarse toggles in SettingsScreen.
 *
 * Accessibility: every toggle row has accessibilityLabel + accessibilityRole.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { notificationsApi } from '../../services/api';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import type { NotificationPreferenceChangedProps } from '../../analytics/events';
import { mediumTap } from '../../utils/haptics';
import { readUserCacheSync } from '../../lib/userCache';
import { preferenceSaveFailureOf, PreferenceSaveFailure } from './notificationPreferenceErrors';
import { SupportEmailFallback, useSupportEmail } from '../../components/support/SupportEmailFallback';

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifCategory = 'coach_direct' | 'client_bot' | 'workout_reminders' | 'milestones' | 'system';

interface CategoryPrefs {
  coach_direct: boolean;
  client_bot: boolean;
  workout_reminders: boolean;
  milestones: boolean;
  system: boolean;
}

const DEFAULT_PREFS: CategoryPrefs = {
  coach_direct: true,
  client_bot: true,
  workout_reminders: true,
  milestones: true,
  system: true,
};

const STORAGE_KEY = 'gp_notif_category_prefs';

// Map from category ID to backend notification preference fields.
// Each category maps to one or more backend fields that are sent as a
// single PATCH payload. Sending multiple fields per toggle ensures
// push and in-app channels are kept in sync with a single user action.
const BACKEND_FIELD_MAP: Record<NotifCategory, Record<string, boolean>> = {
  coach_direct: { message_push: true, message_inapp: true },
  milestones: { milestone_push: true, milestone_inapp: true },
  system: { weekly_summary_enabled: true },
  client_bot: { eat_enabled: true },
  workout_reminders: { workout_reminder_push: true, workout_reminder_inapp: true },
};

// Read the server value of the workout reminder toggle. Returns null when the
// response does not carry the field (older backend) so local state stands.
export function workoutRemindersFromServer(data: unknown): boolean | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as { workout_reminder_push?: unknown }).workout_reminder_push;
  return typeof value === 'boolean' ? value : null;
}

/**
 * B-312-2: the server value of any category, read from the first backend
 * field it maps to. Null when the response does not carry it.
 */
export function serverValueOf(category: NotifCategory, data: unknown): boolean | null {
  if (typeof data !== 'object' || data === null) return null;
  const field = Object.keys(BACKEND_FIELD_MAP[category])[0];
  const value = (data as Record<string, unknown>)[field];
  return typeof value === 'boolean' ? value : null;
}

function buildBackendPayload(category: NotifCategory, value: boolean): Record<string, boolean> {
  const template = BACKEND_FIELD_MAP[category];
  const payload: Record<string, boolean> = {};
  for (const key of Object.keys(template)) {
    payload[key] = value;
  }
  return payload;
}

// ─── Category metadata ────────────────────────────────────────────────────────

interface CategoryMeta {
  id: NotifCategory;
  label: string;
  description: string;
  icon: string;
  /** The setting in plain words, used in a failure message. */
  noun: string;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: 'coach_direct',
    noun: 'coach message',
    label: 'Coach Messages',
    description: 'Direct messages and session reminders from your coach.',
    icon: 'person-circle-outline',
  },
  {
    id: 'client_bot',
    noun: 'reminder',
    label: 'Reminders',
    description: 'Meal, water, and daily check-in nudges.',
    icon: 'alarm-outline',
  },
  {
    id: 'workout_reminders',
    noun: 'workout reminder',
    label: 'Workout reminders',
    description: 'A short note from Roman at your preferred training time on session days.',
    icon: 'barbell-outline',
  },
  {
    id: 'milestones',
    noun: 'milestone',
    label: 'Milestones',
    description: 'Streak extensions and personal records.',
    icon: 'ribbon-outline',
  },
  {
    id: 'system',
    noun: 'system notification',
    label: 'System',
    description: 'App updates, billing, and critical alerts.',
    icon: 'information-circle-outline',
  },
];

/**
 * C-312-2: workout reminders are sent to clients only (backend #609 runs them
 * for role 'student'), so coaches and owners do not see a switch that would do
 * nothing for them. While the role is not known yet the row is shown; the
 * backend still decides who gets reminders.
 */
export function categoriesForRole(role: string | null | undefined): CategoryMeta[] {
  if (typeof role === 'string' && role.length > 0 && role !== 'student') {
    return CATEGORIES.filter((c) => c.id !== 'workout_reminders');
  }
  return CATEGORIES;
}

const defaultRole = (): string | null => readUserCacheSync()?.role ?? null;

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationPreferencesScreen({
  navigation,
  role = defaultRole,
}: {
  navigation: NavigationProp<ParamListBase>;
  /** Injectable for tests; defaults to the signed-in account's cached role. */
  role?: () => string | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const categories = useMemo(() => categoriesForRole(role()), [role]);

  const [prefs, setPrefs] = useState<CategoryPrefs>(DEFAULT_PREFS);
  // B-312-2: the latest preferences, so every write and rollback starts from
  // what is on screen now rather than a snapshot taken by an older toggle.
  const prefsRef = useRef<CategoryPrefs>(DEFAULT_PREFS);
  // B-312-2: one write per category at a time. The ref blocks a second change
  // in the same frame; the state disables the switch until the server answers.
  const pendingRef = useRef<Set<NotifCategory>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<NotifCategory>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saveFailure, setSaveFailure] = useState<
    (PreferenceSaveFailure & { category: NotifCategory; attempted: boolean }) | null
  >(null);
  // A server failure offers a direct way to write to support, with the short
  // reference in the subject so support can find the request.
  const supportEmail = useSupportEmail(
    saveFailure?.reference
      ? `Notification setting, reference ${saveFailure.reference}`
      : 'Notification setting',
  );

  const commitPrefs = useCallback(async (update: (current: CategoryPrefs) => CategoryPrefs) => {
    const next = update(prefsRef.current);
    prefsRef.current = next;
    setPrefs(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: worst case the toggle resets on next cold start.
    }
  }, []);

  // Load persisted prefs on mount.
  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      let next: CategoryPrefs = raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
      try {
        const res = await notificationsApi.getPreferences();
        const server = workoutRemindersFromServer(res?.data);
        if (server !== null) next = { ...next, workout_reminders: server };
      } catch {
        // Offline or older backend: keep the locally stored value.
      }
      prefsRef.current = next;
      setPrefs(next);
    } catch {
      // Fall back to defaults — preference loss is non-fatal.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const handleToggle = useCallback(
    async (category: NotifCategory, value: boolean) => {
      // B-312-2: ignore a change while this category's last one is in flight.
      if (pendingRef.current.has(category)) return;
      pendingRef.current.add(category);
      setPending(new Set(pendingRef.current));
      mediumTap();
      setSaveFailure(null);
      const previousValue = prefsRef.current[category];

      try {
        // Optimistic update of this category only, persisted locally.
        await commitPrefs((current) => ({ ...current, [category]: value }));

        // Sync to backend. On failure, roll back this category only (a newer
        // change to another category stands) and say what happened.
        try {
          await notificationsApi.updatePreferences(buildBackendPayload(category, value));
        } catch (err: unknown) {
          await commitPrefs((current) => ({ ...current, [category]: previousValue }));
          // B-312-1: say what happened and what to do next, by status.
          const noun = CATEGORIES.find((c) => c.id === category)?.noun ?? 'notification';
          const failure = preferenceSaveFailureOf(err, noun);
          setSaveFailure({ ...failure, category, attempted: value });
          // B-312-2: when the write may still have reached the server (no
          // response, or an unexpected answer), show the server's value.
          if (failure.kind === 'offline' || failure.kind === 'server') {
            try {
              const res = await notificationsApi.getPreferences();
              const server = serverValueOf(category, res?.data);
              if (server !== null) {
                await commitPrefs((current) => ({ ...current, [category]: server }));
              }
            } catch {
              // Still unreachable: the rolled-back value and the notice stand.
            }
          }
        }

        // Analytics.
        const props: NotificationPreferenceChangedProps = { category, enabled: value };
        track(AnalyticsEvents.NOTIFICATION_PREFERENCE_CHANGED, { ...props });
      } finally {
        pendingRef.current.delete(category);
        setPending(new Set(pendingRef.current));
      }
    },
    [commitPrefs],
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.topBar}>
        <HapticPressable
          intent="light"
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.topTitle}>Notification Categories</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Control which types of notifications you receive. Coach messages are
          always important; reminders can be silenced without affecting your
          coach relationship.
        </Text>

        <View style={styles.card}>
          {categories.map((cat, idx) => (
            <View
              key={cat.id}
              style={[styles.row, idx < categories.length - 1 && styles.rowDivider]}
            >
              <View style={styles.rowLeft}>
                <Ionicons
                  name={cat.icon as never}
                  size={20}
                  color={prefs[cat.id] ? colors.primary : colors.textMuted}
                  style={styles.rowIcon}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{cat.label}</Text>
                  <Text style={styles.rowDesc}>{cat.description}</Text>
                </View>
              </View>
              <Switch
                value={prefs[cat.id]}
                onValueChange={(v) => handleToggle(cat.id, v)}
                disabled={pending.has(cat.id)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
                accessibilityRole="switch"
                accessibilityLabel={cat.label}
                accessibilityState={{ checked: prefs[cat.id], disabled: pending.has(cat.id), busy: pending.has(cat.id) }}
              />
            </View>
          ))}
        </View>

        {saveFailure ? (
          <View
            style={styles.notice}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="notif-pref-save-error"
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={colors.textPrimary}
              style={styles.noticeIcon}
            />
            <View style={styles.noticeBody}>
              <Text selectable style={styles.noticeText} testID="notif-pref-save-error-text">
                {saveFailure.message}
              </Text>
              {/* A working next action for every failure the user can act on.
                  Signed out has none here: the app is already returning to
                  sign-in. */}
              {saveFailure.kind !== 'signed_out' ? (
                <View style={styles.noticeActions}>
                  <HapticPressable
                    onPress={() => handleToggle(saveFailure.category, saveFailure.attempted)}
                    accessibilityRole="button"
                    accessibilityLabel={`Try saving the ${
                      CATEGORIES.find((c) => c.id === saveFailure.category)?.noun ?? 'notification'
                    } setting again`}
                    testID="notif-pref-save-error-retry"
                    style={styles.noticeAction}
                  >
                    <Text style={styles.noticeActionText}>Try again</Text>
                  </HapticPressable>
                  {saveFailure.kind === 'server' ? (
                    <HapticPressable
                      onPress={() => {
                        void supportEmail.open();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Write to support"
                      testID="notif-pref-save-error-support"
                      style={styles.noticeAction}
                    >
                      <Text style={styles.noticeActionText}>Write to support</Text>
                    </HapticPressable>
                  ) : null}
                </View>
              ) : null}
              {saveFailure.kind === 'server' ? (
                <SupportEmailFallback
                  handle={supportEmail}
                  textStyle={styles.noticeText}
                  linkColor={colors.primary}
                  testID="notif-pref-support-fallback"
                />
              ) : null}
            </View>
          </View>
        ) : null}

        <Text style={styles.footnote}>
          System notifications cannot be fully disabled — critical billing and
          security alerts will still be delivered regardless of this setting.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: {
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
      color: colors.textPrimary,
    },
    content: {
      padding: 20,
      paddingBottom: 40,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    noticeIcon: {
      marginRight: 8,
      marginTop: 1,
    },
    noticeBody: {
      flex: 1,
    },
    noticeActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 8,
    },
    noticeAction: {
      minHeight: 44,
      justifyContent: 'center',
      marginRight: 20,
    },
    noticeActionText: {
      fontSize: 14,
      lineHeight: 20,
      fontFamily: 'Inter_600SemiBold',
      color: colors.primary,
    },
    noticeText: {
      fontSize: 14,
      lineHeight: 20,
      fontFamily: 'Inter_400Regular',
      color: colors.textPrimary,
    },
    intro: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      flex: 1,
      marginRight: 12,
    },
    rowIcon: {
      marginTop: 2,
      marginRight: 12,
    },
    rowText: {
      flex: 1,
    },
    rowLabel: {
      fontSize: 15,
      fontFamily: 'Inter_500Medium',
      color: colors.textPrimary,
      marginBottom: 2,
    },
    rowDesc: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      lineHeight: 18,
    },
    footnote: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.textMuted,
      lineHeight: 18,
      marginTop: 4,
    },
  });
}
