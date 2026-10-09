/** K4 Coaching touch (prototype 81): optional, one choice, moves on by itself; Skip. Feeds Roman's coach context. */
import React from 'react';
import { View } from 'react-native';
import { TextLink } from '../../../../ui/buttons/PrimaryButton';
import { COACHING_TOUCH_OPTIONS } from '../../../../lib/coachConsultation/flow';
import { ChoiceRow, CoachStepFrame } from '../CoachStepFrame';
import { useAutoAdvance } from './useAutoAdvance';
import type { CoachStepProps } from '../types';

export default function K4CoachingTouch({ answers, setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const advance = useAutoAdvance(onNext);
  const skip = () => {
    setAnswers({ coaching_touch: undefined });
    onNext();
  };
  return (
    <CoachStepFrame
      testID="coach-consult-K4"
      progress={progress}
      eyebrow={eyebrow}
      headline="How hands-on do you like to be?"
      onBack={onBack}
      onFinishLater={onFinishLater}
      footer={<TextLink label="Skip" onPress={skip} testID="coach-consult-K4-skip" />}
    >
      <View accessibilityRole="radiogroup">
        {COACHING_TOUCH_OPTIONS.map((o) => (
          <ChoiceRow
            key={o.value}
            label={o.label}
            sub={o.sub}
            selected={answers.coaching_touch === o.value}
            onPress={() => {
              setAnswers({ coaching_touch: o.value });
              advance();
            }}
            testID={`coach-consult-K4-${o.value}`}
          />
        ))}
      </View>
    </CoachStepFrame>
  );
}
