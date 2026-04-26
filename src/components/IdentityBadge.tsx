/**
 * IdentityBadge — pill badge displaying a user's founding rank.
 *
 * Gold accent for founding members; neutral for everyone else.
 * Tap reveals a bottom sheet / tooltip explaining what "Founding Member" means.
 *
 * UX Psych #3: Identity Reinforcement / Inner Circle
 * UX Psych #4: Healthy Anticipation — entrance animation (slide up 12px + fade, 240ms).
 * UX Psych #5: Premium Visual System — gold shimmer on mount for founders.
 *                                      Founding members get a gold border accent.
 *
 * Shimmer implementation:
 *   • Animated.Value drives translateX from -badgeWidth to +badgeWidth over 1.2 s.
 *   • A semi-opaque white overlay is clipped to the badge bounds (overflow: hidden).
 *   • Runs once on mount (no loop); settles cleanly so badge looks crisp at rest.
 *   • Uses React Native Animated API only — no Skia, no Lottie.
 *
 * Entrance animation (Psych #4):
 *   • translateY: +12 → 0, opacity: 0 → 1, duration 240 ms, easeOut.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from './HapticPressable';
import { Colors, Radius, Spacing } from '../theme/index';
import tokens from '../theme/tokens';
import { track } from '../lib/analytics';

export interface IdentityBadgeProps {
  rank: number;
  isFoundingMember: boolean;
  /** If true, render nothing (e.g. still loading or endpoint unavailable) */
  hidden?: boolean;
}

// ─── Entrance animation hook ─────────────────────────────────────────────────

/** Slide-up + fade-in entrance: 240 ms easeOut, runs once on mount. */
function useEntrance() {
  const translateY = useRef(new Animated.Value(12)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue:         0,
        duration:        240,
        easing:          Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue:         1,
        duration:        240,
        easing:          Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { translateY, opacity };
}


export default function IdentityBadge({
  rank,
  isFoundingMember,
  hidden = false,
}: IdentityBadgeProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const entrance = useEntrance();

  // Psych Report #4: Analytics — identity_badge_viewed fires on mount
  useEffect(() => {
    if (!hidden) {
      track('identity_badge_viewed', { rank, is_founding_member: isFoundingMember });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  if (hidden) return null;

  // ── Colour config ──────────────────────────────────────────────────────────
  const badgeColor  = isFoundingMember ? tokens.gold[500] : Colors.textMuted;
  const badgeBg     = isFoundingMember ? tokens.gold[100] : 'rgba(143,168,154,0.12)';
  const borderColor = isFoundingMember ? tokens.gold.border : 'transparent';


  return (
    <Animated.View
      style={{
        transform: [{ translateY: entrance.translateY }],
        opacity:   entrance.opacity,
      }}
    >
      <HapticPressable
        intent="light"
        onPress={() => {
          track('identity_badge_tapped', { rank, is_founding_member: isFoundingMember });
          setTooltipVisible(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          isFoundingMember
            ? `Founding Member, number ${rank}`
            : `Member number ${rank}`
        }
        accessibilityHint="Tap to learn more about your member number"
        style={[
          styles.badge,
          { backgroundColor: badgeBg, borderColor },
        ]}
      >
        {isFoundingMember && (
          <Ionicons name="star" size={11} color={badgeColor} style={styles.star} />
        )}
        <Text style={[styles.label, { color: badgeColor }]}>
          {isFoundingMember ? 'Founding Member' : 'Member'} · #{rank.toLocaleString()}
        </Text>


      </HapticPressable>

      {/* Tooltip / bottom-sheet modal */}
      <Modal
        visible={tooltipVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setTooltipVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setTooltipVisible(false)}>
          <View style={styles.sheet}>
            {/* Drag handle */}
            <View style={styles.handle} />

            {isFoundingMember ? (
              <>
                <View style={styles.iconRow}>
                  <Ionicons name="star" size={32} color={tokens.gold[500]} />
                </View>
                <Text style={styles.sheetTitle}>You're a Founding Member</Text>
                <Text style={styles.sheetBody}>
                  You joined when this app was brand new — before most people
                  even knew it existed. Member #{rank.toLocaleString()} out of
                  the first 1,000. That's not luck; that's vision.
                </Text>
                <Text style={styles.sheetBody}>
                  Founding Members helped shape what The Growth Project became.
                  Your early commitment made this community real.
                </Text>
              </>
            ) : (
              <>
                <View style={styles.iconRow}>
                  <Ionicons name="people" size={32} color={Colors.primary} />
                </View>
                <Text style={styles.sheetTitle}>Member #{rank.toLocaleString()}</Text>
                <Text style={styles.sheetBody}>
                  This is your unique spot in The Growth Project community.
                  Every person here is working toward something. You're one
                  of them.
                </Text>
              </>
            )}

            <HapticPressable
              intent="light"
              style={styles.closeBtn}
              onPress={() => setTooltipVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.closeBtnText}>Got it</Text>
            </HapticPressable>
          </View>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: tokens.spacing.md,        // 12
    paddingVertical:   tokens.spacing.xs,         // 4
    borderRadius:      tokens.radius.pill,
    marginTop:         tokens.spacing.sm - 2,     // 6
    gap:               tokens.spacing.xs,         // 4
    borderWidth:       1,
    // overflow hidden clips the shimmer inside the pill
    overflow:          'hidden',
  },
  star: {
    marginRight: 1,
  },
  label: {
    fontSize:      tokens.typography.caption.fontSize,   // 11
    fontWeight:    '600',
    letterSpacing: tokens.typography.caption.letterSpacing,
  },

  // Modal
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'flex-end',
  },
  sheet: {
    backgroundColor:     Colors.surface,
    borderTopLeftRadius:  tokens.radius['2xl'],
    borderTopRightRadius: tokens.radius['2xl'],
    paddingHorizontal:   Spacing.lg,
    paddingBottom:       Platform.OS === 'ios' ? 40 : 24,
    paddingTop:          tokens.spacing.md,
  },
  handle: {
    width:            40,
    height:           4,
    borderRadius:     2,
    backgroundColor:  Colors.border,
    alignSelf:        'center',
    marginBottom:     tokens.spacing.xl,
  },
  iconRow: {
    alignItems:   'center',
    marginBottom: tokens.spacing.md,
  },
  sheetTitle: {
    fontSize:     tokens.typography.h3.fontSize,
    fontWeight:   '800',
    color:        Colors.dark,
    textAlign:    'center',
    marginBottom: tokens.spacing.md,
  },
  sheetBody: {
    fontSize:     tokens.typography.body.fontSize,
    color:        Colors.textMuted,
    textAlign:    'center',
    lineHeight:   tokens.typography.body.lineHeight,
    marginBottom: tokens.spacing.sm,
  },
  closeBtn: {
    marginTop:        tokens.spacing.xl,
    backgroundColor:  Colors.primary,
    borderRadius:     tokens.radius.md,
    paddingVertical:  14,
    alignItems:       'center',
  },
  closeBtnText: {
    color:      Colors.white,
    fontWeight: '700',
    fontSize:   tokens.typography.body.fontSize,
  },
});
