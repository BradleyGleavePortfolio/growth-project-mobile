/**
 * AIBudgetTutorialModal — BLOCKING FORCED 4-card walkthrough (80% threshold).
 *
 * Operator override (2026-05-28): the modal is NOT dismissible until the
 * coach reaches card 4. The original audit doc said "dismissible" — this
 * file is the surface that implements the override.
 *
 * Card flow (advanced via "Continue" button at the bottom):
 *   1. "How AI usage works"  → educational copy + sparkles icon
 *   2. "Why a budget"        → cost/protection rationale + bar-chart icon
 *   3. "How packs work"      → pack tier explanation + pack icons
 *   4. "Buy credits"         → PackOptionsRow [$10] [$25] [$99] [Custom]
 *                              + "I'll buy later" tertiary action (closes modal)
 *
 * Once the coach reaches card 4 (either by pressing Continue 3 times or
 * by purchasing), we persist `aiTutorialSeenAt:<period_start>` in
 * AsyncStorage so the same tutorial does NOT re-trigger until the next
 * month rollover (new period_start ⇒ new key).
 *
 * Tech choices:
 *   - Reanimated v3 for card-transition animations (no `Animated.timing`).
 *   - `expo-haptics` Medium impact on each card transition.
 *   - Modal is `presentationStyle="overFullScreen"` with `transparent` so
 *     the backdrop doesn't fade through the Coach Home content awkwardly.
 *
 * The "modal cannot be dismissed before card 4" invariant is enforced by:
 *   - `onRequestClose={() => {}}`  → Android hardware back press is a no-op
 *     when index < 3.
 *   - No "X" close affordance on cards 1–3.
 *   - No tap-outside-to-dismiss (there is no tap-outside surface; modal is
 *     full-screen).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HapticPressable from '../../HapticPressable';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';
import { PackOptionsRow } from './PackOptionsRow';
import {
  formatCents,
  type CoachAIBudgetResponse,
} from '../../../api/types/coachAIBudget';

const TUTORIAL_SEEN_KEY_PREFIX = 'aiTutorialSeenAt:';

/** Storage key used by the tutorial. Exposed so the Coach Home mount logic
 *  can read it (so the modal does NOT re-trigger after dismissal). */
export function tutorialSeenKey(periodStart: string): string {
  return `${TUTORIAL_SEEN_KEY_PREFIX}${periodStart}`;
}

export interface AIBudgetTutorialModalProps {
  visible: boolean;
  budget: CoachAIBudgetResponse;
  /** Called when the modal is fully closed (after card 4 is reached). */
  onClose: () => void;
  /** Called when the coach selects a pack on card 4. Routes to checkout. */
  onSelectPack: (amountCents: number | 'custom') => void;
  testID?: string;
}

type Card = {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
};

function getCards(budget: CoachAIBudgetResponse): Card[] {
  const total = formatCents(budget.total_displayed_cents);
  return [
    {
      title: 'How AI usage works',
      body: `Every AI draft — workouts, meal plans, briefs, client chat — runs on a real model and has a real cost. We bundle ${total} of AI value into your monthly plan so most coaches never think about it.`,
      icon: 'sparkles-outline',
    },
    {
      title: 'Why a budget?',
      body: 'A per-coach budget protects you (a runaway client chat loop can\'t bankrupt your month) and protects us (so we can keep AI in your plan instead of bolting on a per-call surcharge).',
      icon: 'shield-checkmark-outline',
    },
    {
      title: 'How packs work',
      body: 'When you hit 80% of your allowance — like now — you can top up with a credit pack. Pay the face value, get exactly that much AI credit added to this period. No multiplier math, no fine print.',
      icon: 'gift-outline',
    },
    {
      title: 'Buy credits',
      body: 'Pick a pack to keep AI features uninterrupted. Or tap "I\'ll buy later" — we\'ll show this once per month, and you can always top up from the Coach Home meter.',
      icon: 'card-outline',
    },
  ];
}

