/**
 * The 80 % "Your AI credits are low." and 100 % "Your AI credits are used
 * up." sheets (CREDIT-W moments in the CREDIT-S hybrid): S3's ink statement
 * card and Roman pace line, then, on builds that sell packs, S2's three pack
 * tiles with the suggested pack chosen, "New balance", the non-refundable
 * line and one "Buy {amount} of credits", with "Other amounts" and "Not
 * now". Builds that sell no packs get one "Got it". Nothing is bought here:
 * Buy opens the existing pack checkout with that pack.
 */
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, spacing, typography } from '../../../theme/tokens';
import { Headline, PrimaryButton, TextLink } from '../../../ui';
import { RomanLine } from '../../../screens/consultation/components';
import { formatCents } from '../../../api/types/coachAIBudget';
import { CREDIT_PACK_NON_REFUNDABLE } from '../../../config/purchaseSurfaces';
import CreditStatementCard from './CreditStatementCard';
import CreditPackTiles from './CreditPackTiles';
import { CREDIT_MOMENT_COPY, buyAmountLabel } from './creditCopy';
import { paceLine, preselectedPack, type Moment } from './creditPace';
import type { CoachCredits } from './useCoachCredits';

export interface CreditMomentSheetProps {
  moment: Moment;
  credits: CoachCredits;
  onBuy: (cents: number) => void;
  onOtherAmounts: () => void;
  onClose: () => void;
  now?: Date;
}

export default function CreditMomentSheet({ moment, credits, onBuy, onOtherAmounts, onClose, now }: CreditMomentSheetProps) {
  const { semanticColors: sc } = useTheme();
  const insets = useSafeAreaInsets();
  const { budget, packsSold } = credits;
  const copy = CREDIT_MOMENT_COPY[moment];
  const roman = useMemo(() => paceLine(moment, budget, packsSold, now), [moment, budget, packsSold, now]);
  const packs = useMemo(() => [...budget.pack_options_cents].sort((x, y) => x - y), [budget.pack_options_cents]);
  const [pack, setPack] = useState<number | null>(() => preselectedPack(budget, now));
  const selling = packsSold && packs.length > 0 && pack !== null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: sc.overlay }]}
        onPress={onClose}
        accessible={false}
        importantForAccessibility="no"
        testID="credit-moment-scrim"
      />
      <View style={styles.dock} pointerEvents="box-none">
        <View
          style={[styles.sheet, { backgroundColor: sc.bgSurface, paddingBottom: Math.max(insets.bottom, layout.footerBottomMin) }]}
          accessibilityViewIsModal
          testID={`credit-moment-${moment}`}
        >
          <View style={[styles.handle, { backgroundColor: sc.border }]} />
          <ScrollView bounces={false} contentContainerStyle={styles.body}>
            <Headline level="h2">{copy.title}</Headline>
            <View style={styles.card}>
              <CreditStatementCard budget={budget} />
            </View>
            <Text style={[styles.line, { color: sc.textPrimary }]}>{copy.line}</Text>
            {roman ? <RomanLine text={roman} size={40} /> : null}
            {selling ? (
              <View style={styles.packs}>
                <CreditPackTiles packs={packs} selected={pack} onSelect={setPack} />
                <View style={styles.balance} accessible testID="credit-moment-balance">
                  <Text style={[styles.balanceLabel, { color: sc.textPrimary }]}>{CREDIT_MOMENT_COPY.newBalance}</Text>
                  <Text style={[styles.balanceValue, { color: sc.textPrimary }]}>
                    {formatCents(Math.max(0, budget.remaining_displayed_cents) + (pack ?? 0))}
                  </Text>
                </View>
                <Text style={[styles.fine, { color: sc.textMuted }]}>{CREDIT_PACK_NON_REFUNDABLE}</Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.footer}>
            {selling && pack !== null ? (
              <>
                <PrimaryButton label={buyAmountLabel(pack)} onPress={() => onBuy(pack)} testID="credit-moment-buy" />
                <View style={styles.links}>
                  <TextLink label={CREDIT_MOMENT_COPY.otherAmounts} onPress={onOtherAmounts} testID="credit-moment-other" />
                  <TextLink label={CREDIT_MOMENT_COPY.notNow} onPress={onClose} testID="credit-moment-not-now" />
                </View>
              </>
            ) : (
              <PrimaryButton label={CREDIT_MOMENT_COPY.gotIt} onPress={onClose} testID="credit-moment-got-it" />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dock: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: spacing.md },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.chip, marginBottom: spacing.lg },
  body: { paddingHorizontal: layout.gutter, paddingBottom: spacing.sm },
  card: { marginTop: spacing.lg },
  line: { ...typography.body, marginTop: spacing.lg },
  packs: { marginTop: spacing.xl },
  balance: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.lg, gap: spacing.md },
  balanceLabel: { ...typography.body },
  balanceValue: { ...typography.bodyMd, fontVariant: ['tabular-nums'] },
  fine: { ...typography.bodySmall, marginTop: spacing.xs },
  footer: { paddingHorizontal: layout.gutter, paddingTop: spacing.md },
  links: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, marginTop: layout.footerItemGap },
});
