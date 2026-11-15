/**
 * S3 group 12 with S2's three pack tiles (#CREDIT-S): one suggested pack, with
 * Roman's coverage sentence and the three tiles under it, the suggestion
 * chosen. Two full-width forest buttons follow: "Buy {amount} of credits" buys
 * the chosen tile; "Other amounts" (owner 10-19: a full dark green button, not
 * a subtitle) only opens the custom amount and then leaves (#161-8 op 1). The
 * field's own button reads "Enter an amount" and stays disabled until a valid
 * amount is typed. A tile tap closes the field and brings both buttons back.
 * The existing head-coach gate supplies the pace; this view never calculates a
 * pace or changes checkout. Without a suggestion, keep the original row. The
 * screen owns the choice, so a cancelled or failed checkout comes back to the
 * same tile or the same open custom amount.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, spacing, typography } from '../../../theme/tokens';
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
  /** The typed amount when it is a valid custom pack (inside the server bounds), else null. */
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
      {custom ? (
        <View style={styles.stack} testID="credit-pack-other-amounts">
          {customField}
          <PrimaryButton
            label={customCents == null ? CREDIT_MOMENT_COPY.enterAmount : buyAmountLabel(customCents)}
            disabled={customCents == null}
            onPress={() => onSelect('custom')}
            testID="ai-pack-option-custom"
          />
        </View>
      ) : (
        <>
          <PrimaryButton label={buyAmountLabel(pack)} onPress={() => onSelect(pack)} testID="credit-pack-buy" />
          <PrimaryButton
            label={CREDIT_MOMENT_COPY.otherAmounts}
            expanded={false}
            onPress={() => onChoice({ ...choice, custom: true })}
            testID="credit-pack-other"
          />
        </>
      )}
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
  tiles: { marginTop: spacing.lg },
  fine: { ...typography.bodySmall },
});
