/**
 * K8 Practice ready (prototype 85): the summary sentences (T-F light) of the
 * coach's card, specialties and link, Roman's hand-off line and one button,
 * "Show me around". No chapter bar and no Finish later. The button calls
 * onNext, which completes the consultation on the server (BE sets the coach's
 * consultation completed time) and lands on Clients (86 K-LAND, decision
 * D13); while that runs the button shows a spinner and ignores presses, and
 * a failed completion shows the flow's specific message above it.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, QuietOverline } from '../../../../ui';
import { useTheme } from '../../../../theme/ThemeProvider';
import { spacing, typography } from '../../../../theme/tokens';
import { RomanLine } from '../../../consultation/components';
import { CoachStepFrame } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';
import { K8_COPY, practiceSummary, specialtyLabels } from './practiceCopy';

export default function K8PracticeReady({ answers, onNext, onBack, eyebrow, firstName, completing, completeError }: CoachStepProps) {
  const { semanticColors: sc } = useTheme();
  const sections = practiceSummary({
    name: answers.display_name?.trim() || firstName,
    business: answers.business_name,
    specialtyLabels: specialtyLabels(answers.specialties),
  });
  return (
    <CoachStepFrame
      progress={null}
      eyebrow={eyebrow}
      headline={K8_COPY.question}
      onBack={completing ? null : onBack}
      footer={
        <>
          {completeError ? (
            <Text
              style={[styles.problem, { color: sc.textPrimary }]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="k8-complete-error"
            >
              {completeError}
            </Text>
          ) : null}
          <PrimaryButton label={K8_COPY.cta} onPress={onNext} loading={completing} testID="k8-show-me-around" />
        </>
      }
      testID="coach-step-K8"
    >
      <View style={styles.summary} testID="k8-summary">
        {sections.map((sec) => (
          <View key={sec.key} style={[styles.section, { borderBottomColor: sc.border }]} testID={`k8-${sec.key}`}>
            <QuietOverline>{sec.label}</QuietOverline>
            <Text style={[styles.sentence, { color: sc.textPrimary }]}>{sec.sentence}</Text>
          </View>
        ))}
      </View>
      <RomanLine text={K8_COPY.roman} />
    </CoachStepFrame>
  );
}

const styles = StyleSheet.create({
  summary: { marginTop: spacing.lg },
  section: { paddingVertical: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  sentence: { ...typography.h3 },
  problem: { ...typography.bodySmall, textAlign: 'center' },
});
