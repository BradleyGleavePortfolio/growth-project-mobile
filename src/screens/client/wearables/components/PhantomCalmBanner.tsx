/**
 * PhantomCalmBanner — the reassurance-before-deficit surface (UX gate §5.2).
 *
 * Phantom/CALM treatment: a deficit number is NEVER shown alone or first. The
 * reassurance copy leads (rendered large), and the number follows below
 * (smaller, calm). This banner enforces that order structurally so a caller
 * cannot accidentally lead with the deficit.
 *
 *   reassurance = "You're close —"     (large, warm-neutral, leads)
 *   deficit     = "about 45 min under your sleep need"  (smaller, below)
 *
 * Colour: cool/neutral only. NEVER red. An optional `tone='attention'` switches
 * to a SOFT AMBER accent — reserved for genuine clinical-attention copy (e.g.
 * sustained low SpO2), never for ordinary "low score" framing.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { RECOVERY_PALETTE } from '../recoveryTheme';

export interface PhantomCalmBannerProps {
  /** Reassurance copy — ALWAYS rendered first/large. Required by design. */
  reassurance: string;
  /** The deficit/number copy — rendered below, smaller, calm. */
  deficit: string;
  colors: ThemeColors;
  /** 'calm' (default, cool/neutral) | 'attention' (soft amber, clinical only). */
  tone?: 'calm' | 'attention';
  testID?: string;
}

export function PhantomCalmBanner({
  reassurance,
  deficit,
  colors,
  tone = 'calm',
  testID,
}: PhantomCalmBannerProps) {
  const accent = tone === 'attention' ? RECOVERY_PALETTE.attention : RECOVERY_PALETTE.accent;
  const styles = makeStyles(colors, accent);
  return (
    <View
      style={styles.wrap}
      testID={testID ?? 'phantom-calm-banner'}
      accessibilityRole="summary"
      // VoiceOver reads reassurance first, then the number — same order as sighted.
      accessibilityLabel={`${reassurance} ${deficit}`}
    >
      <View style={styles.accentBar} />
      <View style={styles.body}>
        <Text style={styles.reassurance} testID="phantom-calm-reassurance">
          {reassurance}
        </Text>
        <Text style={styles.deficit} testID="phantom-calm-deficit">
          {deficit}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors, accent: string) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    accentBar: { width: 3, backgroundColor: accent },
    body: { flex: 1, paddingVertical: 14, paddingHorizontal: 16 },
    reassurance: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.textPrimary,
      letterSpacing: 0.2,
    },
    deficit: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 4,
    },
  });
}

export default PhantomCalmBanner;
