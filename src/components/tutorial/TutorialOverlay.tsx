/**
 * TutorialOverlay — Roman's coach-mark card over the real client app.
 *
 * Duolingo mechanics within Quiet Luxury visuals:
 *   - a segmented progress indicator (accessibilityRole progressbar) and
 *     "Step n of 8";
 *   - Roman's canonical face (RomanAvatar neutral crop, which resolves
 *     romanFaceAsset; never the smile crop, owner decision T-7) and his line;
 *   - a spotlight: a soft scrim with a radius-4 outline around the real
 *     target. The scrim is visual only (pointerEvents none) so the client
 *     always acts on the real screen; the machine, not the overlay, decides
 *     whether the action counts;
 *   - a per-step done moment: one success haptic (fired by the store), a
 *     check glyph and Roman's done line. No confetti, no exclamation points;
 *   - "Skip the tour" with a confirm (progress kept, resumable), "Later" where
 *     a step offers it, and "Take me there" for screens that sit
 *     behind a menu;
 *   - one 280ms fade with an 8pt rise per gate, removed under Reduce Motion.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import RomanAvatar from '../roman/RomanAvatar';
import { useMacroDisplayMode } from '../../macros/macroDisplayStore';
import {
  buildCopyContext,
  clearTutorialCelebration,
  dispatchTutorial,
  useTutorialStore,
  type TargetRect,
} from '../../tutorial/tutorialStore';
import { currentGate, currentStep, progressOf } from '../../tutorial/tutorialMachine';
import {
  TUTORIAL_STEPS,
  type TutorialNavTarget,
  type TutorialTargetId,
} from '../../tutorial/tutorialSteps';

export const TUTORIAL_FADE_MS = 280;
export const TUTORIAL_DONE_LINE_MS = 2400;
const TAB_BAR_HEIGHT = 64;
const SPOT_PAD = 8;

/** Tab order mirrors ClientNavigator; CommunityTab is last when mounted. */
export function tabTargetRect(
  id: TutorialTargetId,
  tabs: string[],
  width: number,
  height: number,
  bottomInset: number,
): TargetRect | null {
  if (!id.startsWith('tab:')) return null;
  const idx = tabs.indexOf(id.slice(4));
  if (idx < 0 || tabs.length === 0) return null;
  const w = width / tabs.length;
  const barTop = height - bottomInset - TAB_BAR_HEIGHT;
  const size = 44;
  return { x: idx * w + (w - size) / 2, y: barTop + (TAB_BAR_HEIGHT - size) / 2, width: size, height: size };
}

export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

interface Props {
  tabs: string[];
  onNavigate: (target: TutorialNavTarget) => void;
}

