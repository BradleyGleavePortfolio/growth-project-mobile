/**
 * LeanQ6Screen — Dietary preferences (multi-select chips).
 *
 * Final step of the lean onboarding flow. Calling finishOnboarding() writes
 * all accumulated answers to the backend via finalizeLeanOnboarding(), then
 * fires authEvents.emit() so the root navigator tears down the onboarding
 * stack and lands the user on Home.
 *
 * "None" chip deselects all others; selecting any other chip deselects "None".
 * All state is persisted to MMKV on every change for crash recovery.
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Pressable,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LeanOnboardingParamList } from '../../navigation/LeanOnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import { finalizeLeanOnboarding } from '../../lib/finalizeLeanOnboarding';
import { authEvents } from '../../utils/authEvents';
import { prefsStorage } from '../../storage/mmkv';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../../lib/analytics';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ6'>;
};

type RestrictionValue =
  | 'vegan'
  | 'vegetarian'
  | 'gluten_free'
  | 'halal'
  | 'kosher'
  | 'nut_free';

interface ChipDef {
  label: string;
  value: RestrictionValue | 'none';
}

// ─── Chip definitions ─────────────────────────────────────────────────────────

const CHIPS: ChipDef[] = [
  { label: 'None', value: 'none' },
  { label: 'Vegan', value: 'vegan' },
  { label: 'Vegetarian', value: 'vegetarian' },
  { label: 'Gluten-free', value: 'gluten_free' },
  { label: 'Halal', value: 'halal' },
  { label: 'Kosher', value: 'kosher' },
  { label: 'Nut-free', value: 'nut_free' },
];

const DRAFT_KEY = 'onboarding.lean_q6_draft';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LeanQ6Screen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selected, setSelected] = useState<Set<RestrictionValue | 'none'>>(new Set(['none']));
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // ── Hydrate from MMKV draft ───────────────────────────────────────────────
  useEffect(() => {
    async function hydrate() {
      try {
        const raw = await prefsStorage.getStringAsync(DRAFT_KEY);
        if (raw) {
          const arr: Array<RestrictionValue | 'none'> = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            setSelected(new Set(arr));
          }
        }
      } catch {
        // best-effort
      } finally {
        setHydrated(true);
      }
    }
    hydrate();
  }, []);

  // ── Persist draft on every change ────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    prefsStorage
      .set(DRAFT_KEY, JSON.stringify(Array.from(selected)))
      .catch(() => {});
  }, [selected, hydrated]);

  // ── Chip toggle ───────────────────────────────────────────────────────────
  const handleChipPress = (value: RestrictionValue | 'none') => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value === 'none') {
        // "None" clears everything else and selects itself
        return new Set(['none']);
      }
      // Selecting any real restriction deselects "none"
      next.delete('none');
      if (next.has(value)) {
        next.delete(value);
        // If nothing is selected, revert to "None"
        if (next.size === 0) next.add('none');
      } else {
        next.add(value);
      }
      return next;
    });
  };

  // ── Build restrictions array for the store ───────────────────────────────
  function buildRestrictions(): RestrictionValue[] {
    if (selected.has('none')) return [];
    return Array.from(selected).filter((v) => v !== 'none') as RestrictionValue[];
  }

  // ── Finish onboarding ─────────────────────────────────────────────────────
  const finishOnboarding = async (skipped: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const restrictions = skipped ? [] : buildRestrictions();
      await saveOnboardingData({ restrictions });

      // Write completion flags that were previously in Q4
      await AsyncStorage.setItem('onboarding_complete', 'true');
      await AsyncStorage.setItem('lean_onboarding_done', 'true');

      const result = await finalizeLeanOnboarding();

      track(skipped ? 'onboarding_skipped' : 'onboarding_step_completed', {
        step: 6,
        restrictions_count: restrictions.length,
        synced: result.ok,
        computed_macros: result.computedMacros,
      });

      // Always emit — success or failure; the reconcile hook will retry
      authEvents.emit();
    } catch {
      // Even on error, emit so the user isn't trapped on this screen
      authEvents.emit();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.stepIndicator}>
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotActive]} />
          </View>
          <Text style={styles.headline}>Any dietary preferences?</Text>
          <Text style={styles.subtext}>Select all that apply.</Text>
        </View>

        {/* Chips */}
        <View style={styles.chipRow}>
          {CHIPS.map((chip) => {
            const isSelected = selected.has(chip.value);
            return (
              <Pressable
                key={chip.value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => handleChipPress(chip.value)}
                accessibilityRole="checkbox"
                accessibilityLabel={chip.label}
                accessibilityState={{ checked: isSelected }}
                testID={`chip-${chip.value}`}
              >
                <Text
                  style={[styles.chipText, isSelected && styles.chipTextSelected]}
                >
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flex: 1 }} />

        {/* CTA */}
        <TouchableOpacity
          style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
          onPress={() => finishOnboarding(false)}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          testID="continue-btn"
        >
          <Text style={styles.primaryBtnText}>CONTINUE</Text>
        </TouchableOpacity>

        {/* Bottom row */}
        <View style={styles.bottomRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.6}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="back-btn"
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => finishOnboarding(true)}
            style={styles.skipBtn}
            activeOpacity={0.6}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Skip, add later"
            testID="skip-btn"
          >
            <Text style={styles.skipText}>Skip — I'll add later</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 32,
      paddingBottom: 16,
    },
    header: { marginBottom: 28 },
    stepIndicator: { flexDirection: 'row', gap: 8, marginBottom: 24 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
    dotActive: { backgroundColor: colors.primary, width: 24 },
    dotComplete: { backgroundColor: colors.primary },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 35,
      letterSpacing: 0.6,
      fontWeight: '400',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    // Chips
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 32,
    },
    chip: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryPale,
    },
    chipText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
    },
    chipTextSelected: {
      fontFamily: 'Inter_500Medium',
      color: colors.primary,
    },
    // Buttons
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 16,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: colors.textOnPrimary,
      letterSpacing: 1.2,
      fontWeight: '600',
    },
    bottomRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 8,
      paddingHorizontal: 4,
    },
    backBtn: { paddingVertical: 12, paddingHorizontal: 4 },
    backText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
      letterSpacing: 0.3,
    },
    skipBtn: { paddingVertical: 12, paddingHorizontal: 4 },
    skipText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      letterSpacing: 0.3,
    },
  });
