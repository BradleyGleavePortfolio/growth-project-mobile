/**
 * LeanQ5Screen — Optional birth year + target weight.
 *
 * Step 5 of the lean onboarding flow. Both fields are optional — the step
 * headline and skip affordance make this explicit. Values are persisted to
 * MMKV on every change (draft key) and written to the onboarding store on
 * Save. Navigation continues to LeanQ6 for dietary preferences.
 *
 * Unit toggle mirrors Q4: lbs / kg chip pair, same pill style.
 * Birth year uses a FlatList-based WheelPicker — no third-party lib.
 */

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
  Dimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Localization from 'expo-localization';
import { LeanOnboardingParamList } from '../../navigation/LeanOnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import { prefsStorage } from '../../storage/mmkv';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAFT_KEY = 'onboarding.lean_q5_draft';
const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultUnits(): 'imperial' | 'metric' {
  try {
    const region = Localization.getLocales()[0]?.regionCode ?? 'US';
    return region === 'US' || region === 'LR' || region === 'MM'
      ? 'imperial'
      : 'metric';
  } catch {
    return 'imperial';
  }
}

function lbsToKg(lbs: number): number {
  return Math.round(lbs * 0.45359237 * 10) / 10;
}

function buildYearRange(): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current - 13; y >= current - 80; y--) {
    years.push(y);
  }
  return years;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ5'>;
};

interface DraftState {
  dob?: string; // 'YYYY-01-01' — partial ISO date from birth year
  target_weight_kg?: number;
}

// ─── WheelPicker ─────────────────────────────────────────────────────────────

