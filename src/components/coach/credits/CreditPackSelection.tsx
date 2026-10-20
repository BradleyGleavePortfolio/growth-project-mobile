/**
 * S3 group 12 with S2's three pack tiles (#CREDIT-S): one suggested pack, with
 * Roman's coverage sentence and the three tiles under it, the suggestion
 * chosen. The one primary button buys the chosen tile; "Other amounts" opens
 * the custom amount. The existing head-coach gate supplies the pace; this view
 * never calculates a pace or changes checkout. Without a suggestion, keep the
 * original row. The screen owns the choice, so a cancelled or failed checkout
 * comes back to the same tile or the same open custom amount.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, spacing, typography } from '../../../theme/tokens';
import { PrimaryButton } from '../../../ui/buttons/PrimaryButton';
import { formatCents } from '../../../api/types/coachAIBudget';
import { CREDIT_PACK_NON_REFUNDABLE } from '../../../config/purchaseSurfaces';
import { renewalDay } from '../../../screens/coach/settings/AICreditsRow';
import { PackOptionsRow } from '../ai-budget/PackOptionsRow';
import { useCoachCredits } from './useCoachCredits';
import { paceOf } from './creditPace';
import CreditPackTiles from './CreditPackTiles';
import { buyAmountLabel, CREDIT_MOMENT_COPY } from './creditCopy';

/** The chosen tile (null = the suggestion) and whether Other amounts is open. */
export type PackChoice = { cents: number | null; custom: boolean };

export default function CreditPackSelection({
  options,
  onSelect,
  customField,
  customCents,
  choice,
  onChoice,
}: {
  options: number[];
  onSelect: (choice: number | 'custom') => void;
  customField: React.ReactNode;
  customCents: number | null;
  choice: PackChoice;
  onChoice: (choice: PackChoice) => void;
}) {
  const { semanticColors: sc } = useTheme();
  const credits = useCoachCredits();
  const suggestion = credits?.packsSold ? paceOf(credits.budget)?.suggestedCents : null;
  const renews = credits ? renewalDay(credits.budget.period_end) : null;
  const packs = useMemo(() => [...options].sort((x, y) => x - y), [options]);
  const { custom } = choice;
  if (suggestion == null || !renews) {
    return (
      <>
        <PackOptionsRow options={options} onSelect={onSelect} selected={9900} />
        {customField}
      </>
    );
  }
  const pack = choice.cents ?? suggestion;
  const roman = `A ${formatCents(suggestion)} pack should cover you until ${renews}.`;
  return (
    <View style={styles.stack}>
      <View style={[styles.card, { backgroundColor: sc.textPrimary }]} testID="credit-pack-suggested">
        <Text style={[styles.caption, { color: sc.bgPrimary }]}>Suggested</Text>
        <Text style={[styles.amount, { color: sc.bgPrimary }]}>{formatCents(suggestion)}</Text>
        <Text style={[styles.roman, { color: sc.bgPrimary }]}>{roman}</Text>
        <View style={styles.tiles}>
          <CreditPackTiles packs={packs} selected={custom ? null : pack} onSelect={(cents) => onChoice({ cents, custom: false })} onInk />
        </View>
      </View>
      {!custom ? (
        <PrimaryButton label={buyAmountLabel(pack)} onPress={() => onSelect(pack)} testID="credit-pack-buy" />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CREDIT_MOMENT_COPY.otherAmounts}
        accessibilityState={{ expanded: custom }}
        onPress={() => onChoice({ ...choice, custom: !custom })}
        style={styles.other}
        testID="credit-pack-other"
      >
        <Text style={[styles.otherLabel, { color: sc.textPrimary }]}>{CREDIT_MOMENT_COPY.otherAmounts}</Text>
      </Pressable>
      {custom ? (
        <View style={styles.stack} testID="credit-pack-other-amounts">
          {customField}
          <PrimaryButton
            label={customCents == null ? 'Custom' : buyAmountLabel(customCents)}
            onPress={() => onSelect('custom')}
            testID="ai-pack-option-custom"
          />
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
  tiles: { marginTop: spacing.lg },
  fine: { ...typography.bodySmall },
});
