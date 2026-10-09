/**
 * TutorialOverlay — Roman's coach-mark card over the real client app
 * (prototype 46-66, TOUR-133).
 *
 *   - The card: Roman's canonical face (RomanAvatar neutral crop, never the
 *     smile, T-7), "Step n of 7", a Skip link in textMuted, a hairline, his
 *     line, a thin progress line and one quiet text action ("Begin",
 *     "Continue", "Take me there", "Later"). Corners from the radius tokens
 *     (owner 17:07: rounded, never rectangles): card radius.card, sheet
 *     radius.sheet, buttons the src/ui primitives (DS-PRIMITIVES-133).
 *   - A spotlight: a soft ink scrim with a rounded cut-out (one SVG path,
 *     even-odd fill) and a hairline outline around the real target. The scrim
 *     is visual only (pointerEvents none) so the client always acts on the
 *     real screen; the machine decides what counts.
 *   - A done moment per step: a check glyph and Roman's done line (one
 *     success haptic, fired by the store), auto-advancing after 3.2 s or on
 *     a tap. A step whose data is not ready shows its line once with
 *     Continue (66).
 *   - The completion (60): face, a serif line, a quiet paragraph and one ink
 *     "Got it". Then the push priming card (61) when the OS can still ask
 *     (only "Turn on notifications" shows the OS dialog), then Home (63).
 *   - Skip asks first in a bottom sheet (64); progress is kept and Home
 *     re-offers it with one quiet line (65).
 *   - One 280 ms fade with an 8 pt rise per card, none under Reduce Motion.
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
import Svg, { Path, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, typography } from '../../theme/tokens';
import { Headline, PrimaryButton, TextLink } from '../../ui';
import { useTheme } from '../../theme/ThemeProvider';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import RomanAvatar from '../roman/RomanAvatar';
import { useMacroDisplayMode } from '../../macros/macroDisplayStore';
import {
  buildCopyContext,
  clearTutorialCelebration,
  clearTutorialNotice,
  dispatchTutorial,
  setTutorialPriming,
  useTutorialStore,
  type TargetRect,
} from '../../tutorial/tutorialStore';
import { currentGate, currentStep, progressOf } from '../../tutorial/tutorialMachine';
import { answerPushPriming, shouldOfferPushPriming } from '../../tutorial/pushPriming';
import {
  pushPrimingLine,
  TOUR_LENGTH,
  TUTORIAL_STEPS,
  type TutorialNavTarget,
  type TutorialTargetId,
} from '../../tutorial/tutorialSteps';

export const TUTORIAL_FADE_MS = 280;
export const TUTORIAL_DONE_LINE_MS = 3200;
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

/** Full-screen rect with a rounded-rect hole (even-odd), for the scrim. */
export function spotlightPath(w: number, h: number, x: number, y: number, sw: number, sh: number, r: number): string {
  const k = Math.max(0, Math.min(r, sw / 2, sh / 2));
  return [
    `M0 0H${w}V${h}H0Z`,
    `M${x + k} ${y}H${x + sw - k}A${k} ${k} 0 0 1 ${x + sw} ${y + k}V${y + sh - k}`,
    `A${k} ${k} 0 0 1 ${x + sw - k} ${y + sh}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + sh - k}V${y + k}`,
    `A${k} ${k} 0 0 1 ${x + k} ${y}Z`,
  ].join('');
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
  const busy = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;

  const { tutorial, celebration, notice, priming, userId } = store;
  const step = currentStep(tutorial);
  const gate = currentGate(tutorial);
  const copy = useMemo(() => buildCopyContext(store, macroMode), [store, macroMode]);
  const noticeStep = notice ? TUTORIAL_STEPS.find((s) => s.id === notice.stepId) ?? null : null;
  const doneStep = celebration ? TUTORIAL_STEPS.find((s) => s.id === celebration.stepId) ?? null : null;
  const active = tutorial.status === 'active' && !!step && !!gate;
  const mode = priming
    ? 'priming'
    : !active
      ? null
      : noticeStep?.pendingLine
        ? 'notice'
        : doneStep?.doneLine
          ? 'done'
          : step?.id === 'complete'
            ? 'complete'
            : 'gate';
  const line =
    mode === 'notice' && noticeStep?.pendingLine
      ? capitalizeFirst(noticeStep.pendingLine(copy))
      : mode === 'done' && doneStep?.doneLine
        ? capitalizeFirst(doneStep.doneLine(copy))
        : mode === 'priming'
          ? pushPrimingLine(copy)
          : gate
            ? capitalizeFirst(gate.line(copy).trim())
            : '';
  const cardKey = `${mode}:${tutorial.stepIndex}:${tutorial.gateIndex}`;

  useEffect(() => {
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
  }, [cardKey, reduceMotion]);

  useEffect(() => {
    if (!celebration) return undefined;
    const t = setTimeout(clearTutorialCelebration, TUTORIAL_DONE_LINE_MS);
    return () => clearTimeout(t);
  }, [celebration]);

  useEffect(() => {
    if (tutorial.status !== 'active') setConfirmSkip(false);
  }, [tutorial.status]);

  if (!mode) return null;

  const land = () => onNavigate({ tab: 'Home', screen: 'HomeMain' });
  const finish = async () => {
    if (busy.current) return;
    busy.current = true;
    const offer = await shouldOfferPushPriming(userId);
    if (offer) setTutorialPriming(true);
    dispatchTutorial({ type: 'ACK' });
    busy.current = false;
    if (!offer) land();
  };
  const answer = async (accept: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (accept) await answerPushPriming(userId, true);
    else void answerPushPriming(userId, false);
    busy.current = false;
    setTutorialPriming(false);
    land();
  };

  const shownStep = mode === 'notice' ? noticeStep : mode === 'done' ? doneStep : step;
  const position = shownStep?.ordinal ?? progressOf(tutorial).position;
  const target: TargetRect | null =
    mode === 'gate' && gate?.target
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
  const centered = mode === 'priming' || mode === 'notice' || mode === 'complete' || !!gate?.center;
  const tabSpot = mode === 'gate' && !!gate?.target?.startsWith('tab:'); // B-606-1: tab beats sit above the tab bar
  const cardAtTop = !centered && !tabSpot && (spot ? spot.y + spot.height / 2 > height / 2 : mode !== 'done');
  const scrim = (extra?: object) => [StyleSheet.absoluteFill, { backgroundColor: sc.overlay }, extra];

  const header = (withStep: boolean, withSkip: boolean) => (
    <>
      <View style={styles.header}>
        <RomanAvatar crop="neutral" size={20} testID="tutorial-roman-avatar" />
        <Text style={[styles.romanName, { color: sc.textPrimary }]}>Roman</Text>
        <View style={styles.grow} />
        {withStep ? (
          <Text style={[styles.stepCount, { color: sc.textMuted }]} testID="tutorial-step-count">
            {`Step ${position} of ${TOUR_LENGTH}`}
          </Text>
        ) : null}
        {withSkip ? (
          <TextLink
            label="Skip"
            onPress={() => setConfirmSkip(true)}
            size="small"
            align="end"
            accessibilityHint="Asks before leaving the tour"
            testID="tutorial-skip"
            style={styles.skip}
          />
        ) : null}
      </View>
      <View style={[styles.rule, { backgroundColor: sc.border }]} />
    </>
  );

  const progress = (
    <View
      style={[styles.track, { backgroundColor: sc.border }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${position} of ${TOUR_LENGTH}, ${shownStep?.title ?? ''}`}
      accessibilityValue={{ min: 0, max: TOUR_LENGTH, now: position }}
      testID="tutorial-progress"
    >
      <View style={[styles.fill, { backgroundColor: sc.accent, width: `${(position / TOUR_LENGTH) * 100}%` }]} />
    </View>
  );

  const textAction = (label: string, onPress: () => void, testID: string, muted = false, hint?: string) => (
    <TextLink
      key={testID}
      label={label}
      onPress={onPress}
      tone={muted ? 'muted' : 'ink'}
      align="end"
      accessibilityHint={hint}
      testID={testID}
    />
  );

  let card: React.ReactNode;
  if (mode === 'complete' && gate) {
    card = (
      <View style={styles.completeBody}>
        <RomanAvatar crop="neutral" size={48} testID="tutorial-roman-avatar" />
        <Text style={[styles.completeName, { color: sc.textMuted }]}>Roman</Text>
        <Headline level="h3" align="center" testID="tutorial-line">
          {line}
        </Headline>
        {gate.sub ? (
          <Text style={[styles.completeSub, { color: sc.textMuted }]} testID="tutorial-sub">
            {gate.sub(copy)}
          </Text>
        ) : null}
        <PrimaryButton
          label={gate.kind === 'ack' ? gate.cta : 'Got it'}
          onPress={() => void finish()}
          testID="tutorial-ack"
          style={styles.solid}
        />
      </View>
    );
  } else if (mode === 'priming') {
    card = (
      <View testID="tutorial-push-priming">
        {header(false, false)}
        <Text style={[styles.body, { color: sc.textPrimary }]} testID="tutorial-line">
          {line}
        </Text>
        <PrimaryButton
          label="Turn on notifications"
          onPress={() => void answer(true)}
          accessibilityHint="Your phone then asks to allow notifications"
          testID="tutorial-push-enable"
          style={styles.solid}
        />
        <TextLink label="Not now" onPress={() => void answer(false)} testID="tutorial-push-later" style={styles.under} />
      </View>
    );
  } else if (mode === 'done') {
    card = (
      <Pressable
        onPress={clearTutorialCelebration}
        accessibilityRole="button"
        accessibilityLabel={`${line} Continue`}
        testID="tutorial-done-line"
        accessibilityLiveRegion="polite"
      >
        {header(true, false)}
        <View style={styles.doneRow}>
          <Ionicons name="checkmark" size={18} color={sc.textPrimary} />
          <Text style={[styles.body, styles.grow, { color: sc.textPrimary }]}>{line}</Text>
        </View>
        {progress}
      </Pressable>
    );
  } else {
    const actions: React.ReactNode[] = [];
    if (mode === 'notice') actions.push(textAction('Continue', clearTutorialNotice, 'tutorial-notice-continue'));
    else if (gate?.kind === 'ack') actions.push(textAction(gate.cta, () => dispatchTutorial({ type: 'ACK' }), 'tutorial-ack'));
    else if (gate?.kind === 'route' && gate.takeMeThere) {
      const to = gate.takeMeThere;
      actions.push(textAction('Take me there', () => onNavigate(to), 'tutorial-take-me-there'));
    }
    if (mode !== 'notice' && gate && gate.kind !== 'ack' && gate.allowDefer) {
      actions.push(textAction('Later', () => dispatchTutorial({ type: 'DEFER' }), 'tutorial-defer', true, gate.deferHint));
    }
    card = (
      <>
        {header(true, true)}
        <Text style={[styles.body, { color: sc.textPrimary }]} accessibilityLiveRegion="polite" testID="tutorial-line">
          {line}
        </Text>
        {progress}
        {actions.length ? <View style={styles.actions}>{actions}</View> : null}
      </>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="tutorial-overlay">
      {centered || mode === 'done' ? (
        <View pointerEvents="none" style={scrim()} />
      ) : spot ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="tutorial-spotlight">
          <Svg width={width} height={height}>
            <Path
              d={spotlightPath(width, height, spot.x, spot.y, spot.width, spot.height, radius.card)}
              fill={sc.overlay}
              fillRule="evenodd"
            />
            <Rect
              x={spot.x}
              y={spot.y}
              width={spot.width}
              height={spot.height}
              rx={radius.card}
              ry={radius.card}
              fill="none"
              stroke={sc.bgSurface}
              strokeWidth={1.5}
            />
          </Svg>
        </View>
      ) : null}

      <Animated.View
        pointerEvents="box-none"
        testID="tutorial-card-wrap"
        style={[
          styles.cardWrap,
          centered
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
          accessibilityViewIsModal={centered}
          testID="tutorial-card"
        >
          {card}
        </View>
      </Animated.View>

      {confirmSkip ? (
        <View style={StyleSheet.absoluteFill} testID="tutorial-skip-confirm">
          <Pressable
            style={scrim()}
            onPress={() => setConfirmSkip(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityHint="Keeps the tour going"
            testID="tutorial-skip-scrim"
          />
          <View
            style={[styles.sheet, { backgroundColor: sc.bgSurface, paddingBottom: insets.bottom + 20 }]}
            accessibilityViewIsModal
          >
            <View style={[styles.grabber, { backgroundColor: sc.border }]} />
            <Headline level="h2">Skip the tour?</Headline>
            <Text style={[styles.bodySmall, styles.sheetLede, { color: sc.textMuted }]}>
              You can pick it up again from Settings, under Tutorial.
            </Text>
            <PrimaryButton
              label="Skip tour"
              onPress={() => {
                setConfirmSkip(false);
                dispatchTutorial({ type: 'PAUSE' });
              }}
              testID="tutorial-skip-confirm-button"
              style={styles.solid}
            />
            <TextLink
              label="Keep going"
              tone="ink"
              onPress={() => setConfirmSkip(false)}
              testID="tutorial-keep-going"
              style={styles.under}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: { position: 'absolute', left: 16, right: 16 },
  cardCenter: { top: 0, bottom: 0, justifyContent: 'center' },
  card: { borderWidth: 0.5, borderRadius: radius.card, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  grow: { flex: 1 },
  romanName: { ...typography.caption, letterSpacing: 0 },
  stepCount: { ...typography.eyebrow },
  skip: { marginLeft: 8 },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 6, marginBottom: 14 },
  body: { ...typography.body },
  bodySmall: { ...typography.bodySmall },
  track: { height: 2, borderRadius: radius.chip, marginTop: 16, overflow: 'hidden' },
  fill: { height: 2 },
  doneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 8 },
  completeBody: { alignItems: 'center', paddingTop: 10 },
  completeName: { ...typography.caption, marginTop: 8, marginBottom: 14 },
  completeSub: { ...typography.bodySmall, textAlign: 'center', marginTop: 12 },
  solid: { alignSelf: 'stretch', marginTop: 20 },
  under: { marginTop: 4 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 10,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.chip, marginBottom: 18 },
  sheetLede: { marginTop: 6 },
});
