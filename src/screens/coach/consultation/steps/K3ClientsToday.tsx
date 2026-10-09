/** K3 Clients today (prototype 80): required, one choice, moves on by itself. Gates K7 (only with clients today). */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../../../theme/tokens';
import { CLIENTS_TODAY_OPTIONS } from '../../../../lib/coachConsultation/flow';
import { ChoiceChip, CoachStepFrame } from '../CoachStepFrame';
import { useAutoAdvance } from './useAutoAdvance';
import type { CoachStepProps } from '../types';

export default function K3ClientsToday({ answers, setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const advance = useAutoAdvance(onNext);
  return (
    <CoachStepFrame
      testID="coach-consult-K3"
      progress={progress}
      eyebrow={eyebrow}
      headline="How many clients do you coach today?"
      onBack={onBack}
      onFinishLater={onFinishLater}
    >
      <View style={styles.chips} accessibilityRole="radiogroup">
        {CLIENTS_TODAY_OPTIONS.map((o) => (
          <ChoiceChip
            key={o.value}
            single
            label={o.label}
            selected={answers.clients_today === o.value}
            onPress={() => {
              setAnswers({ clients_today: o.value });
              advance();
            }}
            testID={`coach-consult-K3-${o.value}`}
          />
        ))}
      </View>
    </CoachStepFrame>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