export default function TutorialOverlay({ tabs, onNavigate }: Props): React.ReactElement | null {
  const store = useTutorialStore();
  const macroMode = useMacroDisplayMode();
  const { semanticColors: sc } = useTheme();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [confirmSkip, setConfirmSkip] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;

  const { tutorial, celebration } = store;
  const step = currentStep(tutorial);
  const gate = currentGate(tutorial);
  const gateKey = `${tutorial.stepIndex}:${tutorial.gateIndex}`;
  const copy = useMemo(() => buildCopyContext(store, macroMode), [store, macroMode]);
  const line = gate ? capitalizeFirst(gate.line(copy).trim()) : '';

  useEffect(() => {
    setConfirmSkip(false);
    if (reduceMotion) {
      fade.setValue(1);
    } else {
      fade.setValue(0);
      Animated.timing(fade, {
        toValue: 1,
        duration: TUTORIAL_FADE_MS,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }).start();
    }
    if (line) AccessibilityInfo.announceForAccessibility?.(`Roman. ${line}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateKey, reduceMotion]);

  useEffect(() => {
    if (!celebration) return undefined;
    const t = setTimeout(clearTutorialCelebration, TUTORIAL_DONE_LINE_MS);
    return () => clearTimeout(t);
  }, [celebration]);

  if (tutorial.status !== 'active' || !step || !gate) return null;

  const doneStep = celebration ? TUTORIAL_STEPS.find((s) => s.id === celebration.stepId) : null;
  const doneLine = doneStep?.doneLine ? capitalizeFirst(doneStep.doneLine(copy)) : null;
  const { position, total } = progressOf(tutorial);
  const isTerminal = step.id === 'complete';
  const target: TargetRect | null = gate.target
    ? tabTargetRect(gate.target, tabs, width, height, insets.bottom) ?? store.targets[gate.target] ?? null
    : null;
  const spot = target
    ? {
        x: Math.max(0, target.x - SPOT_PAD),
        y: Math.max(0, target.y - SPOT_PAD),
        width: target.width + SPOT_PAD * 2,
        height: target.height + SPOT_PAD * 2,
      }
    : null;
  const cardAtTop = gate.center ? false : spot ? spot.y + spot.height / 2 > height / 2 : true;

  const progress = (
    <View
      style={styles.progressRow}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={isTerminal ? 'Tour complete' : `Step ${position} of ${total}, ${step.title}`}
      accessibilityValue={{ min: 0, max: total, now: isTerminal ? total : position - 1 }}
      testID="tutorial-progress"
    >
      <View style={styles.segments}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { backgroundColor: i < position - (isTerminal ? 0 : 1) ? colors.forest : sc.border },
              i === position - 1 && !isTerminal ? styles.segmentCurrent : null,
            ]}
          />
        ))}
      </View>
      {!isTerminal ? (
        <Text style={[styles.stepCount, { color: sc.textMuted }]}>{`Step ${position} of ${total}`}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="tutorial-overlay">
      {gate.center ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: sc.overlay }]} />
      ) : spot ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="tutorial-spotlight">
          <View style={[styles.scrim, { backgroundColor: sc.overlay, left: 0, right: 0, top: 0, height: spot.y }]} />
          <View
            style={[
              styles.scrim,
              { backgroundColor: sc.overlay, left: 0, right: 0, top: spot.y + spot.height, bottom: 0 },
            ]}
          />
          <View
            style={[styles.scrim, { backgroundColor: sc.overlay, left: 0, width: spot.x, top: spot.y, height: spot.height }]}
          />
          <View
            style={[
              styles.scrim,
              { backgroundColor: sc.overlay, left: spot.x + spot.width, right: 0, top: spot.y, height: spot.height },
            ]}
          />
          <View
            style={[
              styles.outline,
              { left: spot.x, top: spot.y, width: spot.width, height: spot.height, borderColor: sc.bgSurface },
            ]}
          />
        </View>
      ) : null}

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.cardWrap,
          gate.center
            ? styles.cardCenter
            : cardAtTop
              ? { top: insets.top + 12 }
              : { bottom: insets.bottom + TAB_BAR_HEIGHT + 12 },
          {
            opacity: fade,
            transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
        ]}
      >
        <View
          style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}
          accessibilityViewIsModal={!!gate.center}
          testID="tutorial-card"
        >
          {progress}
          <View style={styles.romanRow}>
            <RomanAvatar crop="neutral" size={gate.center ? 48 : 32} testID="tutorial-roman-avatar" />
            <Text style={[styles.romanName, { color: sc.textMuted }]}>Roman</Text>
          </View>

          {confirmSkip ? (
            <View testID="tutorial-skip-confirm">
              <Text style={[styles.confirmTitle, { color: sc.textPrimary }]} accessibilityRole="header">
                Skip the tour?
              </Text>
              <Text style={[styles.body, { color: sc.textMuted }]}>
                Your progress is kept. You can pick it up from Settings, under Tutorial.
              </Text>
              <View style={styles.btnPair}>
                <Pressable
                  onPress={() => setConfirmSkip(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Keep going"
                  style={[styles.secondary, { borderColor: sc.textPrimary }]}
                  testID="tutorial-keep-going"
                >
                  <Text style={[styles.secondaryText, { color: sc.textPrimary }]}>Keep going</Text>
                </Pressable>
                <Pressable
                  onPress={() => dispatchTutorial({ type: 'PAUSE' })}
                  accessibilityRole="button"
                  accessibilityLabel="Skip tour"
                  style={styles.primary}
                  testID="tutorial-skip-confirm-button"
                >
                  <Text style={styles.primaryText}>Skip tour</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              {doneLine ? (
                <View style={styles.doneRow} testID="tutorial-done-line" accessibilityLiveRegion="polite">
                  <Ionicons name="checkmark" size={16} color={sc.textPrimary} />
                  <Text style={[styles.doneText, { color: sc.textPrimary }]}>{doneLine}</Text>
                </View>
              ) : null}
              <Text
                style={[gate.center ? styles.centerLine : styles.body, { color: sc.textPrimary }]}
                accessibilityLiveRegion="polite"
                testID="tutorial-line"
              >
                {line}
              </Text>
              {gate.sub ? (
                <Text style={[styles.body, styles.sub, { color: sc.textMuted }]} testID="tutorial-sub">
                  {gate.sub(copy)}
                </Text>
              ) : null}

              <View style={styles.actions}>
                {gate.kind === 'ack' ? (
                  <Pressable
                    onPress={() => dispatchTutorial({ type: 'ACK' })}
                    accessibilityRole="button"
                    accessibilityLabel={gate.cta}
                    style={styles.primary}
                    testID="tutorial-ack"
                  >
                    <Text style={styles.primaryText}>{gate.cta}</Text>
                  </Pressable>
                ) : null}
                {gate.kind === 'route' && gate.takeMeThere ? (
                  <Pressable
                    onPress={() => gate.takeMeThere && onNavigate(gate.takeMeThere)}
                    accessibilityRole="button"
                    accessibilityLabel="Take me there"
                    style={[styles.secondary, { borderColor: sc.textPrimary }]}
                    testID="tutorial-take-me-there"
                  >
                    <Text style={[styles.secondaryText, { color: sc.textPrimary }]}>Take me there</Text>
                  </Pressable>
                ) : null}
                {gate.kind !== 'ack' && gate.allowDefer ? (
                  <Pressable
                    onPress={() => dispatchTutorial({ type: 'DEFER' })}
                    accessibilityRole="button"
                    accessibilityLabel="Later"
                    accessibilityHint={gate.deferHint}
                    style={[styles.secondary, { borderColor: sc.textPrimary }]}
                    testID="tutorial-defer"
                  >
                    <Text style={[styles.secondaryText, { color: sc.textPrimary }]}>Later</Text>
                  </Pressable>
                ) : null}
              </View>

              {!isTerminal ? (
                <Pressable
                  onPress={() => setConfirmSkip(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Skip the tour"
                  style={styles.skip}
                  testID="tutorial-skip"
                  hitSlop={8}
                >
                  <Text style={[styles.skipText, { color: sc.textMuted }]}>Skip the tour</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute' },
  outline: { position: 'absolute', borderWidth: 1.5, borderRadius: radius.lg },
  cardWrap: { position: 'absolute', left: 16, right: 16 },
  cardCenter: { top: 0, bottom: 0, justifyContent: 'center' },
  card: { borderWidth: 0.5, borderRadius: radius.lg, padding: 20 },
  progressRow: { marginBottom: 14 },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 3, borderRadius: 1 },
  segmentCurrent: { opacity: 0.6, backgroundColor: colors.forest },
  stepCount: { ...typography.caption, marginTop: 8 },
  romanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  romanName: { ...typography.caption },
  body: { ...typography.body },
  centerLine: { ...typography.h3, fontWeight: '400' },
  confirmTitle: { ...typography.h3, marginBottom: 6 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  doneText: { ...typography.bodySmall },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btnPair: { flexDirection: 'row', gap: 10, marginTop: 16 },
  primary: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryText: { ...typography.bodyMd, color: colors.bone, textAlign: 'center' },
  sub: { marginTop: 10 },
  secondary: {
    flex: 1,
    minHeight: 48,
    borderWidth: 0.5,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryText: { ...typography.bodyMd },
  skip: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 6 },
  skipText: { ...typography.bodySmall },
});
