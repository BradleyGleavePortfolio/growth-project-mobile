import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { ENERGY_LABELS, MOOD_EMOJIS, MOOD_LABELS, STRESS_LABELS } from './constants';
import type { HabitsStyles } from './styles';

export function MoodEnergyPicker({
  mood,
  setMood,
  energy,
  setEnergy,
  sleepHours,
  setSleepHours,
  sleepQuality,
  setSleepQuality,
  stress,
  setStress,
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
  sleepQuality: number;
  setSleepQuality: (n: number) => void;
  stress: number;
  setStress: (n: number) => void;
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
              style={[styles.ratingBtn, mood === val && styles.ratingBtnActive]}
              onPress={() => setMood(val)}
            >
              <Text style={styles.ratingEmoji}>{MOOD_EMOJIS[val]}</Text>
              <Text style={[styles.ratingLabel, mood === val && styles.ratingLabelActive]}>
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
          <View style={styles.sleepControl}>
            <Text style={styles.sleepLabel}>Quality</Text>
            <View style={styles.qualityRow}>
              {[1, 2, 3, 4, 5].map((val) => (
                <TouchableOpacity key={val} onPress={() => setSleepQuality(val)}>
                  <Ionicons
                    name={val <= sleepQuality ? 'star' : 'star-outline'}
                    size={22}
                    color={val <= sleepQuality ? colors.warning : colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Stress */}
      <View style={styles.checkInCard}>
        <Text style={styles.checkInLabel}>Stress Level</Text>
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.ratingBtn, stress === val && styles.ratingBtnActive]}
              onPress={() => setStress(val)}
            >
              <View
                style={[
                  styles.stressDot,
                  {
                    backgroundColor:
                      val <= 2 ? colors.primary : val === 3 ? colors.warning : colors.error,
                    opacity: stress === val ? 1 : 0.4,
                  },
                ]}
              />
              <Text style={[styles.ratingLabel, stress === val && styles.ratingLabelActive]}>
                {STRESS_LABELS[val]}
              </Text>
            </TouchableOpacity>
          ))}
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
