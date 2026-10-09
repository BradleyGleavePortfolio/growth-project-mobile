/**
 * K5 Programming style (prototype 82): "How do you usually build programs?"
 * Optional, three radio rows, chapter 4 position 2 of 2. A tap saves the
 * choice and moves on after a short beat so the filled radio is seen (no
 * beat with Reduce Motion on); Skip moves on without an answer. Saved as
 * `programming_style` (own | templates | help), the backend vocabulary.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { TextLink } from '../../../../ui';
import { useReducedMotion } from '../../../../hooks/useReducedMotion';
import { ChoiceRow, CoachStepFrame } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';
import { PROGRAMMING_STYLE_OPTIONS } from '../../../../lib/coachConsultation/flow';
import type { ProgrammingStyle } from '../../../../lib/coachConsultation/types';
import { K5_COPY } from './practiceCopy';

/** The beat between the tap and the next step (calm motion, under 300 ms). */
export const K5_ADVANCE_MS = 220;

export default function K5ProgrammingStyle({ answers, setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const reduced = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaving = useRef(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const choose = useCallback(
    (value: ProgrammingStyle) => {
      if (leaving.current) return;
      leaving.current = true;
      setAnswers({ programming_style: value });
      if (reduced) {
        onNext();
        return;
      }
      timer.current = setTimeout(onNext, K5_ADVANCE_MS);
    },
    [onNext, reduced, setAnswers],
  );

  const skip = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    onNext();
  }, [onNext]);

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
            onPress={() => choose(o.value)}
            testID={`k5-${o.value}`}
          />
        ))}
      </View>
    </CoachStepFrame>
  );
}
