import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { profileApi } from '../../services/api';
import { authEvents } from '../../utils/authEvents';
import { calcBMR, calcTDEE, calcMacros, calculateAge } from '../../utils/nutrition';
import { Colors } from '../../constants/colors';

export default function OnboardingResults() {
  const [macros, setMacros] = useState<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    tdee: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAndCalc();
  }, []);

  const loadAndCalc = async () => {
    try {
      // Load from new onboardingStore (AsyncStorage)
      const { getOnboardingData } = await import('../../utils/onboardingStore');
      const d = await getOnboardingData();

      const age = d.dob ? calculateAge(d.dob) : 25;
      const weight = d.currentWeight || 180;
      const height = d.height || 175;
      const sex = d.sex || 'male';
      const activity = d.activityLevel || 'moderate';
      const goal = d.primaryGoal || 'maintain';

      const bmr = calcBMR(weight, height, age, sex);
      const tdee = calcTDEE(bmr, activity);
      const result = calcMacros(weight, tdee, goal);

      setMacros({
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        tdee: result.tdee,
      });
    } catch (err) {
      // Macro calc failed — most likely malformed AsyncStorage payload.
      // `macros` stays null which triggers the "Error calculating targets"
      // view below; we log for telemetry.
      console.error('OnboardingResults: macro calculation failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStart = async () => {
    if (!macros) return;
    setSaving(true);
    try {
      // Save ALL onboarding data + macro targets to backend profile
      try {
        const { getOnboardingData } = await import('../../utils/onboardingStore');
        const quizData = await getOnboardingData();

        await profileApi.update({
          // Quiz answers
          sex: quizData.sex || null,
          dob: quizData.dob || null,
          current_weight: quizData.currentWeight || null,
          target_weight: quizData.targetWeight || null,
          height_cm: quizData.height || null,
          activity_level: quizData.activityLevel || null,
          primary_goal: quizData.primaryGoal || null,
          diet_type: quizData.dietType || null,
          meals_per_day: quizData.mealsPerDay || null,
          // Calculated targets
          tdee: macros.tdee,
          calorie_target: macros.calories,
          protein_target: macros.protein,
          carb_target: macros.carbs,
          fat_target: macros.fat,
          onboarding_completed: true,
        });
      } catch (err) {
        // Backend profile save failed — we still proceed to write the local
        // macro_targets + onboarding_complete flag so the user isn't stuck on
        // this screen. Next login will re-sync via /auth/me.
        console.error('OnboardingResults: profileApi.update failed', err);
      }

      // Save macro targets to AsyncStorage for the dashboard to read
      await AsyncStorage.setItem('macro_targets', JSON.stringify({
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        tdee: macros.tdee,
      }));

      // Mark onboarding complete — RootNavigator will now route to ClientNavigator
      await AsyncStorage.setItem('onboarding_complete', 'true');
      authEvents.emit();
    } catch (err: any) {
      // Catches the AsyncStorage.setItem failure paths above. Surface an alert
      // because this is a user-initiated action (the "Start" button) and silence
      // would leave them stuck on the results screen with no feedback.
      console.error('OnboardingResults: handleStart failed', err);
      Alert.alert("Couldn't finish setup", err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!macros) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Error calculating targets</Text>
      </View>
    );
  }

  const ringSize = 200;
  const strokeWidth = 12;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const proteinPct = macros.protein * 4 / macros.calories;
  const carbsPct = macros.carbs * 4 / macros.calories;
  const fatPct = macros.fat * 9 / macros.calories;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>The numbers.</Text>
      <Text style={styles.subtitle}>
        Calculated from what you shared.
      </Text>

      <View style={styles.ringContainer}>
        <Svg width={ringSize} height={ringSize}>
          <Circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            stroke={Colors.border}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            stroke={Colors.primary}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * 0.0}
            strokeLinecap="round"
            rotation="-90"
            origin={`${ringSize / 2}, ${ringSize / 2}`}
          />
        </Svg>
        <View style={styles.ringCenter}>
          <Text style={styles.calorieNumber}>{macros.calories}</Text>
          <Text style={styles.calorieLabel}>kcal / day</Text>
        </View>
      </View>

      <View style={styles.tdeeRow}>
        <Text style={styles.tdeeText}>
          TDEE: {macros.tdee} kcal → Target: {macros.calories} kcal
        </Text>
      </View>

      <View style={styles.macroRow}>
        <MacroCard
          label="Protein"
          grams={macros.protein}
          color={Colors.protein}
          pct={Math.round(proteinPct * 100)}
        />
        <MacroCard
          label="Carbs"
          grams={macros.carbs}
          color={Colors.carbs}
          pct={Math.round(carbsPct * 100)}
        />
        <MacroCard
          label="Fat"
          grams={macros.fat}
          color={Colors.fat}
          pct={Math.round(fatPct * 100)}
        />
      </View>

      <TouchableOpacity
        style={[styles.startButton, saving && styles.startButtonDisabled]}
        onPress={handleStart}
        disabled={saving}
        activeOpacity={0.8}
      >
        {saving ? (
          <ActivityIndicator color={Colors.textOnPrimary} />
        ) : (
          <Text style={styles.startButtonText}>Begin.</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function MacroCard({
  label,
  grams,
  color,
  pct,
}: {
  label: string;
  grams: number;
  color: string;
  pct: number;
}) {
  return (
    <View style={[macroStyles.card, { borderTopColor: color }]}>
      <Text style={[macroStyles.grams, { color }]}>{grams}g</Text>
      <Text style={macroStyles.label}>{label}</Text>
      <Text style={macroStyles.pct}>{pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
    paddingTop: 80,
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  errorText: {
    color: Colors.error,
    fontSize: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '500',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  ringContainer: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  calorieNumber: {
    fontSize: 42,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  calorieLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  tdeeRow: {
    marginBottom: 32,
  },
  tdeeText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  macroRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 40,
    width: '100%',
  },
  startButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 18,
    borderRadius: 4, // radius.lg
    alignItems: 'center',
    width: '100%',
  },
  startButtonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    color: Colors.textOnPrimary,
    fontSize: 20,
    fontWeight: '500',
  },
});

const macroStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    alignItems: 'center',
    gap: 4,
    borderTopWidth: 3,
  },
  grams: {
    fontSize: 24,
    fontWeight: '500',
  },
  label: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  pct: {
    fontSize: 12,
    color: Colors.textMuted,
  },
});
