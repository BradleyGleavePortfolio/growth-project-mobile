/**
 * K7 Import offer (prototype 84): "Bring your existing clients over?"
 * The flow shows it only when featureFlags.extensionImport is on and the
 * coach has clients today (`isStepVisible`, flow.ts); with the flag off (every
 * build today) it is skipped and the bar stays at 5 with no dead end.
 * "Show me how" records `import_choice: 'show_me'` and moves on (the importer
 * opens after the consultation, from Settings > Import my records);
 * "Do this later" records 'later'. Both are local only, never sent.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { PrimaryButton, TextLink } from '../../../../ui';
import { useTheme } from '../../../../theme/ThemeProvider';
import { typography } from '../../../../theme/tokens';
import { CoachStepFrame } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';
import { K7_COPY } from './practiceCopy';

export default function K7ImportOffer({ setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const { semanticColors: sc } = useTheme();
  const choose = (choice: 'show_me' | 'later') => {
    setAnswers({ import_choice: choice });
    onNext();
  };
  return (
    <CoachStepFrame
      progress={progress}
      eyebrow={eyebrow}
      headline={K7_COPY.question}
      onBack={onBack}
      onFinishLater={onFinishLater}
      footer={
        <>
          <PrimaryButton label={K7_COPY.cta} onPress={() => choose('show_me')} testID="k7-show-me" />
          <TextLink label={K7_COPY.later} onPress={() => choose('later')} testID="k7-later" />
        </>
      }
      testID="coach-step-K7"
    >
      <Text style={[styles.why, { color: sc.textMuted }]}>{K7_COPY.why}</Text>
    </CoachStepFrame>
  );
}

const styles = StyleSheet.create({ why: { ...typography.bodySmall } });
