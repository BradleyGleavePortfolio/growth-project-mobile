/**
 * MilestoneProgress — UX Psych #4 "Healthy Anticipation"
 *
 * Displays a polished animated progress bar for a single milestone.
 *
 * Animations:
 *   • Mount: bar fills from 0 → progress% over 600 ms, easeOut cubic (Animated API).
 *   • Anticipation pulse: when progress ≥ 80% of target, the bar shimmers with a
 *     repeating opacity pulse to signal "you're almost there".
 *
 * Tapping the card fires the `milestone_progress_viewed` analytics event once
 * and navigates/expands (hook provided via onPress prop).
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { Colors, colors, Spacing, Radius } from '../../theme/index';
import tokens from '../../theme/tokens';
import { track } from '../../lib/analytics';
import { Milestone, milestoneRemainingCopy } from '../../lib/milestones';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MilestoneProgressProps {
  milestone: Milestone;
  /** Called when user taps the card */
  onPress?: () => void;
  /** True when the parent user is a founding member → gold border accent */
  isFoundingMember?: boolean;
  style?: ViewStyle;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BAR_FILL_DURATION = 600; // ms
const PULSE_DURATION     = 900; // ms per half-cycle
const ANTICIPATION_PCT   = 0.8; // trigger pulse above this fill ratio

// Category icon map
const CATEGORY_ICON: Record<string, string> = {
  streak:   'flame',
  workouts: 'barbell',
  identity: 'ribbon',
};

// Category colour map (using theme tokens)
const CATEGORY_COLOR: Record<string, string> = {
  streak:   colors.data.streak,     // terra-cotta (#E76F51)
  workouts: Colors.primary,         // deep green
  identity: tokens.gold[500],       // gold
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MilestoneProgress({
  milestone,
  onPress,
  isFoundingMember = false,
  style,
}: MilestoneProgressProps) {
  const { currentValue, targetValue, label, unlockReward, category } = milestone;

  const fillRatio   = targetValue > 0 ? Math.min(currentValue / targetValue, 1) : 0;
  const pct         = Math.round(fillRatio * 100);
  const isNearGoal  = fillRatio >= ANTICIPATION_PCT;
  const accentColor = CATEGORY_COLOR[category] ?? Colors.primary;

  // ── Animations ──────────────────────────────────────────────────────────────
  const fillAnim  = useRef(new Animated.Value(0)).current;
  // Bar fill on mount
  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue:         fillRatio,
      duration:        BAR_FILL_DURATION,
      easing:          Easing.out(Easing.cubic),
      useNativeDriver: false, // width% cannot use native driver
    }).start();
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wave 1: Pulse shimmer animation removed (luxury repositioning)

  // ── Analytics ───────────────────────────────────────────────────────────────
  useEffect(() => {
    track('milestone_progress_viewed', {
      slug:          milestone.slug,
      category:      milestone.category,
      progress_pct:  pct,
      is_near_goal:  isNearGoal,
    });
  // One-shot on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePress = () => {
    track('milestone_progress_tapped', { slug: milestone.slug, progress_pct: pct });
    onPress?.();
  };

  // ── Interpolations ──────────────────────────────────────────────────────────
  // Bar width as percentage string
  const barWidth = fillAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  const iconName = CATEGORY_ICON[category] ?? 'trophy';

  return (
    <HapticPressable
      intent="light"
      onPress={handlePress}
      style={[
        styles.card,
        isFoundingMember && styles.cardFounder,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Milestone: ${label}, ${pct}% complete`}
      accessibilityHint="Tap for milestone details"
    >
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: accentColor + '1A' }]}>
          <Ionicons name={iconName as any} size={16} color={accentColor} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
          <Text style={styles.valueLine}>
            {currentValue} / {targetValue} {category === 'streak' ? 'days' : 'workouts'}
          </Text>
        </View>
        {/* Percentage badge */}
        <View style={[styles.pctBadge, { backgroundColor: accentColor + '1A' }]}>
          <Text style={[styles.pctText, { color: accentColor }]}>{pct}%</Text>
        </View>
      </View>

      {/* Progress bar track */}
      <View style={styles.track}>
        {/* Animated fill */}
        <Animated.View
          style={[
            styles.fill,
            { width: barWidth, backgroundColor: accentColor },
          ]}
        />


      </View>

      {/* Motivational copy */}
      <Text style={styles.remainingCopy} numberOfLines={2}>
        {milestoneRemainingCopy(milestone)}
      </Text>

      {/* Reward hint */}
      <View style={styles.rewardRow}>
        <Ionicons name="gift-outline" size={12} color={Colors.textMuted} />
        <Text style={styles.rewardText} numberOfLines={1}>{unlockReward}</Text>
      </View>
    </HapticPressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    padding:         Spacing.md,
    // Subtle card shadow
    shadowColor:     Colors.dark,
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.06,
    shadowRadius:    6,
    elevation:       2,
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  cardFounder: {
    borderColor: tokens.gold.border,
    borderWidth: 1.5,
  },
  headerRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
    marginBottom:   12,
  },
  iconWrap: {
    width:           32,
    height:          32,
    borderRadius:    16,
    justifyContent:  'center',
    alignItems:      'center',
    flexShrink:      0,
  },
  headerText: {
    flex: 1,
    gap:  2,
  },
  label: {
    fontSize:      14,
    fontWeight:    '700',
    color:         Colors.dark,
    letterSpacing: 0.1,
  },
  valueLine: {
    fontSize:  12,
    fontWeight: '500',
    color:     Colors.textMuted,
  },
  pctBadge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      Radius.full,
    flexShrink:        0,
  },
  pctText: {
    fontSize:   11,
    fontWeight: '700',
  },

  // Progress bar
  track: {
    height:           8,
    backgroundColor:  Colors.border,
    borderRadius:     Radius.full,
    overflow:         'hidden',
    marginBottom:     10,
    position:         'relative',
  },
  fill: {
    position:     'absolute',
    top:          0,
    left:         0,
    height:       '100%',
    borderRadius: Radius.full,
  },
  // Copy
  remainingCopy: {
    fontSize:     13,
    fontWeight:   '600',
    color:        Colors.dark,
    marginBottom: 6,
    lineHeight:   18,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  rewardText: {
    fontSize: 11,
    color:    Colors.textMuted,
    flex:     1,
  },
});
