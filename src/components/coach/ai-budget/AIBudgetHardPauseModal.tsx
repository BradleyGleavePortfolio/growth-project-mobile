/**
 * AIBudgetHardPauseModal — 100% threshold.
 *
 * When `surfaceFor(budget) === 'paused'`, this modal renders ON TOP of the
 * Coach Home and blocks navigation to AI features until the coach tops up.
 * Unlike the 80% tutorial it IS dismissible (close-X in header) — the coach
 * can keep coaching without AI; the modal just blocks the AI surfaces.
 *
 * Spec §4 line: "AI paused. Top up to continue."
 *
 * The actual "block AI features" enforcement lives in the AI feature surfaces
 * (e.g. coach brief screen, AI draft screens) which check the budget query
 * and refuse to invoke when paused. This modal is the user-facing nudge.
 */

import React, { useMemo } from 'react';
import { Modal, View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../HapticPressable';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';
import { PackOptionsRow } from './PackOptionsRow';
import {
  formatCents,
  type CoachAIBudgetResponse,
} from '../../../api/types/coachAIBudget';

export interface AIBudgetHardPauseModalProps {
  visible: boolean;
  budget: CoachAIBudgetResponse;
  onClose: () => void;
  onSelectPack: (amountCents: number | 'custom') => void;
  testID?: string;
}

export function AIBudgetHardPauseModal({
  visible,
  budget,
  onClose,
  onSelectPack,
  testID,
}: AIBudgetHardPauseModalProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={testID ?? 'ai-budget-hard-pause-modal'}
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.iconWrap}>
                <Ionicons name="pause-circle-outline" size={32} color={colors.error} />
              </View>
              <HapticPressable
                intent="light"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close paused notice"
                style={styles.closeBtn}
                testID="ai-hard-pause-close"
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </HapticPressable>
            </View>

            <Text style={styles.title}>AI paused</Text>
            <Text style={styles.body}>
              You&apos;ve used the full {formatCents(budget.total_displayed_cents)} of
              AI value for this period. Top up with a credit pack to keep AI
              features running, or wait for your monthly rollover on{' '}
              {formatPeriodEnd(budget.period_end)}.
            </Text>

            <PackOptionsRow
              options={budget.pack_options_cents}
              onSelect={onSelectPack}
              style={styles.options}
            />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default AIBudgetHardPauseModal;

function formatPeriodEnd(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'the 1st';
  }
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(10,10,9,0.55)',
      justifyContent: 'center',
    },
    safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      gap: 16,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.noticeCriticalBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBtn: { padding: 6 },
    title: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
      letterSpacing: 0.2,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    options: { marginTop: 4 },
  });
}
