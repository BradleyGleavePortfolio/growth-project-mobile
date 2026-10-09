import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { Overline, QuietSection } from '../../../ui';
import type { SemanticTokens } from '../../../theme/tokens';
import { ENERGY_LABELS, MOOD_LABELS } from './constants';
import type { HabitsStyles } from './styles';

const SCALE = [1, 2, 3, 4, 5];

/** Five quiet radio dots with a word under each (no emoji, no colour code). */
function RatingRow({
  value,
  onChange,
  labels,
  styles,
}: {
  value: number;
  onChange: (n: number) => void;
  labels: string[];
  styles: HabitsStyles;
}) {
  return (
    <View style={styles.ratingRow} accessibilityRole="radiogroup">
      {SCALE.map((val) => {
        const on = value === val;
        return (
          <Pressable
            key={val}
            style={({ pressed }) => [styles.ratingBtn, pressed && styles.pressed]}
            onPress={() => {
              void HapticService.selection();
              onChange(val);
            }}
            accessibilityRole="radio"
            accessibilityLabel={labels[val]}
            accessibilityState={{ checked: on }}
          >
            <View style={[styles.ratingDot, on && styles.ratingDotActive]} />
            <Text style={[styles.ratingLabel, on && styles.ratingLabelActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {labels[val]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MoodEnergyPicker({
  mood,
  setMood,
  energy,
  setEnergy,
  sleepHours,
  setSleepHours,
  notes,
  setNotes,
  sc,
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
  sc: SemanticTokens;
  styles: HabitsStyles;
}) {
  return (
    <>
      <QuietSection>
        <Overline>Mood</Overline>
        <Text style={styles.prompt}>How are you feeling?</Text>
        <RatingRow value={mood} onChange={setMood} labels={MOOD_LABELS} styles={styles} />
      </QuietSection>

      <QuietSection>
        <Overline>Energy</Overline>
        <Text style={styles.prompt}>How is your energy?</Text>
        <RatingRow value={energy} onChange={setEnergy} labels={ENERGY_LABELS} styles={styles} />
      </QuietSection>

      <QuietSection>
        <Overline>Sleep</Overline>
        <Text style={styles.prompt}>Hours slept last night</Text>
        <View style={styles.stepperRow}>
          <HapticPressable
            intent="light"
            disableAnimation
            style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Decrease sleep hours"
            onPress={() => setSleepHours((h) => Math.max(0, h - 0.5))}
          >
            <Ionicons name="remove" size={18} color={sc.textPrimary} />
          </HapticPressable>
          <Text style={styles.stepperValue} accessibilityLiveRegion="polite">{sleepHours}h</Text>
          <HapticPressable
            intent="light"
            disableAnimation
            style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Increase sleep hours"
            onPress={() => setSleepHours((h) => Math.min(14, h + 0.5))}
          >
            <Ionicons name="add" size={18} color={sc.textPrimary} />
          </HapticPressable>
        </View>
      </QuietSection>

      <QuietSection>
        <Overline>Notes</Overline>
        <TextInput
          style={styles.notesInput}
          accessibilityLabel="Check-in notes"
          placeholder="Anything worth noting about today"
          placeholderTextColor={sc.textMuted}
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={500}
        />
      </QuietSection>
    </>
  );
}
