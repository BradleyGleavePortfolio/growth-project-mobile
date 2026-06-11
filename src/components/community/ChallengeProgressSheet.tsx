/**
 * ChallengeProgressSheet — the bottom sheet where a participant logs progress
 * toward their OWN target for a community challenge (v3-1).
 *
 * BEHAVIORAL DESIGN (DESIGN_INTELLIGENCE Part III + §5.1):
 *   - Emotional target: the participant leaves feeling CAPABLE — they see their
 *     own progress grow in real metric units (competence feedback §3.7), never
 *     a comparison against anyone else here.
 *   - Primary path (§5.1 Step 2): a single "Log progress" action. The current
 *     value is pre-filled (smart default, Hick's Law) so the common case is one
 *     adjustment + one tap.
 *   - Progress is MONOTONIC and framed only as growth: the bar never shrinks and
 *     there is no "behind"/"failed"/"you're losing" state (§3.4, no public
 *     failure). Reaching the goal is a positive closure celebration (§5.1 Step 6).
 *   - Reduced motion: the fill animation collapses to an instant set when the OS
 *     "Reduce Motion" setting is on.
 *
 * Tokens only (no raw hex). Line Ionicons only (no emoji). Accessible (>=48dp
 * targets, labelled controls, live region on the progress value).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, motion } from '../../theme/tokens';
import type {
  CommunityChallenge,
  CommunityChallengeParticipation,
} from '../../api/communityChallengesApi';

export interface ChallengeProgressSheetProps {
  visible: boolean;
  challenge: CommunityChallenge;
  /** The caller's participation, or null when they have not joined yet. */
  participation: CommunityChallengeParticipation | null;
  /** Persist a new cumulative progress value. Resolves when the server confirms. */
  onSubmit: (progressValue: number) => Promise<void>;
  onClose: () => void;
  /** Submission in flight — disables the primary action and shows progress copy. */
  submitting?: boolean;
  testID?: string;
}

/** Clamp a fraction into [0, 1]; null target → null (no bar, only a raw value). */
function fractionFor(value: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.min(Math.max(value / target, 0), 1);
}

