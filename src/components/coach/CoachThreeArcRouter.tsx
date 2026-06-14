/**
 * CoachThreeArcRouter — Roman ED.2 three-arc check-in / brief / review router
 * (coach app, Coach Home).
 *
 * Three small completion arcs sit SIDE BY SIDE — not concentric. Each arc is a
 * standalone progress ring with a small-caps label beneath it and, on tap, deep
 * links into the matching coach surface:
 *
 *   - CHECK-INS → reviewed / submitted today        → onPressCheckIns
 *   - BRIEF     → opened today (binary 0 or 1)       → onPressBrief
 *   - REVIEW    → threads reviewed / total today     → onPressReview
 *
 * This is a NEW component (R77): it intentionally does NOT import or extend the
 * client-side wearables `ThreeRingHero` (concentric Apple-Watch rings). It only
 * borrows that file's posture — real arcs at 0 percent rather than a "coming
 * soon" placeholder when there is no progress yet.
 *
 * Visual reference (brief): hairline dividers above AND below the row; a single
 * Roman voice line beneath that IS the celebration when 3/3 close (no accent
 * animation, no confetti). Quiet-luxury doctrine: NEVER fontWeight 700/800,
 * Cormorant for the arc fractions, Inter small-caps eyebrow for the labels.
 *
 * Motion: arcs render at their final fraction. When the OS "Reduce Motion"
 * setting is on we keep the identical static render — there is no entrance
 * worklet to drop, so the surface looks the same either way (kept here for the
 * a11y contract and to mirror ThreeRingHero's reduceMotion posture).
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing, typography, withAlpha } from '../../theme/tokens';
import type { DailyRings } from '../../api/coachDailyRingsApi';
import {
  romanDailyRingsCelebration,
  romanDailyRingsEncouragement,
} from '../../lib/roman/copy';

// ─── Geometry ────────────────────────────────────────────────────────────────
const ARC_SIZE = 72;
const ARC_STROKE = 6;
const ARC_RADIUS = ARC_SIZE / 2 - ARC_STROKE / 2 - 1;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;

export type CoachArcId = 'checkIns' | 'brief' | 'review';

interface ArcModel {
  readonly id: CoachArcId;
  readonly label: string;
  /** 0..1 completion fraction, clamped at render. */
  readonly progress: number;
  /** e.g. "3/5" or "1/1" — the fraction shown inside the arc. */
  readonly fraction: string;
  readonly onPress: () => void;
  readonly accessibilityHint: string;
}

export interface CoachThreeArcRouterProps {
  /** Today's three-arc counts. Pass `undefined` to render three empty arcs. */
  readonly rings?: DailyRings;
  readonly onPressCheckIns: () => void;
  readonly onPressBrief: () => void;
  readonly onPressReview: () => void;
  readonly testID?: string;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Safe division — 0 submitted/total renders an empty (0 percent) arc. */
function fractionOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return clamp01(done / total);
}

interface ArcProps {
  readonly model: ArcModel;
  readonly trackColor: string;
  readonly fillColor: string;
  readonly labelColor: string;
  readonly valueColor: string;
}

function Arc({
  model,
  trackColor,
  fillColor,
  labelColor,
  valueColor,
}: ArcProps): React.ReactElement {
  const fraction = clamp01(model.progress);
  const dashOffset = ARC_CIRCUMFERENCE * (1 - fraction);
  const center = ARC_SIZE / 2;
  const percent = Math.round(fraction * 100);

  return (
    <HapticPressable
      intent="light"
      onPress={model.onPress}
      style={styles.arcPressable}
      accessibilityRole="button"
      accessibilityLabel={`${model.label}, ${model.fraction}, ${percent} percent`}
      accessibilityHint={model.accessibilityHint}
      testID={`coach-arc-${model.id}`}
    >
      <View style={styles.arcRingWrap} pointerEvents="none">
        <Svg width={ARC_SIZE} height={ARC_SIZE}>
          <Circle
            cx={center}
            cy={center}
            r={ARC_RADIUS}
            stroke={trackColor}
            strokeWidth={ARC_STROKE}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={ARC_RADIUS}
            stroke={fillColor}
            strokeWidth={ARC_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={ARC_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            // Start the arc at 12 o'clock.
            transform={`rotate(-90 ${center} ${center})`}
          />
        </Svg>
        <View style={styles.arcCenter} pointerEvents="none">
          <Text
            style={[styles.arcValue, { color: valueColor }]}
            testID={`coach-arc-${model.id}-fraction`}
          >
            {model.fraction}
          </Text>
        </View>
      </View>
      <Text style={[styles.arcLabel, { color: labelColor }]}>
        {model.label}
      </Text>
    </HapticPressable>
  );
}

export default function CoachThreeArcRouter({
  rings,
  onPressCheckIns,
  onPressBrief,
  onPressReview,
  testID = 'coach-three-arc-router',
}: CoachThreeArcRouterProps): React.ReactElement {
  const { semanticColors: colors } = useTheme();
  // Motion note: the arcs render at their final fraction with no entrance
  // worklet (the brief's celebration is the copy line below, not an accent
  // animation), so the surface is value-identical with the OS "Reduce Motion"
  // setting on or off — there is nothing to gate, hence no motion hook here.

  const arcs = useMemo<readonly [ArcModel, ArcModel, ArcModel]>(() => {
    const checkIns = rings?.checkIns ?? { reviewed: 0, submitted: 0 };
    const briefOpened = rings?.brief.opened ?? false;
    const review = rings?.review ?? { reviewed: 0, totalConversations: 0 };

    return [
      {
        id: 'checkIns',
        label: 'CHECK-INS',
        progress: fractionOf(checkIns.reviewed, checkIns.submitted),
        fraction: `${checkIns.reviewed}/${checkIns.submitted}`,
        onPress: onPressCheckIns,
        accessibilityHint: 'Opens your clients to review submitted check-ins',
      },
      {
        id: 'brief',
        label: 'BRIEF',
        progress: briefOpened ? 1 : 0,
        fraction: briefOpened ? '1/1' : '0/1',
        onPress: onPressBrief,
        accessibilityHint: "Opens today's coach brief",
      },
      {
        id: 'review',
        label: 'REVIEW',
        progress: fractionOf(review.reviewed, review.totalConversations),
        fraction: `${review.reviewed}/${review.totalConversations}`,
        onPress: onPressReview,
        accessibilityHint: 'Opens your message threads to review',
      },
    ];
  }, [rings, onPressCheckIns, onPressBrief, onPressReview]);

  const allClosed = arcs.every((a) => clamp01(a.progress) >= 1);
  const voiceLine = allClosed
    ? romanDailyRingsCelebration
    : romanDailyRingsEncouragement;

  const trackColor = withAlpha(colors.accent, 0.16);

  return (
    <View
      style={styles.wrap}
      testID={testID}
      accessibilityRole="summary"
      accessibilityState={{ busy: false }}
    >
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.row}>
        {arcs.map((model) => (
          <Arc
            key={model.id}
            model={model}
            trackColor={trackColor}
            fillColor={colors.accent}
            labelColor={colors.textMuted}
            valueColor={colors.textPrimary}
          />
        ))}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <Text
        style={[styles.voiceLine, { color: colors.textMuted }]}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        testID="coach-three-arc-voice-line"
      >
        {voiceLine}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingVertical: spacing.lg,
  },
  arcPressable: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  arcRingWrap: {
    width: ARC_SIZE,
    height: ARC_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arcCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arcValue: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  arcLabel: {
    ...typography.eyebrow,
  },
  voiceLine: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
