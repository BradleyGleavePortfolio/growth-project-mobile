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
 *
 * Preferences are persisted to AsyncStorage and synced to the backend
 * notifications preferences API where a backend field exists.
 * Additive on top of the existing Phase 9 coarse toggles in SettingsScreen.
 *
 * Accessibility: every toggle row has accessibilityLabel + accessibilityRole.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifCategory = 'coach_direct' | 'client_bot' | 'milestones' | 'system';

interface CategoryPrefs {
  coach_direct: boolean;
  client_bot: boolean;
  milestones: boolean;
  system: boolean;
}

const DEFAULT_PREFS: CategoryPrefs = {
  coach_direct: true,
  client_bot: true,
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
};

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
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: 'coach_direct',
    label: 'Coach Messages',
    description: 'Direct messages and session reminders from your coach.',
    icon: 'person-circle-outline',
  },
  {
    id: 'client_bot',
    label: 'Reminders',
    description: 'Meal, water, and daily check-in nudges.',
    icon: 'alarm-outline',
  },
  {
    id: 'milestones',
    label: 'Milestones',
    description: 'Streak extensions and personal records.',
    icon: 'ribbon-outline',
  },
  {
    id: 'system',
    label: 'System',
    description: 'App updates, billing, and critical alerts.',
    icon: 'information-circle-outline',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationPreferencesScreen({
  navigation,
}: {
  navigation: NavigationProp<ParamListBase>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [prefs, setPrefs] = useState<CategoryPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  // Load persisted prefs on mount.
  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      }
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
      mediumTap();
      const previous = prefs;
      const updated = { ...prefs, [category]: value };

      // Optimistic update — show immediately.
      setPrefs(updated);

      // Persist locally.
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Non-fatal: worst case the toggle resets on next cold start.
      }

      // Sync to backend. On failure, roll back both the local state and
      // the AsyncStorage value so UI reflects truth.
      try {
        const payload = buildBackendPayload(category, value);
        await notificationsApi.updatePreferences(payload);
      } catch {
        // Roll back — the backend is the source of truth for preferences.
        setPrefs(previous);
        try {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(previous));
        } catch {
          // Ignore secondary storage failure.
        }
        // Surface a brief error to the user without a blocking alert.
        // (Assumes a toast/snack component is available; adapt to your UI kit.)
        // If no toast is wired, the rollback alone is sufficient.
      }

      // Analytics.
      const props: NotificationPreferenceChangedProps = { category, enabled: value };
      track(AnalyticsEvents.NOTIFICATION_PREFERENCE_CHANGED, props as unknown as Record<string, unknown>);
    },
    [prefs],
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
          {CATEGORIES.map((cat, idx) => (
            <View
              key={cat.id}
              style={[styles.row, idx < CATEGORIES.length - 1 && styles.rowDivider]}
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
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
                accessibilityRole="switch"
                accessibilityLabel={cat.label}
                accessibilityState={{ checked: prefs[cat.id] }}
              />
            </View>
          ))}
        </View>

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
