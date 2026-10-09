/**
 * K8 Practice ready (prototype 85): summary sentences, Roman's hand-off line and one button, "Show me around" (onNext:
 * the flow completes on the server and lands on Clients, 86 K-LAND). No bar, no Finish later; spinner while completing.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, QuietOverline } from '../../../../ui';
import { useTheme } from '../../../../theme/ThemeProvider';
import { spacing, typography } from '../../../../theme/tokens';
import { RomanLine } from '../../../consultation/components';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { linkLoadedFor } from './K6PersonalLink';
import { CoachStepFrame } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';
import { K8_COPY, practiceSummary, specialtyLabels } from './practiceCopy';

export default function K8PracticeReady({ answers, onNext, onBack, eyebrow, firstName, completing }: CoachStepProps) {
  const { semanticColors: sc } = useTheme();
  const user = useCurrentUser();
  const sections = practiceSummary({
    linkLoaded: linkLoadedFor(user?.id),
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
      footer={<PrimaryButton label={K8_COPY.cta} onPress={onNext} loading={completing} testID="k8-show-me-around" />}
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
});
