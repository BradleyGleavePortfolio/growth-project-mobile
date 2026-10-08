import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useAIBudget } from '../../../hooks/useAIBudget';
import {
  clampPctForDisplay,
  surfaceFor,
  type CoachAIBudgetResponse,
} from '../../../api/types/coachAIBudget';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { makeStyles } from './styles';

/**
 * COACH-SETTINGS-131 (AUD-COACH-WEEK1-129 U2): the AI credits line in coach
 * Settings > Payments. Percent left and the renewal date come from
 * GET /coach/ai/budget (useAIBudget, polled only while Settings is focused),
 * with a plain note when credits run low or run out. Text only: no pack is
 * sold from this row (store builds hide credit packs).
 */

export const AI_CREDITS_USED_BY = 'Used by Roman and AI drafts for you and your clients.';
export const AI_CREDITS_LOAD_FAILED = 'The balance did not load. Tap to try again.';

/** Renewal day of the budget period. period_end is the first instant of the next UTC month. */
export function renewalDay(periodEnd: string): string | null {
  const d = new Date(periodEnd);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function aiCreditsCopy(budget: CoachAIBudgetResponse): {
  value: string;
  detail: string;
  note: string | null;
} {
  const surface = surfaceFor(budget);
  const day = renewalDay(budget.period_end);
  const renews = day ? ` Renews ${day}.` : '';
  const detail = `${AI_CREDITS_USED_BY}${renews}`;
  if (surface === 'paused') {
    return {
      value: 'None left',
      detail,
      note: day ? `AI features are paused until ${day}.` : 'AI features are paused until the allowance renews.',
    };
  }
  const left = 100 - clampPctForDisplay(budget.pct_used);
  const value = left < 1 ? 'Under 1% left' : `${Math.floor(left)}% left`;
  const low = surface === 'tutorial' || surface === 'banner';
  return {
    value,
    detail,
    note: low ? 'Running low. AI features pause when credits run out.' : null,
  };
}

export function AICreditsRow({
  styles,
  colors,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const isFocused = useIsFocused();
  const q = useAIBudget({ enabled: isFocused });
  const budget = q.data;
  const failed = !budget && q.isError;
  const copy = budget ? aiCreditsCopy(budget) : null;
  const value = copy ? copy.value : '—';
  const detail = copy ? copy.detail : failed ? AI_CREDITS_LOAD_FAILED : AI_CREDITS_USED_BY;
  const spoken = copy
    ? `AI credits, ${copy.value}. ${copy.detail}${copy.note ? ` ${copy.note}` : ''}`
    : failed
      ? `AI credits. ${AI_CREDITS_LOAD_FAILED}`
      : 'AI credits, loading';

  const body = (
    <>
      <Ionicons name="pie-chart-outline" size={20} color={colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>AI credits</Text>
        <Text style={styles.rowSubLabel}>{detail}</Text>
        {copy?.note ? (
          <Text style={styles.rowSubLabel} testID="settings-ai-credits-note">
            {copy.note}
          </Text>
        ) : null}
      </View>
      <Text style={styles.rowValueHighlight} testID="settings-ai-credits-value">
        {value}
      </Text>
    </>
  );

  if (failed) {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => q.refetch()}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        testID="settings-ai-credits"
      >
        {body}
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.row} accessible accessibilityLabel={spoken} testID="settings-ai-credits">
      {body}
    </View>
  );
}
