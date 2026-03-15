import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useAuthStore } from '../../store/authStore';
import { getProfileByUserId, updateProfile } from '../../db/profileDb';
import { calcBMR, calcTDEE, calcMacros, calculateAge } from '../../utils/nutrition';
import { Colors } from '../../constants/colors';
import { ClientProfile } from '../../types';

export default function OnboardingResults() {
  const { currentUser, refreshProfile } = useAuthStore();
  const [profile, setProfile] = useState<ClientProfile | null>(null);
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
    if (!currentUser) return;
    try {
      const p = await getProfileByUserId(currentUser.id);
      if (!p) return;
      setProfile(p);

      const age = p.dob ? calculateAge(p.dob) : 25;
      const weight = p.currentWeight || 180;
      const height = p.height || 175;
      const sex = p.sex || 'male';
      const activity = p.activityLevel || 'moderate';
      const goal = p.primaryGoal || 'maintain';

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
      console.error('calc error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStart = async () => {
    if (!currentUser || !macros) return;
    setSaving(true);
    try {
      await updateProfile(currentUser.id, {
        tdee: macros.tdee,
        calorieTarget: macros.calories,
        proteinTarget: macros.protein,
        carbTarget: macros.carbs,
        fatTarget: macros.fat,
        onboardingCompleted: true,
      });
      await refreshProfile();
    } catch (err) {
      console.error('save error:', err);
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
      <Text style={styles.title}>Your Plan is Ready</Text>
      <Text style={styles.subtitle}>
        Based on your profile, here are your daily targets
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
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.startButtonText}>Start My Journey</Text>
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
    fontWeight: '800',
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
    fontWeight: '800',
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
    borderRadius: 14,
    alignItems: 'center',
    width: '100%',
  },
  startButtonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
});

const macroStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
    borderTopWidth: 3,
  },
  grams: {
    fontSize: 24,
    fontWeight: '800',
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
