/**
 * K1 Your card (prototype 78): the only form screen. A live preview of the
 * card clients see sits above the fields; monogram in v1 (decision D9).
 * Name required (1-80); business name and the one-line pitch are optional.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../../../ui/buttons/PrimaryButton';
import { useTheme } from '../../../../theme/ThemeProvider';
import { radius, spacing, typography } from '../../../../theme/tokens';
import { QuietOverline } from '../../../../ui/sections/QuietSection';
import { BIO_MAX, BUSINESS_MAX, NAME_MAX, cardValid } from '../../../../lib/coachConsultation/flow';
import { CoachStepFrame, Field } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';

export const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export default function K1Card({ answers, setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const { semanticColors: sc } = useTheme();
  const name = answers.display_name ?? '';
  const business = answers.business_name ?? '';
  return (
    <CoachStepFrame
      testID="coach-consult-K1"
      progress={progress}
      eyebrow={eyebrow}
      headline="How should clients see you?"
      onBack={onBack}
      onFinishLater={onFinishLater}
      footer={<PrimaryButton label="Continue" onPress={onNext} disabled={!cardValid(answers)} testID="coach-consult-K1-cta" />}
    >
      <View
        style={[styles.card, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}
        accessible
        accessibilityLabel={`Preview of your card: ${name.trim() || 'your name'}${business.trim() ? `, ${business.trim()}` : ''}`}
        testID="coach-consult-K1-preview"
      >
        <View style={[styles.mono, { borderColor: sc.border, backgroundColor: sc.bgPrimary }]}>
          <Text style={[styles.monoText, { color: sc.textPrimary }]}>{initialsOf(name)}</Text>
        </View>
        <View style={styles.cardText}>
          <QuietOverline numberOfLines={1}>{business.trim() || 'Your business'}</QuietOverline>
          <Text style={[styles.cardName, { color: sc.textPrimary }]} numberOfLines={2}>
            {name.trim() || 'Your name'}
          </Text>
        </View>
      </View>
      <Field label="Your name" value={name} onChange={(t) => setAnswers({ display_name: t })} maxLength={NAME_MAX}
        autoCapitalize="words" testID="coach-consult-K1-name" />
      <Field label="Business name (optional)" value={business} onChange={(t) => setAnswers({ business_name: t })}
        maxLength={BUSINESS_MAX} autoCapitalize="words" testID="coach-consult-K1-business" />
      <Field label="In a sentence or two, how do you help people? (optional)" value={answers.bio ?? ''}
        onChange={(t) => setAnswers({ bio: t })} maxLength={BIO_MAX} multiline testID="coach-consult-K1-bio" />
    </CoachStepFrame>
  );
}

const hairline = StyleSheet.hairlineWidth;
const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderWidth: hairline, borderRadius: radius.card },
  mono: { width: 56, height: 56, borderRadius: radius.chip, borderWidth: hairline, alignItems: 'center', justifyContent: 'center' },
  monoText: { ...typography.h3 },
  cardText: { flex: 1, gap: 6 },
  cardName: { ...typography.h2 },
});
