/** K2 Specialties (prototype 79): optional, up to five; shown later on the invite preview. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, TextLink } from '../../../../ui/buttons/PrimaryButton';
import { useTheme } from '../../../../theme/ThemeProvider';
import { spacing, typography } from '../../../../theme/tokens';
import { SPECIALTY_CAP, SPECIALTY_OPTIONS, toggleSpecialty } from '../../../../lib/coachConsultation/flow';
import { ChoiceChip, CoachStepFrame } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';

export default function K2Specialties({ answers, setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const { semanticColors: sc } = useTheme();
  const chosen = answers.specialties ?? [];
  const full = chosen.length >= SPECIALTY_CAP;
  return (
    <CoachStepFrame
      testID="coach-consult-K2"
      progress={progress}
      eyebrow={eyebrow}
      sub="Choose up to five."
      headline="What do you specialise in?"
      onBack={onBack}
      onFinishLater={onFinishLater}
      footer={
        <>
          <TextLink
            label="Skip"
            onPress={() => {
              setAnswers({ specialties: [] });
              onNext();
            }}
            testID="coach-consult-K2-skip"
          />
          <PrimaryButton label="Continue" onPress={onNext} disabled={chosen.length === 0} testID="coach-consult-K2-cta" />
        </>
      }
    >
      <View style={styles.chips}>
        {SPECIALTY_OPTIONS.map((o) => (
          <ChoiceChip
            key={o.value}
            label={o.label}
            selected={chosen.includes(o.value)}
            capped={full}
            onPress={() => setAnswers({ specialties: toggleSpecialty(chosen, o.value) })}
            testID={`coach-consult-K2-${o.value}`}
          />
        ))}
      </View>
      {full ? (
        <Text style={[styles.note, { color: sc.textMuted }]} testID="coach-consult-K2-cap">
          That is five. Remove one to choose another.
        </Text>
      ) : null}
    </CoachStepFrame>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  note: { ...typography.bodySmall, marginTop: spacing.md },
});