interface WheelPickerProps {
  years: number[];
  selectedYear: number;
  onYearChange: (year: number) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

function WheelPicker({ years, selectedYear, onYearChange, styles, colors }: WheelPickerProps) {
  const flatListRef = useRef<FlatList<number>>(null);
  const selectedIndex = years.indexOf(selectedYear);

  // Scroll to selected index on mount
  useEffect(() => {
    if (selectedIndex >= 0) {
      // Slight delay to ensure layout is done
      const t = setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: selectedIndex,
          animated: false,
          viewOffset: (PICKER_HEIGHT / 2) - (ITEM_HEIGHT / 2),
        });
      }, 100);
      return () => clearTimeout(t);
    }
  }, []);

  const handleScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const offsetY = e.nativeEvent.contentOffset.y;
      const centerOffset = PICKER_HEIGHT / 2 - ITEM_HEIGHT / 2;
      const rawIndex = Math.round((offsetY + centerOffset) / ITEM_HEIGHT);
      const clampedIndex = Math.max(0, Math.min(rawIndex, years.length - 1));
      if (years[clampedIndex] !== undefined) {
        onYearChange(years[clampedIndex]);
      }
    },
    [years, onYearChange],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: number; index: number }) => {
      const isSelected = item === selectedYear;
      return (
        <TouchableOpacity
          style={styles.wheelItem}
          onPress={() => {
            onYearChange(item);
            flatListRef.current?.scrollToIndex({
              index,
              animated: true,
              viewOffset: (PICKER_HEIGHT / 2) - (ITEM_HEIGHT / 2),
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={`Select year ${item}`}
          accessibilityState={{ selected: isSelected }}
          testID={`wheel-year-${item}`}
        >
          <Text
            style={[
              styles.wheelItemText,
              isSelected && styles.wheelItemTextSelected,
            ]}
          >
            {item}
          </Text>
        </TouchableOpacity>
      );
    },
    [selectedYear, styles, onYearChange],
  );

  return (
    <View style={styles.wheelContainer}>
      {/* Selection highlight bar — pointerEvents='none' via style so touches pass through */}
      <View
        style={[
          styles.wheelSelectionBar,
          { top: PICKER_HEIGHT / 2 - ITEM_HEIGHT / 2, pointerEvents: 'none' },
        ]}
      />
      <FlatList
        ref={flatListRef}
        data={years}
        keyExtractor={(y) => String(y)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        style={{ height: PICKER_HEIGHT }}
        contentContainerStyle={{ paddingVertical: PICKER_HEIGHT / 2 - ITEM_HEIGHT / 2 }}
        getItemLayout={(_, index) => ({
          length: ITEM_HEIGHT,
          offset: ITEM_HEIGHT * index,
          index,
        })}
        initialScrollIndex={selectedIndex >= 0 ? selectedIndex : 0}
        testID="birth-year-wheel"
        accessibilityLabel="Birth year picker"
        accessibilityRole="adjustable"
      />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LeanQ5Screen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const years = useMemo(() => buildYearRange(), []);
  const defaultYear = new Date().getFullYear() - 30;

  const [units, setUnits] = useState<'imperial' | 'metric'>(defaultUnits());
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [targetWeight, setTargetWeight] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // ── Hydrate from MMKV draft ───────────────────────────────────────────────
  useEffect(() => {
    async function hydrate() {
      try {
        const raw = await prefsStorage.getStringAsync(DRAFT_KEY);
        if (raw) {
          const draft: DraftState = JSON.parse(raw);
          if (draft.dob) {
            const year = parseInt(draft.dob.split('-')[0], 10);
            if (Number.isFinite(year)) setSelectedYear(year);
          }
          if (draft.target_weight_kg) {
            // Restore in current unit preference
            if (units === 'imperial') {
              const lbs = Math.round((draft.target_weight_kg / 0.45359237) * 10) / 10;
              setTargetWeight(String(lbs));
            } else {
              setTargetWeight(String(draft.target_weight_kg));
            }
          }
        }
      } catch {
        // hydration is best-effort
      } finally {
        setHydrated(true);
      }
    }
    hydrate();
  }, []);

  // ── Persist draft on every change ────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    const draft: DraftState = { dob: `${selectedYear}-01-01` };
    const raw = parseFloat(targetWeight);
    if (Number.isFinite(raw) && raw > 0) {
      draft.target_weight_kg =
        units === 'imperial' ? lbsToKg(raw) : Math.round(raw * 10) / 10;
    }
    prefsStorage.set(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
  }, [selectedYear, targetWeight, units, hydrated]);

  // ── Validation ────────────────────────────────────────────────────────────
  const isWeightValid = useMemo(() => {
    if (!targetWeight) return true; // empty = optional, skip
    const val = parseFloat(targetWeight);
    if (!Number.isFinite(val)) return false;
    if (units === 'imperial') return val >= 60 && val <= 700;
    return val >= 30 && val <= 320;
  }, [targetWeight, units]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isWeightValid || submitting) return;
    setSubmitting(true);
    try {
      const payload: Parameters<typeof saveOnboardingData>[0] = {
        // Store birth year as a partial ISO dob string (YYYY-01-01) so
        // finalizeLeanOnboarding can compute age via calculateAge(dob).
        dob: `${selectedYear}-01-01`,
      };
      const raw = parseFloat(targetWeight);
      if (Number.isFinite(raw) && raw > 0) {
        payload.targetWeight =
          units === 'imperial' ? lbsToKg(raw) : Math.round(raw * 10) / 10;
      }
      await saveOnboardingData(payload);
      navigation.navigate('LeanQ6');
    } catch {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    navigation.navigate('LeanQ6');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
              <View style={[styles.dot, styles.dotActive]} />
            </View>
            <Text style={styles.headline}>A little more about you.</Text>
            <Text style={styles.subtext}>
              Optional — these help personalise your targets.
            </Text>
          </View>

          {/* Birth Year */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>BIRTH YEAR</Text>
            <WheelPicker
              years={years}
              selectedYear={selectedYear}
              onYearChange={setSelectedYear}
              styles={styles}
              colors={colors}
            />
          </View>

          {/* Target Weight */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TARGET WEIGHT (OPTIONAL)</Text>

            {/* Unit toggle */}
            <View style={styles.unitRow}>
              <TouchableOpacity
                style={[styles.unitChip, units === 'imperial' && styles.unitChipActive]}
                onPress={() => {
                  if (units !== 'imperial') {
                    // convert existing value
                    const kg = parseFloat(targetWeight);
                    if (Number.isFinite(kg) && kg > 0) {
                      const lbs = Math.round((kg / 0.45359237) * 10) / 10;
                      setTargetWeight(String(lbs));
                    }
                    setUnits('imperial');
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Use pounds"
                accessibilityState={{ selected: units === 'imperial' }}
                testID="unit-chip-lbs"
              >
                <Text
                  style={[
                    styles.unitChipText,
                    units === 'imperial' && styles.unitChipTextActive,
                  ]}
                >
                  lbs
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.unitChip, units === 'metric' && styles.unitChipActive]}
                onPress={() => {
                  if (units !== 'metric') {
                    const lbs = parseFloat(targetWeight);
                    if (Number.isFinite(lbs) && lbs > 0) {
                      setTargetWeight(String(lbsToKg(lbs)));
                    }
                    setUnits('metric');
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Use kilograms"
                accessibilityState={{ selected: units === 'metric' }}
                testID="unit-chip-kg"
              >
                <Text
                  style={[
                    styles.unitChipText,
                    units === 'metric' && styles.unitChipTextActive,
                  ]}
                >
                  kg
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.input, !isWeightValid && styles.inputError]}
              value={targetWeight}
              onChangeText={setTargetWeight}
              placeholder={units === 'imperial' ? 'lbs' : 'kg'}
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              maxLength={5}
              accessibilityLabel={
                units === 'imperial'
                  ? 'Target weight in pounds'
                  : 'Target weight in kilograms'
              }
              testID="target-weight-input"
            />
          </View>

          <View style={{ flex: 1 }} />

          {/* Save CTA */}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (!isWeightValid || submitting) && styles.primaryBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={!isWeightValid || submitting}
            accessibilityRole="button"
            accessibilityLabel="Save and continue"
            testID="save-continue-btn"
          >
            <Text style={styles.primaryBtnText}>SAVE AND CONTINUE</Text>
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
              onPress={handleSkip}
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
      </KeyboardAvoidingView>
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
    fieldGroup: { marginBottom: 24 },
    fieldLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      lineHeight: 13,
      letterSpacing: 1.98,
      fontWeight: '500',
      textTransform: 'uppercase',
      color: colors.textMuted,
      marginBottom: 8,
    },
    // Wheel picker
    wheelContainer: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 2,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      height: PICKER_HEIGHT,
    },
    wheelSelectionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: ITEM_HEIGHT,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primaryPale,
      zIndex: 1,
    },
    wheelItem: {
      height: ITEM_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wheelItemText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 18,
      color: colors.textMuted,
    },
    wheelItemTextSelected: {
      fontFamily: 'Inter_500Medium',
      fontSize: 20,
      color: colors.textPrimary,
    },
    // Unit chips
    unitRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    unitChip: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
    },
    unitChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryPale,
    },
    unitChipText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: colors.textSecondary,
    },
    unitChipTextActive: { color: colors.primary },
    // Weight input
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 2,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.textPrimary,
      fontFamily: 'Inter_400Regular',
    },
    inputError: {
      borderColor: colors.error,
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
