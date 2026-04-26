/**
 * PreferencesScreen — UX Psychology Report #4 "Preference-Controlled Personalization"
 *
 * Lets users control:
 *   • Home modules visibility (toggle per-section)
 *   • Notification cadence (Daily / Weekly / Off)
 *   • Motivational tone (Gentle / Direct / Drill) with sample copy preview
 *   • Units (Metric / Imperial)
 *   • Week starts on (Sun / Mon / Sat)
 *
 * Analytics: fires `preferences_opened` on mount,
 *             `preference_changed` with {key} on each change.
 */

import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { track } from '../../lib/analytics';
import {
  usePreferences,
  type HomeModule,
  type NotificationCadence,
  type MotivationalTone,
  type Units,
  type FirstDayOfWeek,
} from '../../hooks/usePreferences';

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME_MODULE_LABELS: Record<HomeModule, string> = {
  hero: 'Hero Action',
  milestone: 'Milestone Card',
  trustcues: 'Trust Cues',
  secondary: 'Secondary Tiles',
  community: 'Community Feed',
};

const TONE_COPY: Record<MotivationalTone, { label: string; preview: string }> = {
  gentle: { label: 'Gentle', preview: '"Ready when you are"' },
  direct: { label: 'Direct', preview: '"Log Today\'s Workout"' },
  drill: { label: 'Drill', preview: '"No excuses. Log it now."' },
};

const CADENCE_LABELS: Record<NotificationCadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  off: 'Off',
};

const UNITS_LABELS: Record<Units, string> = {
  metric: 'Metric',
  imperial: 'Imperial',
};

const WEEK_START_LABELS: Record<FirstDayOfWeek, string> = {
  0: 'Sunday',
  1: 'Monday',
  6: 'Saturday',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
}
function SectionHeader({ title }: SectionHeaderProps) {
  return <Text style={styles.sectionLabel}>{title.toUpperCase()}</Text>;
}

interface RadioRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  preview?: string;
}
function RadioRow({ label, selected, onPress, preview }: RadioRowProps) {
  return (
    <HapticPressable
      intent="light"
      style={styles.row}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={styles.radioLeft}>
        <View style={[styles.radioCircle, selected && styles.radioCircleActive]}>
          {selected && <View style={styles.radioInner} />}
        </View>
        <View>
          <Text style={styles.rowLabel}>{label}</Text>
          {preview ? <Text style={styles.preview}>{preview}</Text> : null}
        </View>
      </View>
    </HapticPressable>
  );
}

