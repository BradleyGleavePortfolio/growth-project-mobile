/**
 * PracticeSelectionScreen — Stage-3 coach practice picker.
 *
 * Two contexts:
 *   1. First-time coach (or any coach with `coach_practice_type === null`)
 *      bounces here on cross-pillar entry instead of seeing 403s.
 *   2. Settings → "Practice type" — same component, "current" prop drives
 *      the pre-selected option.
 *
 * Three options match the backend enum exactly:
 *   - fitness_only
 *   - finance_only
 *   - both  (unlocks the cross-pillar UI)
 *
 * Save calls `practiceTypeApi.set` against the fitness backend. Stage 3
 * doesn't auto-mirror the choice into the finance backend — Bradley
 * picks his Wealth coach practice the next time he opens the finance
 * app, where the same enum exists. Cross-mirror is a 30-line follow-up
 * once the federation handshake adds an outbound write surface.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { practiceTypeApi } from '../../../services/api';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { Typography } from '../../../theme';
import type { CoachPracticeType } from '../../../types/crossPillar';
import type { CrossPillarStackParamList } from './CrossPillarNavigator';

type Route = RouteProp<CrossPillarStackParamList, 'PracticeSelection'>;

const OPTIONS: { id: CoachPracticeType; label: string; subtitle: string }[] = [
  {
    id: 'both',
    label: 'Both pillars',
    subtitle: 'Body and Wealth — unified roster, cross-pillar insights.',
  },
  {
    id: 'fitness_only',
    label: 'Body only',
    subtitle: 'Fitness coaching practice — single-product surface.',
  },
  {
    id: 'finance_only',
    label: 'Wealth only',
    subtitle: 'Finance coaching practice — single-product surface.',
  },
];

export default function PracticeSelectionScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const incoming: CoachPracticeType | null = route.params?.current ?? null;

  const [selected, setSelected] = useState<CoachPracticeType | null>(incoming);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the screen was reached because we don't yet know the practice
  // type, fetch the current value to keep the picker accurate.
  useEffect(() => {
    if (incoming !== null) return;
    let alive = true;
    practiceTypeApi
      .get()
      .then(({ data }) => {
        if (alive && data.practice_type) setSelected(data.practice_type);
      })
      .catch(() => {
        // Best-effort prefetch; selection still works without it.
      });
    return () => {
      alive = false;
    };
  }, [incoming]);

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await practiceTypeApi.set(selected);
      // Pop back to whatever pushed this screen — Settings re-renders
      // its row with the new value, and the cross-pillar navigator
      // gate now lets `both` coaches through.
      navigation.goBack();
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setSaving(false);
    }
  }, [navigation, selected]);

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>YOUR PRACTICE</Text>
        <View style={{ width: 32 }} />
      </View>

      <Text style={styles.eyebrow}>SET YOUR PRACTICE</Text>
      <Text style={styles.headline}>What does your work cover?</Text>
      <Text style={styles.lede}>
        We use this to decide which surfaces appear. You can change it anytime
        in Settings.
      </Text>

      <View style={styles.options}>
        {OPTIONS.map((opt) => {
          const active = selected === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setSelected(opt.id)}
              style={[styles.option, active && styles.optionActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {opt.label}
                </Text>
                <Text style={styles.optionSubtitle}>{opt.subtitle}</Text>
              </View>
              {active ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        style={[styles.saveBtn, (!selected || saving) && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!selected || saving}
        accessibilityRole="button"
        accessibilityLabel="Save practice"
      >
        {saving ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={styles.saveBtnText}>SAVE</Text>
        )}
      </Pressable>

      <Text style={styles.footnote}>
        "Both" unlocks the cross-pillar coach surfaces — universal search,
        unified client detail, holistic insights. The single-pillar choices
        keep your existing experience unchanged.
      </Text>
    </ScrollView>
  );
}

function toMessage(err: unknown): string {
  if (!err) return 'Couldn\'t save practice. Try again.';
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? 'Couldn\'t save practice. Try again.');
  }
  return 'Couldn\'t save practice. Try again.';
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, paddingBottom: 80 },
    headerBar: { flexDirection: 'row', alignItems: 'center', paddingBottom: 16 },
    backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', ...Typography.label, color: colors.textSecondary },
    eyebrow: { ...Typography.label, color: colors.textSecondary },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 36,
      color: colors.textPrimary,
      marginTop: 4,
    },
    lede: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      marginTop: 8,
      marginBottom: 24,
    },
    options: { gap: 12, marginBottom: 16 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    optionActive: { borderColor: colors.primary },
    optionLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
      color: colors.textPrimary,
    },
    optionLabelActive: { color: colors.primary },
    optionSubtitle: { ...Typography.caption, color: colors.textMuted, marginTop: 4 },
    errorText: {
      ...Typography.caption,
      color: colors.error,
      marginBottom: 8,
    },
    saveBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: {
      fontFamily: 'Inter_700Bold',
      fontSize: 14,
      color: colors.textOnPrimary,
      letterSpacing: 1.5,
    },
    footnote: { ...Typography.caption, color: colors.textMuted, marginTop: 16, lineHeight: 18 },
  });
