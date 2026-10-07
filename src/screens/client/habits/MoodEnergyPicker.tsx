import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { ENERGY_LABELS, MOOD_LABELS } from './constants';
import type { HabitsStyles } from './styles';

export function MoodEnergyPicker({
  mood,
  setMood,
  energy,
  setEnergy,
  sleepHours,
  setSleepHours,
  notes,
  setNotes,
  colors,
  styles,
}: {
  mood: number;
  setMood: (n: number) => void;
  energy: number;
  setEnergy: (n: number) => void;
  sleepHours: number;
  setSleepHours: React.Dispatch<React.SetStateAction<number>>;
  notes: string;
  setNotes: (s: string) => void;
  colors: ThemeColors;
  styles: HabitsStyles;
}) {
  return (
    <>
      {/* Mood */}
      <View style={styles.checkInCard}>
        <Text style={styles.checkInLabel}>How are you feeling?</Text>
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.ratingBtn, { minHeight: 44 }, mood === val && styles.ratingBtnActive]}
              onPress={() => setMood(val)}
              accessibilityRole="radio"
              accessibilityLabel={MOOD_LABELS[val]}
              accessibilityState={{ checked: mood === val }}
            >
              <Ionicons name={mood === val ? 'ellipse' : 'ellipse-outline'} size={16}
                color={mood === val ? colors.primary : colors.textMuted} />
              <Text style={[styles.ratingLabel, { fontSize: 12, letterSpacing: 0, textTransform: 'none' },
                mood === val && styles.ratingLabelActive]}>
                {MOOD_LABELS[val]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Energy */}
      <View style={styles.checkInCard}>
        <Text style={styles.checkInLabel}>Energy Level</Text>
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.ratingBtn, energy === val && styles.ratingBtnActive]}
              onPress={() => setEnergy(val)}
            >
              <Ionicons
                name="flash"
                size={20}
                color={energy === val ? colors.primary : colors.textMuted}
              />
              <Text style={[styles.ratingLabel, energy === val && styles.ratingLabelActive]}>
                {ENERGY_LABELS[val]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Sleep */}
      <View style={styles.checkInCard}>
        <Text style={styles.checkInLabel}>Sleep</Text>
        <View style={styles.sleepRow}>
          <View style={styles.sleepControl}>
            <Text style={styles.sleepLabel}>Hours</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setSleepHours((h) => Math.max(0, h - 0.5))}
              >
                <Ionicons name="remove" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{sleepHours}h</Text>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setSleepHours((h) => Math.min(14, h + 0.5))}
              >
                <Ionicons name="add" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Notes */}
      <View style={styles.checkInCard}>
        <Text style={styles.checkInLabel}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="How's your day going? Anything noteworthy?"
          placeholderTextColor={colors.textMuted}
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={500}
        />
      </View>
    </>
  );
}
