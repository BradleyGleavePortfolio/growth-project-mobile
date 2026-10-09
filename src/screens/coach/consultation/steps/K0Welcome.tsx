/** K0 Welcome (prototype 77): same template as the client W1; Roman sets the two-minute expectation. */
import React from 'react';
import { StyleSheet } from 'react-native';
import { Screen } from '../../../../ui/layout/Screen';
import { PrimaryButton } from '../../../../ui/buttons/PrimaryButton';
import { Headline } from '../../../../ui/text/Headline';
import { QuietOverline } from '../../../../ui/sections/QuietSection';
import { RomanLine } from '../../../consultation/components';
import { spacing } from '../../../../theme/tokens';
import type { CoachStepProps } from '../types';

export const K0_ROMAN =
  "I'm Roman. Let's set up your practice so your first client has somewhere good to land. About two minutes.";

export default function K0Welcome({ firstName, eyebrow, onNext }: CoachStepProps) {
  return (
    <Screen
      testID="coach-consult-K0"
      footer={<PrimaryButton label="Set up my practice" onPress={onNext} testID="coach-consult-K0-cta" />}
    >
      <QuietOverline style={styles.eyebrow}>{eyebrow}</QuietOverline>
      <Headline level="display" style={styles.headline} testID="coach-consult-K0-title">
        {firstName ? `Welcome,\n${firstName}.` : 'Welcome.'}
      </Headline>
      <RomanLine text={K0_ROMAN} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginTop: spacing['3xl'] },
  headline: { marginTop: spacing.lg, marginBottom: spacing.sm },
});
