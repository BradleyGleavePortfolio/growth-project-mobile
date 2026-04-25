/**
 * IdentityBadge — pill badge displaying a user's founding rank.
 *
 * Gold accent for founding members; neutral for everyone else.
 * Tap reveals a bottom sheet / tooltip explaining what "Founding Member" means.
 *
 * UX Psych #3: Identity Reinforcement / Inner Circle
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from './HapticPressable';
import { Colors, Radius, Spacing } from '../theme/index';

export interface IdentityBadgeProps {
  rank: number;
  isFoundingMember: boolean;
  /** If true, render nothing (e.g. still loading or endpoint unavailable) */
  hidden?: boolean;
}

export default function IdentityBadge({
  rank,
  isFoundingMember,
  hidden = false,
}: IdentityBadgeProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);

  if (hidden) return null;

  const badgeColor = isFoundingMember ? '#C4922A' : Colors.textMuted;       // gold vs neutral
  const badgeBg   = isFoundingMember ? 'rgba(196,146,42,0.12)' : 'rgba(143,168,154,0.12)';

  return (
    <>
      <HapticPressable
        intent="light"
        onPress={() => setTooltipVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={
          isFoundingMember
            ? `Founding Member, number ${rank}`
            : `Member number ${rank}`
        }
        accessibilityHint="Tap to learn more about your member number"
        style={[styles.badge, { backgroundColor: badgeBg }]}
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
                  <Ionicons name="star" size={32} color="#C4922A" />
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
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    marginTop: 6,
    gap: 4,
  },
  star: {
    marginRight: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 20,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.dark,
    textAlign: 'center',
    marginBottom: 12,
  },
  sheetBody: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 10,
  },
  closeBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 16,
  },
});
