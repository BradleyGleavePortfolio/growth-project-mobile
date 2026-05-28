/**
 * AIBudgetMount — single-mount orchestrator for the AI budget surfaces.
 *
 * Drops into Coach Home and renders the right surface for the current
 * `pct_used`:
 *
 *   pct_used < 60        → render nothing
 *   60 ≤ pct_used < 80   → meter chip (passthrough via `meterSlot` prop)
 *   80 ≤ pct_used < 95   → BLOCKING tutorial modal (once per period_start)
 *   95 ≤ pct_used < 100  → persistent banner above content
 *   pct_used ≥ 100       → hard pause modal (dismissible) + banner-rest state
 *
 * Why one orchestrator: keeps Coach Home's diff to a single line, centralises
 * the AsyncStorage "seen-this-period" logic for the tutorial, and ensures
 * exactly one surface is visible at a time (the 80% tutorial supersedes
 * the chip, the 95% banner supersedes the chip, the 100% hard-pause
 * supersedes everything).
 *
 * The `meterSlot` render prop lets Coach Home position the chip inside its
 * own header layout rather than this component imposing layout decisions
 * on Coach Home.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ErrorBoundary from '../../ErrorBoundary';
import { useAIBudget } from '../../../hooks/useAIBudget';
import { AIBudgetMeter } from './AIBudgetMeter';
import { AIBudgetBanner } from './AIBudgetBanner';
import { AIBudgetTutorialModal, tutorialSeenKey } from './AIBudgetTutorialModal';
import { AIBudgetHardPauseModal } from './AIBudgetHardPauseModal';
import { surfaceFor, type CoachAIBudgetResponse } from '../../../api/types/coachAIBudget';

export interface AIBudgetMountProps {
  /**
   * Render-prop hook that receives the meter chip element. Coach Home uses
   * this to position the chip inside its own header. When null we fall back
   * to rendering the chip inline (useful for tests).
   */
  meterSlot?: (chip: React.ReactNode) => React.ReactNode;
  /** Set to false to suspend polling (e.g. when the user is not a coach). */
  enabled?: boolean;
  /** Navigation target name for the credit pack checkout screen.
   *  Defaults to `('SettingsStack' → 'CreditPackCheckout')`. */
  checkoutScreen?: string;
}

export function AIBudgetMount({
  meterSlot,
  enabled = true,
  checkoutScreen = 'CreditPackCheckout',
}: AIBudgetMountProps): React.ReactElement | null {
  const { data: budget } = useAIBudget({ enabled });
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const surface = useMemo(() => surfaceFor(budget), [budget]);

  // Tutorial-seen state. Resolved per period_start: a new period (after
  // monthly rollover) resets the "seen" flag automatically because the key
  // includes the period_start ISO string.
  const [tutorialSeen, setTutorialSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!budget) {
      setTutorialSeen(null);
      return () => undefined;
    }
    (async () => {
      try {
        const v = await AsyncStorage.getItem(tutorialSeenKey(budget.period_start));
        if (!cancelled) setTutorialSeen(Boolean(v));
      } catch {
        if (!cancelled) setTutorialSeen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [budget?.period_start, budget]);

  // Dismissible hard-pause modal state. Re-shows on every new budget fetch
  // when the budget is still paused — that's intentional, because the hard
  // pause is dismissible but still important.
  const [hardPauseDismissed, setHardPauseDismissed] = useState(false);
  useEffect(() => {
    // Reset dismissal when the period rolls over (period_start changes).
    setHardPauseDismissed(false);
  }, [budget?.period_start]);

  const goToCheckout = useCallback(
    (amount: number | 'custom') => {
      // Param shape is intentionally minimal — the checkout screen reads
      // pack options from the budget query directly. Custom flow is routed
      // by an explicit string sentinel.
      navigation.navigate('SettingsStack', {
        screen: checkoutScreen,
        params: { preselect: amount },
      } as never);
    },
    [navigation, checkoutScreen],
  );

  if (!budget || surface === 'hidden') {
    return meterSlot ? <>{meterSlot(null)}</> : null;
  }

  const chip =
    surface === 'chip' ? (
      <AIBudgetMeter
        budget={budget}
        onPress={() => goToCheckout('custom')}
        testID="ai-budget-mount-chip"
      />
    ) : null;

  return (
    <ErrorBoundary>
      <View testID="ai-budget-mount">
        {meterSlot ? meterSlot(chip) : chip}
        {surface === 'banner' && (
          <AIBudgetBanner budget={budget} onBuyCredits={() => goToCheckout('custom')} />
        )}
        {surface === 'tutorial' && tutorialSeen === false && (
          <AIBudgetTutorialModal
            visible
            budget={budget}
            onClose={() => setTutorialSeen(true)}
            onSelectPack={(amount) => {
              setTutorialSeen(true);
              goToCheckout(amount);
            }}
          />
        )}
        {surface === 'paused' && !hardPauseDismissed && (
          <AIBudgetHardPauseModal
            visible
            budget={budget}
            onClose={() => setHardPauseDismissed(true)}
            onSelectPack={(amount) => {
              setHardPauseDismissed(true);
              goToCheckout(amount);
            }}
          />
        )}
      </View>
    </ErrorBoundary>
  );
}

export default AIBudgetMount;

/** Re-export for tests that need to derive the surface independently. */
export { surfaceFor };
export type { CoachAIBudgetResponse };
