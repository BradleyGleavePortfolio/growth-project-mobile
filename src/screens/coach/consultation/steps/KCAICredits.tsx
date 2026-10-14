/**
 * KC "Your AI credits." (CREDITBUILD-143; CREDIT-1 Concept 1 "A page in
 * setup" in the CREDIT-S S3 look): after K6/K7, before K8, head coaches
 * only. The ink statement card shows the real pool ("AI Usage: $0 / $125",
 * "Renews Nov 1."), Roman's N7 line once backend #971 is live, then what uses
 * the credits, what happens if they run out, and where to add more (or, on
 * builds that sell no packs, where to find them). One Continue; nothing on
 * this page charges or changes anything.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PrimaryButton } from '../../../../ui';
import { spacing } from '../../../../theme/tokens';
import { featureFlags } from '../../../../config/featureFlags';
import { RomanLine } from '../../../consultation/components';
import CreditStatementCard from '../../../../components/coach/credits/CreditStatementCard';
import CreditGuideRows from '../../../../components/coach/credits/CreditGuideRows';
import { CREDIT_ROMAN_ASK, CREDIT_SETUP_COPY, setupRows } from '../../../../components/coach/credits/creditCopy';
import { CoachStepFrame } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';

export default function KCAICredits({ onNext, onBack, onFinishLater, progress, eyebrow, credits }: CoachStepProps) {
  return (
    <CoachStepFrame
      progress={progress}
      eyebrow={eyebrow}
      headline={CREDIT_SETUP_COPY.title}
      onBack={onBack}
      onFinishLater={onFinishLater}
      footer={<PrimaryButton label={CREDIT_SETUP_COPY.cta} onPress={onNext} testID="kc-continue" />}
      testID="coach-step-KC"
    >
      {credits ? <CreditStatementCard budget={credits.budget} /> : null}
      {featureFlags.coachRomanNoDailyLimit ? <RomanLine text={CREDIT_ROMAN_ASK} size={40} /> : null}
      <View style={styles.rows}>
        <CreditGuideRows rows={setupRows(credits?.packsSold ?? false)} />
      </View>
    </CoachStepFrame>
  );
}

const styles = StyleSheet.create({
  rows: { marginTop: spacing.xl },
});
