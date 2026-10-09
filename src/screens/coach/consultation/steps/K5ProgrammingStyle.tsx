/**
 * K5 Programming style (prototype 82): "How do you usually build programs?"
 * Optional, three radio rows, chapter 4 position 2 of 2. Same pattern as K4:
 * a tap saves `programming_style` (own | templates | help, the backend
 * vocabulary) and moves on a moment later (useAutoAdvance; another tap
 * changes the choice); Skip clears it and moves on.
 */
import React from 'react';
import { View } from 'react-native';
import { TextLink } from '../../../../ui';
import { PROGRAMMING_STYLE_OPTIONS } from '../../../../lib/coachConsultation/flow';
import { ChoiceRow, CoachStepFrame } from '../CoachStepFrame';
import { useAutoAdvance } from './useAutoAdvance';
import type { CoachStepProps } from '../types';
import { K5_COPY } from './practiceCopy';

export default function K5ProgrammingStyle({ answers, setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const advance = useAutoAdvance(onNext);
  const skip = () => {
    setAnswers({ programming_style: undefined });
    onNext();
  };
  return (
    <CoachStepFrame
      progress={progress}
      eyebrow={eyebrow}
      headline={K5_COPY.question}
      onBack={onBack}
      onFinishLater={onFinishLater}
      footer={<TextLink label={K5_COPY.skip} onPress={skip} testID="k5-skip" />}
      testID="coach-step-K5"
    >
      <View accessibilityRole="radiogroup">
        {PROGRAMMING_STYLE_OPTIONS.map((o) => (
          <ChoiceRow
            key={o.value}
            label={o.label}
            selected={answers.programming_style === o.value}
            onPress={() => {
              setAnswers({ programming_style: o.value });
              advance();
            }}
            testID={`k5-${o.value}`}
          />
        ))}
      </View>
    </CoachStepFrame>
  );
}