export default function ChallengeProgressSheet({
  visible,
  challenge,
  participation,
  onSubmit,
  onClose,
  submitting = false,
  testID,
}: ChallengeProgressSheetProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const current = participation?.progress_value ?? 0;
  const target = challenge.target_value;
  const unit = challenge.unit ?? '';
  const [draft, setDraft] = useState<string>(String(current));
  const [reduceMotion, setReduceMotion] = useState(false);
  const fill = useRef(new Animated.Value(fractionFor(current, target) ?? 0)).current;

  // Re-seed the draft to the current value whenever the sheet (re)opens — the
  // smart default is "your number so far", so logging more is a small edit.
  useEffect(() => {
    if (visible) setDraft(String(current));
  }, [visible, current]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (mounted) setReduceMotion(on);
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (on) => setReduceMotion(on),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const draftValue = Number(draft);
  const draftValid = draft.trim() !== '' && Number.isFinite(draftValue) && draftValue >= 0;
  // Monotonic: a log can only hold or raise the visible number.
  const nextValue = draftValid ? Math.max(draftValue, current) : current;
  const nextFraction = fractionFor(nextValue, target);
  const willComplete =
    target !== null && target > 0 && nextValue >= target && current < target;

  // Animate the bar toward the DRAFT fraction so the user previews their gain
  // before committing — anticipation, then the submit confirms it.
  useEffect(() => {
    const toValue = nextFraction ?? 0;
    if (reduceMotion) {
      fill.setValue(toValue);
      return;
    }
    const anim = Animated.timing(fill, {
      toValue,
      duration: motion.duration.base,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [nextFraction, reduceMotion, fill]);

  const handleSubmit = useCallback(() => {
    if (!draftValid || submitting) return;
    void onSubmit(nextValue);
  }, [draftValid, submitting, onSubmit, nextValue]);

  const widthInterpolation = fill.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const percentLabel =
    nextFraction === null ? null : `${Math.round(nextFraction * 100)}%`;
  const goalLabel =
    target === null
      ? `${nextValue}${unit ? ` ${unit}` : ''} logged`
      : `${nextValue} of ${target}${unit ? ` ${unit}` : ''}`;

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'fade' : 'slide'}
      transparent
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
          ]}
        >
          <View style={styles.handleRow}>
            <View style={[styles.grabber, { backgroundColor: semanticColors.border }]} />
          </View>

          <View style={styles.headerRow}>
            <Text
              style={[styles.title, { color: semanticColors.textPrimary }]}
              numberOfLines={2}
            >
              {challenge.title}
            </Text>
            <HapticPressable
              intent="light"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close progress sheet"
              testID={`${testID ?? 'challenge-progress'}-close`}
              style={styles.iconButton}
            >
              <Ionicons name="close" size={22} color={semanticColors.textMuted} />
            </HapticPressable>
          </View>

          <Text style={[styles.subtitle, { color: semanticColors.textMuted }]}>
            Your progress
          </Text>

          {nextFraction !== null ? (
            <View
              style={[styles.track, { backgroundColor: semanticColors.bgPrimary }]}
              accessibilityRole="progressbar"
              accessibilityLabel={`Your progress: ${percentLabel} toward your goal`}
            >
              <Animated.View
                style={[
                  styles.fill,
                  { backgroundColor: semanticColors.accent, width: widthInterpolation },
                ]}
                testID={`${testID ?? 'challenge-progress'}-fill`}
              />
            </View>
          ) : null}

          <Text
            style={[styles.goalLabel, { color: semanticColors.textPrimary }]}
            accessibilityLiveRegion="polite"
            testID={`${testID ?? 'challenge-progress'}-value`}
          >
            {goalLabel}
            {percentLabel ? `  ·  ${percentLabel}` : ''}
          </Text>

          {willComplete ? (
            <View style={styles.completeRow} testID={`${testID ?? 'challenge-progress'}-complete`}>
              <Ionicons
                name="checkmark-circle-outline"
                size={18}
                color={semanticColors.accent}
              />
              <Text style={[styles.completeText, { color: semanticColors.accent }]}>
                You will reach your goal — nice work.
              </Text>
            </View>
          ) : null}

          <Text style={[styles.inputLabel, { color: semanticColors.textMuted }]}>
            {unit ? `Update your total (${unit})` : 'Update your total'}
          </Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            keyboardType="numeric"
            inputMode="decimal"
            editable={!submitting}
            accessibilityLabel="Your progress value"
            placeholder={String(current)}
            placeholderTextColor={semanticColors.textMuted}
            testID={`${testID ?? 'challenge-progress'}-input`}
            style={[
              styles.input,
              {
                color: semanticColors.textPrimary,
                borderColor: semanticColors.border,
                backgroundColor: semanticColors.bgPrimary,
              },
            ]}
          />

          <HapticPressable
            intent="success"
            onPress={handleSubmit}
            disabled={!draftValid || submitting}
            accessibilityRole="button"
            accessibilityLabel="Log progress"
            testID={`${testID ?? 'challenge-progress'}-submit`}
            style={[
              styles.cta,
              {
                backgroundColor: draftValid && !submitting
                  ? semanticColors.accent
                  : semanticColors.disabledBg,
              },
            ]}
          >
            <Text
              style={[
                styles.ctaLabel,
                {
                  color: draftValid && !submitting
                    ? semanticColors.textOnAccent
                    : semanticColors.textOnDisabled,
                },
              ]}
            >
              {submitting ? 'Saving your progress…' : 'Log progress'}
            </Text>
          </HapticPressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['2xl'],
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  handleRow: { alignItems: 'center', paddingBottom: spacing.sm },
  grabber: { width: 36, height: 4, borderRadius: radius.pill },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '600' },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  subtitle: { fontSize: 13, fontWeight: '600', marginTop: spacing.xs },
  track: {
    height: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: { height: '100%', borderRadius: radius.pill },
  goalLabel: { fontSize: 15, fontWeight: '600', marginTop: spacing.sm },
  completeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  completeText: { fontSize: 14, fontWeight: '600' },
  inputLabel: { fontSize: 13, marginTop: spacing.md },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    marginTop: spacing.xs,
  },
  cta: {
    marginTop: spacing.lg,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 15, fontWeight: '600' },
});
