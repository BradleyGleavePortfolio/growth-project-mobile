/**
 * S3 group 12: one suggested pack, with other amounts disclosed on request.
 * The existing head-coach gate supplies the pace; this view never calculates
 * a pace or changes checkout. Without a suggestion, keep the original row.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, spacing, typography } from '../../../theme/tokens';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { formatCents } from '../../../api/types/coachAIBudget';
import { CREDIT_PACK_NON_REFUNDABLE } from '../../../config/purchaseSurfaces';
import { renewalDay } from '../../../screens/coach/settings/AICreditsRow';
import { PackOptionsRow } from '../ai-budget/PackOptionsRow';
import { useCoachCredits } from './useCoachCredits';
import { paceOf } from './creditPace';
import { buyAmountLabel, CREDIT_MOMENT_COPY, packTileLabel } from './creditCopy';

export default function CreditPackSelection({
  options,
  onSelect,
  customField,
  customCents,
  initiallyCustom,
}: {
  options: number[];
  onSelect: (choice: number | 'custom') => void;
  customField: React.ReactNode;
  customCents: number | null;
  initiallyCustom: boolean;
}) {
  const { semanticColors: sc } = useTheme();
  const credits = useCoachCredits();
  const suggestion = credits?.packsSold ? paceOf(credits.budget)?.suggestedCents : null;
  const renews = credits ? renewalDay(credits.budget.period_end) : null;
  const [expanded, setExpanded] = useState(initiallyCustom);
  const [custom, setCustom] = useState(initiallyCustom);
  if (suggestion == null || !renews) {
    return (
      <>
        <PackOptionsRow options={options} onSelect={onSelect} selected={9900} />
        {customField}
      </>
    );
  }
  const roman = `A ${formatCents(suggestion)} pack should cover you until ${renews}.`;
  return (
    <View style={styles.stack}>
      <View style={[styles.card, { backgroundColor: sc.textPrimary }]} testID="credit-pack-suggested">
        <Text style={[styles.caption, { color: sc.bgPrimary }]}>Suggested</Text>
        <Text style={[styles.amount, { color: sc.bgPrimary }]}>{formatCents(suggestion)}</Text>
        <Text style={[styles.roman, { color: sc.bgPrimary }]}>{roman}</Text>
      </View>
      {!custom ? (
        <PrimaryButton label={buyAmountLabel(suggestion)} onPress={() => onSelect(suggestion)} testID="credit-pack-buy" />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CREDIT_MOMENT_COPY.otherAmounts}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(true)}
        style={styles.other}
        testID="credit-pack-other"
      >
        <Text style={[styles.otherLabel, { color: sc.textPrimary }]}>{CREDIT_MOMENT_COPY.otherAmounts}</Text>
      </Pressable>
      {expanded ? (
        <View testID="credit-pack-other-amounts">
          {options.filter((cents) => cents !== suggestion).map((cents) => (
            <Pressable
              key={cents}
              accessibilityRole="button"
              accessibilityLabel={packTileLabel(cents)}
              onPress={() => { void HapticService.selection(); onSelect(cents); }}
              style={({ pressed }) => [styles.row, { borderColor: sc.border }, pressed && styles.pressed]}
              testID={`ai-pack-option-${cents}`}
            >
              <Text style={[styles.price, { color: sc.textPrimary }]}>{formatCents(cents)}</Text>
              <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Custom amount"
            accessibilityState={{ expanded: custom }}
            onPress={() => { void HapticService.selection(); setCustom(true); }}
            style={({ pressed }) => [styles.row, { borderColor: sc.border }, pressed && styles.pressed]}
            testID="credit-pack-custom-open"
          >
            <Text style={[styles.custom, { color: sc.textPrimary }]}>Custom amount</Text>
            <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
          </Pressable>
          {custom ? (
            <View style={styles.stack}>
              {customField}
              <PrimaryButton
                label={customCents == null ? 'Custom' : buyAmountLabel(customCents)}
                onPress={() => onSelect('custom')}
                testID="ai-pack-option-custom"
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.fine, { color: sc.textMuted }]} testID="ai-pack-non-refundable">
        {CREDIT_PACK_NON_REFUNDABLE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: { padding: spacing.xl, borderRadius: radius.card },
  caption: { ...typography.caption },
  amount: { ...typography.display, fontVariant: ['lining-nums'], marginTop: spacing.xs },
  roman: { ...typography.bodySmall, marginTop: spacing.md },
  other: { minHeight: layout.touchMin, minWidth: layout.touchMin, justifyContent: 'center', marginTop: spacing.sm },
  otherLabel: { ...typography.h3, fontFamily: 'CormorantGaramond_400Regular_Italic' },
  row: { minHeight: layout.rowMinHeight, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  price: { ...typography.bodyMd, fontVariant: ['tabular-nums'] },
  custom: { ...typography.bodyMd },
  fine: { ...typography.bodySmall },
  pressed: { opacity: 0.85 },
});
