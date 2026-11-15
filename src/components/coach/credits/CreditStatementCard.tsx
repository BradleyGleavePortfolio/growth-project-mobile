/**
 * The S3 "Concierge" statement card (CREDIT-S): an ink card with the small
 * "AI Usage:" label, the big serif amount, a hairline bar of the month's
 * use and "Renews Nov 1.". The ink is the theme's own text colour and the
 * words its page colour, so dark mode gets the same statement in reverse.
 * The bar fills once on open (600 ms ease-out), never with Reduce Motion
 * and not at all when nothing is used yet.
 * One accessible element: "AI Usage: $42 / $125. Renews Nov 1."
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, spacing, typography, withAlpha } from '../../../theme/tokens';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { clampPctForDisplay, type CoachAIBudgetResponse } from '../../../api/types/coachAIBudget';
import { CREDIT_USAGE_LABEL, renewsLine, usageAmount } from './creditCopy';

export type CreditCardBudget = Pick<
  CoachAIBudgetResponse,
  'used_displayed_cents' | 'total_displayed_cents' | 'pct_used' | 'period_end'
>;

export const FILL_MS = 600;

export default function CreditStatementCard({ budget, testID = 'credit-card' }: { budget: CreditCardBudget; testID?: string }) {
  const { semanticColors: sc } = useTheme();
  const reduced = useReducedMotion();
  const pct = clampPctForDisplay(budget.pct_used);
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || pct === 0) {
      fill.setValue(pct);
      return undefined;
    }
    const run = Animated.timing(fill, { toValue: pct, duration: FILL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [fill, pct, reduced]);

  const amount = usageAmount(budget);
  const renews = renewsLine(budget.period_end);
  const ink = sc.textPrimary;
  const paper = sc.bgPrimary;
  const quiet = withAlpha(paper, 0.72);
  const spoken = `${CREDIT_USAGE_LABEL} ${amount}.${renews ? ` ${renews}` : ''}`;
  return (
    <View
      style={[styles.card, { backgroundColor: ink }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={spoken}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      testID={testID}
    >
      <Text style={[styles.label, { color: quiet }]}>{CREDIT_USAGE_LABEL}</Text>
      <Text
        style={[styles.amount, { color: paper }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        maxFontSizeMultiplier={1.2}
        testID={`${testID}-amount`}
      >
        {amount}
      </Text>
      <View style={[styles.track, { backgroundColor: withAlpha(paper, 0.22) }]}>
        <Animated.View
          style={[styles.fill, { backgroundColor: paper, width: fill.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
          testID={`${testID}-fill`}
        />
      </View>
      {renews ? <Text style={[styles.renews, { color: quiet }]}>{renews}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg + spacing.xs },
  label: { ...typography.caption, letterSpacing: 0.6 },
  amount: { ...typography.display, marginTop: spacing.xs, fontVariant: ['lining-nums'] },
  track: { height: 2, marginTop: spacing.lg, overflow: 'hidden' },
  fill: { height: 2 },
  renews: { ...typography.bodySmall, marginTop: spacing.md },
});