export function AIBudgetTutorialModal({
  visible,
  budget,
  onClose,
  onSelectPack,
  testID,
}: AIBudgetTutorialModalProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cards = useMemo(() => getCards(budget), [budget]);
  const lastIndex = cards.length - 1;
  const [index, setIndex] = useState(0);

  // Reset to card 1 every time the modal re-opens. (Defensive — under steady
  // state the modal stays mounted while visible and we never reopen for the
  // same period_start.)
  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const advance = useCallback(() => {
    if (index >= lastIndex) return;
    // Slide-and-fade transition (Reanimated v3 — no Animated.timing).
    opacity.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) });
    translateX.value = withTiming(-24, { duration: 120 });
    // expo-haptics medium impact per design doctrine. try/catch because
    // some Android devices throw when the vibrator is disabled.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setTimeout(() => {
      setIndex((i) => Math.min(i + 1, lastIndex));
      translateX.value = 24;
      translateX.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.cubic) });
      opacity.value = withTiming(1, { duration: 160 });
    }, 120);
  }, [index, lastIndex, opacity, translateX]);

  const persistAndClose = useCallback(async () => {
    try {
      await AsyncStorage.setItem(tutorialSeenKey(budget.period_start), new Date().toISOString());
    } catch {
      // Persistence is best-effort. The modal still closes — worst case the
      // coach sees it once more this period if AsyncStorage write failed.
    }
    onClose();
  }, [budget.period_start, onClose]);

  const handleSelectPack = useCallback(
    (amount: number | 'custom') => {
      // Persist seen-flag BEFORE routing to checkout so a coach who buys then
      // backgrounds the app does not see the modal again on next foreground.
      AsyncStorage.setItem(tutorialSeenKey(budget.period_start), new Date().toISOString())
        .catch(() => undefined)
        .finally(() => onSelectPack(amount));
    },
    [budget.period_start, onSelectPack],
  );

  const card = cards[index];
  const isLast = index === lastIndex;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // CRITICAL: while index < lastIndex this is a no-op. Android hardware
      // back press cannot dismiss before the coach reaches card 4. That is
      // the operator override — "forces him through a tutorial/explanation".
      onRequestClose={() => {
        /* intentionally blocked — see component header */
      }}
      // iOS-only — full-screen presentation so backdrop doesn't double-render.
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      testID={testID ?? 'ai-budget-tutorial-modal'}
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.card}>
            <View style={styles.progressRow}>
              {cards.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressDot,
                    i <= index && styles.progressDotActive,
                  ]}
                  testID={`ai-tutorial-progress-${i}`}
                />
              ))}
            </View>

            <Animated.View style={[styles.cardBody, cardStyle]}>
              <View style={styles.iconWrap}>
                <Ionicons name={card.icon} size={32} color={colors.primary} />
              </View>
              <Text style={styles.title} testID="ai-tutorial-title">
                {card.title}
              </Text>
              <Text style={styles.body}>{card.body}</Text>
            </Animated.View>

            <View style={styles.footer}>
              {isLast ? (
                <View style={styles.lastCardActions}>
                  <PackOptionsRow
                    options={budget.pack_options_cents}
                    onSelect={handleSelectPack}
                  />
                  <HapticPressable
                    intent="light"
                    onPress={persistAndClose}
                    accessibilityRole="button"
                    accessibilityLabel="Buy credits later"
                    style={styles.laterBtn}
                    testID="ai-tutorial-later"
                  >
                    <Text style={styles.laterText}>I&apos;ll buy later</Text>
                  </HapticPressable>
                </View>
              ) : (
                <HapticPressable
                  intent="medium"
                  onPress={advance}
                  accessibilityRole="button"
                  accessibilityLabel="Continue to next card"
                  style={styles.continueBtn}
                  testID="ai-tutorial-continue"
                >
                  <Text style={styles.continueText}>Continue</Text>
                </HapticPressable>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default AIBudgetTutorialModal;

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(10,10,9,0.55)',
      justifyContent: 'center',
    },
    safeArea: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      gap: 24,
    },
    progressRow: {
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
    },
    progressDot: {
      width: 24,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
    },
    progressDotActive: {
      backgroundColor: colors.primary,
    },
    cardBody: {
      alignItems: 'center',
      gap: 14,
      minHeight: 200,
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primaryPale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
      textAlign: 'center',
      letterSpacing: 0.2,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    footer: {
      gap: 12,
    },
    lastCardActions: {
      gap: 16,
    },
    continueBtn: {
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    continueText: {
      color: colors.textOnPrimary,
      fontWeight: '600',
      fontSize: 16,
      letterSpacing: 0.4,
    },
    laterBtn: {
      paddingVertical: 12,
      alignItems: 'center',
    },
    laterText: {
      color: colors.textSecondary,
      fontSize: 14,
      letterSpacing: 0.3,
    },
  });
}