interface SegmentControlProps<T extends string | number> {
  options: T[];
  selected: T;
  label: (opt: T) => string;
  onSelect: (opt: T) => void;
}
function SegmentControl<T extends string | number>({
  options,
  selected,
  label,
  onSelect,
}: SegmentControlProps<T>) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const active = opt === selected;
        return (
          <HapticPressable
            key={String(opt)}
            intent="light"
            style={[styles.segBtn, active && styles.segBtnActive]}
            onPress={() => onSelect(opt)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label(opt)}
          >
            <Text style={[styles.segText, active && styles.segTextActive]}>
              {label(opt)}
            </Text>
          </HapticPressable>
        );
      })}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PreferencesScreen({ navigation }: any) {
  const { prefs, isLoading, isSaving, updatePrefs } = usePreferences();

  useEffect(() => {
    track('preferences_opened');
  }, []);

  /** Emit analytics + update */
  const change = useCallback(
    <K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) => {
      track('preference_changed', { key });
      updatePrefs({ [key]: value } as any);
    },
    [updatePrefs],
  );

  const toggleModule = useCallback(
    (mod: HomeModule, enabled: boolean) => {
      let next: HomeModule[];
      if (enabled) {
        // Preserve insert order relative to full ordered list
        const fullOrder: HomeModule[] = ['hero', 'milestone', 'trustcues', 'secondary', 'community'];
        next = fullOrder.filter(
          (m) => m === mod || prefs.homeModules.includes(m),
        );
      } else {
        next = prefs.homeModules.filter((m) => m !== mod);
        if (next.length === 0) next = ['hero']; // Always keep at least one
      }
      change('homeModules', next);
    },
    [prefs.homeModules, change],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const allModules: HomeModule[] = ['hero', 'milestone', 'trustcues', 'secondary', 'community'];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.topBar}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.topTitle}>Personalization</Text>
        <View style={styles.backBtn}>
          {isSaving && <ActivityIndicator size="small" color={Colors.primary} />}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Control how the app works for you. Changes save automatically.
        </Text>

        {/* ── Home Modules ─────────────────────────────────────────────────── */}
        <SectionHeader title="Home Screen" />
        <View style={styles.card}>
          {allModules.map((mod, idx) => {
            const enabled = prefs.homeModules.includes(mod);
            return (
              <View
                key={mod}
                style={[
                  styles.row,
                  idx < allModules.length - 1 && styles.rowBorder,
                ]}
              >
                <Text style={styles.rowLabel}>{HOME_MODULE_LABELS[mod]}</Text>
                <Switch
                  value={enabled}
                  onValueChange={(v) => toggleModule(mod, v)}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.textOnPrimary}
                  accessibilityRole="switch"
                  accessibilityLabel={HOME_MODULE_LABELS[mod]}
                  accessibilityState={{ checked: enabled }}
                />
              </View>
            );
          })}
        </View>

        {/* ── Notifications ─────────────────────────────────────────────────── */}
        <SectionHeader title="Notifications" />
        <View style={styles.card}>
          {(['daily', 'weekly', 'off'] as NotificationCadence[]).map((opt, idx, arr) => (
            <View key={opt} style={idx < arr.length - 1 ? styles.rowBorder : undefined}>
              <RadioRow
                label={CADENCE_LABELS[opt]}
                selected={prefs.notificationCadence === opt}
                onPress={() => change('notificationCadence', opt)}
              />
            </View>
          ))}
        </View>

        {/* ── Motivational Tone ─────────────────────────────────────────────── */}
        <SectionHeader title="Motivational Tone" />
        <View style={styles.card}>
          {(['gentle', 'direct', 'drill'] as MotivationalTone[]).map((opt, idx, arr) => (
            <View key={opt} style={idx < arr.length - 1 ? styles.rowBorder : undefined}>
              <RadioRow
                label={TONE_COPY[opt].label}
                selected={prefs.motivationalTone === opt}
                onPress={() => change('motivationalTone', opt)}
                preview={TONE_COPY[opt].preview}
              />
            </View>
          ))}
        </View>

        {/* ── Units ─────────────────────────────────────────────────────────── */}
        <SectionHeader title="Units" />
        <View style={styles.card}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={styles.rowLabel}>Display units</Text>
            <SegmentControl<Units>
              options={['metric', 'imperial']}
              selected={prefs.units}
              label={(u) => UNITS_LABELS[u]}
              onSelect={(u) => change('units', u)}
            />
          </View>
        </View>

        {/* ── Week Starts On ───────────────────────────────────────────────── */}
        <SectionHeader title="Week Starts On" />
        <View style={styles.card}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={styles.rowLabel}>First day</Text>
            <SegmentControl<FirstDayOfWeek>
              options={[0, 1, 6]}
              selected={prefs.firstDayOfWeek}
              label={(d) => WEEK_START_LABELS[d]}
              onSelect={(d) => change('firstDayOfWeek', d)}
            />
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  intro: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 20,
    marginTop: 4,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    fontSize: 15,
    color: Colors.textPrimary,
    flex: 1,
  },
  preview: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  radioLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 4, // radius.lg
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleActive: {
    borderColor: Colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 2, // radius.md
    backgroundColor: Colors.primary,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 0, // radius.sm
    overflow: 'hidden',
  },
  segBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  segBtnActive: {
    backgroundColor: Colors.primary,
  },
  segText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  segTextActive: {
    color: Colors.textOnPrimary,
  },
});
