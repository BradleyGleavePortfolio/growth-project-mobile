/**
 * WearableCard — the shared surface chrome for every H&F / S&R card.
 *
 * One component owns the card's padding, radius, hairline, shadow, and the
 * title row (icon + label + optional trailing slot) so the five cards stay
 * visually identical (#40 single source of truth for the card frame). Cards
 * pass their body as children and an optional `onPress` to open Metric Detail.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
  withAlpha,
} from '../../../../theme/tokens';
import type { IoniconName } from '../../../../types/common';

interface Props {
  readonly title: string;
  readonly icon: IoniconName;
  readonly accent: string;
  readonly children: React.ReactNode;
  readonly onPress?: () => void;
  readonly trailing?: React.ReactNode;
  readonly style?: ViewStyle;
  readonly accessibilityHint?: string;
}

export default function WearableCard({
  title,
  icon,
  accent,
  children,
  onPress,
  trailing,
  style,
  accessibilityHint,
}: Props) {
  const Body = (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: withAlpha(accent, 0.12) }]}>
          <Ionicons name={icon} size={16} color={accent} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.spacer} />
        {trailing}
        {onPress && (
          <Ionicons name="chevron-forward" size={16} color={colors.stone} />
        )}
      </View>
      {children}
    </View>
  );

  if (!onPress) return Body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint ?? `Open ${title} detail`}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {Body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.camel, 0.25),
    padding: spacing.lg,
    ...shadows.sm,
  },
  pressed: {
    opacity: 0.85,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h4,
    color: colors.ink,
  },
  spacer: {
    flex: 1,
  },
});
