import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';

// All muscle groups including new ones from seed
export const MUSCLES = [
  'All',
  'chest',
  'back',
  'shoulders',
  'legs',
  'biceps',
  'triceps',
  'core',
  'full body',
  'cardio',
  'stretching',
];

// Muscle-group palette — built from theme colors at component scope so the
// mapping always reflects the active theme.
export function makeMuscleColors(colors: ThemeColors): Record<string, string> {
  return {
    chest: colors.error,
    back: colors.info,
    shoulders: colors.warning,
    legs: colors.muscleLegs,
    biceps: colors.streak,
    triceps: colors.muscleTriceps,
    core: colors.muscleCore,
    'full body': colors.muscleFullBody,
    cardio: colors.muscleCardio,
    stretching: colors.textMuted,
  };
}

export function lookupMuscleColor(map: Record<string, string>, muscle: string, fallback: string): string {
  return map[muscle.toLowerCase()] ?? fallback;
}

interface ExerciseImageProps {
  imageUrl?: string;
  muscle: string;
  size?: number;
}

export function ExerciseImage({ imageUrl, muscle, size = 80 }: ExerciseImageProps) {
  const { colors } = useTheme();
  const muscleColors = useMemo(() => makeMuscleColors(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const bgColor = lookupMuscleColor(muscleColors, muscle, colors.textSecondary);

  if (!imageUrl || error) {
    return (
      <View
        style={[
          exerciseImageStyles.placeholder,
          { width: size, height: size, borderRadius: 4, backgroundColor: bgColor },
        ]}
      >
        <Ionicons name="barbell-outline" size={size * 0.45} color="rgba(255,255,255,0.9)" />
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size, borderRadius: 4, overflow: 'hidden' }}>
      {loading && (
        <View
          style={[
            exerciseImageStyles.skeleton,
            { width: size, height: size, borderRadius: 4, backgroundColor: bgColor + '33' },
          ]}
        >
          <ActivityIndicator size="small" color={bgColor} />
        </View>
      )}
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size, borderRadius: 4 }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </View>
  );
}

export const exerciseImageStyles = StyleSheet.create({
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  skeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
});
