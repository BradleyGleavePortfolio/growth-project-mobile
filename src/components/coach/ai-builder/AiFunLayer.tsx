/**
 * Ask AI fun layer: the coach win moment after Apply and the momentum line in the builder header.
 * Motion is decoration only: every state is also told in text, Reduce Motion gets a cross-fade (no springs), haptics stay.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReduceMotion } from '../../../screens/client/wearables/components/useReduceMotion';
import { spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { AI_LABEL } from './aiBuilderCopy';
import { fireAiHaptic } from './useAiBuilder';

/** Card and toast spring (plan PART 1 "The fun layer": damping 18) and the reveal stagger. */
export const AI_SPRING = { damping: 18, stiffness: 220, mass: 1, useNativeDriver: true } as const;
export const AI_STAGGER_MS = 60;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Numbers first: "6 exercises, 18 sets. 5 changes applied with Ask AI this session." */
export function momentumLine(rows: ReadonlyArray<{ sets: number | null }>, applied: number): string {
  const sets = rows.reduce((sum, r) => sum + (typeof r.sets === 'number' && r.sets > 0 ? r.sets : 0), 0);
  const base = rows.length ? `${plural(rows.length, 'exercise', 'exercises')}, ${plural(sets, 'set', 'sets')}.` : 'No exercises yet.';
  return applied > 0 ? `${base} ${plural(applied, 'change', 'changes')} applied with Ask AI this session.` : base;
}

type MomentumProps = { rows: ReadonlyArray<{ sets: number | null }>; applied: number; sc: SemanticTokens };

/** Header momentum line: a short spring pulse each time an Ask AI apply lands (none under Reduce Motion). */
export function AiMomentumLine({ rows, applied, sc }: MomentumProps) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  const seen = useRef(applied);
  useEffect(() => {
    if (applied === seen.current) return;
    seen.current = applied;
    if (reduceMotion) return;
    pulse.setValue(1.06);
    Animated.spring(pulse, { ...AI_SPRING, toValue: 1 }).start();
  }, [applied, pulse, reduceMotion]);
  const line = momentumLine(rows, applied);
  return (
    <Animated.View style={{ transform: [{ scale: pulse }], alignSelf: 'flex-start' }}>
      <Text testID="ai-momentum-line" accessibilityLabel={line} style={[typography.caption, { color: sc.textMuted, marginBottom: spacing.xs }]}>
        {line}
      </Text>
    </Animated.View>
  );
}

type WinProps = { text: string; undo: boolean; undoDisabled: boolean; onUndo: () => void; sc: SemanticTokens };

/** Coach win moment: the applied toast springs up with a check, is announced to screen readers, and keeps Undo one tap away. */
export function AiWinToast({ text, undo, undoDisabled, onUndo, sc }: WinProps) {
  const reduceMotion = useReduceMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(reduceMotion ? 1 : 0.4)).current;
  useEffect(() => AccessibilityInfo.announceForAccessibility(`${text} ${AI_LABEL}.`), [text]); // once per apply (the screen keys the card)
  useEffect(() => {
    if (reduceMotion) {
      check.setValue(1);
      Animated.timing(enter, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      return;
    }
    Animated.parallel([
      Animated.spring(enter, { ...AI_SPRING, toValue: 1 }),
      Animated.spring(check, { ...AI_SPRING, damping: 10, toValue: 1, delay: 120 }),
    ]).start();
  }, [enter, check, reduceMotion]);
  const opacity = enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const motion = reduceMotion ? null : { transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }) }] };

  return (
    <Animated.View testID="ai-applied-toast" accessibilityLiveRegion="polite"
      style={[styles.toast, { borderColor: sc.accent, backgroundColor: sc.bgSurface, opacity }, motion]}>
      <Animated.View style={{ transform: [{ scale: check }] }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Ionicons name="checkmark-circle" size={28} color={sc.accent} />
      </Animated.View>
      <View style={styles.grow}>
        <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{text}</Text>
        <Text style={[typography.caption, { color: sc.textMuted }]}>{AI_LABEL}</Text>
      </View>
      {undo ? (
        <Pressable testID="ai-toast-undo" accessibilityRole="button" accessibilityLabel="Undo the AI change" accessibilityState={{ disabled: undoDisabled }}
          disabled={undoDisabled} hitSlop={8} onPress={() => { fireAiHaptic('medium'); onUndo(); }} style={[styles.undo, { borderColor: sc.border }]}>
          <Text style={[typography.caption, { color: sc.textPrimary }]}>Undo</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 60, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: 14,
  },
  grow: { flex: 1 },
  undo: { minHeight: 44, minWidth: 64, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
});
