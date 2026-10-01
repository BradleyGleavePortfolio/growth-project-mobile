/**
 * FullMacrosIntroCard — one quiet Roman card, shown once, on the day a
 * never-tracker's lighter first week ends (clinic onboarding contract v1
 * addition 8; owner ruling 2026-09-30 18:11).
 *
 * Visible only when the client started in the 'simple' macro view, that view
 * has ended (simple_until passed, or the server now reports 'full'), and the
 * client has not dismissed it. Dismissal is persisted per user
 * (macroDisplayStore), so it never returns. A client who was never in the
 * simple view never sees it. No feature flag: without the backend field
 * nothing here can render.
 *
 * Copy is Roman's butler voice: no contractions, no exclamation marks, no
 * emoji. Numbers are the client's real targets when known, otherwise omitted.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import RomanAvatar from '../roman/RomanAvatar';
import { dismissFullMacrosIntro, useFullMacrosIntroVisible } from '../../macros/macroDisplayStore';

const fmt = (v: number): string => Math.round(v).toLocaleString('en-US');
const known = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export function fullMacrosIntroLine(carbsG?: number | null, fatG?: number | null): string {
  const numbers =
    known(carbsG) && known(fatG)
      ? `: ${fmt(carbsG)} grams of carbohydrate and ${fmt(fatG)} grams of fat a day`
      : '';
  return `Your first week is behind you. From today, Home also shows carbohydrate and fat${numbers}. Calories and protein still come first. Fill in the other two as you go.`;
}

export function FullMacrosIntroCardView({
  carbsG,
  fatG,
  onDismiss,
}: {
  carbsG?: number | null;
  fatG?: number | null;
  onDismiss: () => void;
}): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const line = fullMacrosIntroLine(carbsG, fatG);
  return (
    <View
      style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}
      testID="full-macros-intro-card"
    >
      <View style={styles.head}>
        <RomanAvatar crop="neutral" size={32} testID="full-macros-intro-roman" />
        <Text style={[styles.eyebrow, { color: sc.textMuted }]}>FROM ROMAN</Text>
      </View>
      <Text style={[styles.body, { color: sc.textPrimary }]} accessibilityRole="text">
        {line}
      </Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Understood. Dismiss this note."
        testID="full-macros-intro-dismiss"
        style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.ctaText, { color: sc.textPrimary }]}>Understood</Text>
      </Pressable>
    </View>
  );
}

/** Store-connected card for Home. Renders nothing unless it is due. */
export default function FullMacrosIntroCard({
  carbsG,
  fatG,
}: {
  carbsG?: number | null;
  fatG?: number | null;
}): React.ReactElement | null {
  const visible = useFullMacrosIntroVisible();
  if (!visible) return null;
  return (
    <FullMacrosIntroCardView carbsG={carbsG} fatG={fatG} onDismiss={() => dismissFullMacrosIntro()} />
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
    borderRadius: radius.lg,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
    marginBottom: 24,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { ...typography.eyebrow, marginLeft: 12 },
  body: { ...typography.body, marginTop: 12 },
  cta: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 4 },
  ctaText: { ...typography.bodyMd },
});
