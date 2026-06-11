/**
 * MonogramBadge — a compact client avatar for dense coach rows (inbox, member
 * lists). Renders the client's photo when `avatarUrl` is present, otherwise a
 * deterministic monogram tile built from the client's name. This is the
 * "client avatar + monogram badge fallback" the v1-6 inbox brief calls for.
 *
 * Distinct from RomanAvatar: this represents a CLIENT, not Roman. Roman's
 * monogram crop is reserved for Roman; a client monogram derives its initials
 * and a stable hue from the client's own name so two clients are visually
 * distinguishable in a long list.
 *
 * Colours come from semanticColors / a small hue ramp — no raw ad-hoc hex.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/useTheme';

export interface MonogramBadgeProps {
  /** Display name used to derive initials + a stable tile hue. */
  name: string;
  /** Optional remote avatar. When present, the photo replaces the monogram. */
  avatarUrl?: string | null;
  /** Square size in px. Default 40 (dense row). */
  size?: number;
  testID?: string;
}

/** Up-to-two-letter initials from a display name (first + last token). */
function initialsOf(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 1).toUpperCase();
  return (
    tokens[0].slice(0, 1) + tokens[tokens.length - 1].slice(0, 1)
  ).toUpperCase();
}

/** Stable index into the tint ramp from the name (no Math.random). */
function hueIndex(name: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % modulo;
}

export default function MonogramBadge({
  name,
  avatarUrl,
  size = 40,
  testID,
}: MonogramBadgeProps): React.ReactElement {
  const { semanticColors } = useTheme();

  // A small, theme-anchored tint ramp. These are derived tints layered over the
  // surface so the monogram reads on both light and dark backgrounds; the text
  // always uses the high-contrast primary ink.
  const tints = [
    semanticColors.disabledBg,
    semanticColors.border,
    semanticColors.bgSurface,
  ];

  if (avatarUrl) {
    return (
      <Image
        testID={testID}
        source={{ uri: avatarUrl }}
        accessibilityRole="image"
        accessibilityLabel={name}
        style={[
          styles.tile,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      />
    );
  }

  const bg = tints[hueIndex(name, tints.length)];
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderColor: semanticColors.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Text
        style={[
          styles.mark,
          { fontSize: size * 0.4, color: semanticColors.textPrimary },
        ]}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  mark: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
