/**
 * C7 Style B parts for the auth screens (featureFlags.firstRunV2, MOCKUP3/C7
 * index-b-join slice 1): the round back button, the surface field card with
 * its overline inside, and the "or" line that shows only under a provider
 * button on screen. Presentation only: every handler stays in its screen.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, lightTokens, radius, typography, type SemanticTokens } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';

/** Read at render, so a test can switch it per file. */
export const authStyleB = (): boolean => featureFlags.firstRunV2;

export function RoundBack({ onBack, label = 'Back', testID }: { onBack: () => void; label?: string; testID?: string }) {
  const { semanticColors: sc = lightTokens } = useTheme();
  return (
    <View style={s.topBar} testID={testID}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID ? `${testID}-back` : undefined}
        style={({ pressed }) => [s.back, { backgroundColor: sc.bgSurface, borderColor: sc.border }, pressed && s.pressed]}
      >
        <Ionicons name="chevron-back" size={22} color={sc.textPrimary} />
      </Pressable>
    </View>
  );
}

/** Field card, provider and "or" styles; CreateAccount lays them over its own styles of the same names. */
export const styleBFieldStyles = (sc: SemanticTokens) =>
  StyleSheet.create({
    inputGroup: {
      backgroundColor: sc.bgSurface,
      borderColor: sc.border,
      borderWidth: 1,
      borderRadius: radius.card,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 4,
      marginBottom: 12,
    },
    inputLabel: { ...typography.eyebrow, color: sc.textMuted },
    input: { ...typography.body, color: sc.textPrimary, minHeight: layout.touchMin, paddingVertical: 8, borderBottomWidth: 0 },
    cardHint: { ...typography.bodySmall, color: sc.textMuted, paddingBottom: 8 },
    // The sign-in error darkens the outline (no red, MOCK-C7 B_error).
    invalid: { borderColor: sc.textPrimary, borderWidth: 1.5 },
    divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: sc.border },
    dividerText: { ...typography.bodySmall, color: sc.textMuted, marginHorizontal: 12 },
    googleButton: {
      minHeight: layout.buttonHeight,
      borderRadius: radius.button,
      borderWidth: 1,
      borderColor: sc.border,
      backgroundColor: sc.bgSurface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    googleButtonText: { ...typography.bodyMd, color: sc.textPrimary },
    providers: { gap: 12 },
  });

export function FieldCard({
  label,
  invalid = false,
  trailing,
  children,
  testID,
}: {
  label: string;
  invalid?: boolean;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  const { semanticColors: sc = lightTokens } = useTheme();
  const f = useMemo(() => styleBFieldStyles(sc), [sc]);
  return (
    <View testID={testID} style={[f.inputGroup, invalid && f.invalid]}>
      <Text style={f.inputLabel}>{label}</Text>
      <View style={s.row}>
        <View style={s.fill}>{children}</View>
        {trailing}
      </View>
    </View>
  );
}

/** "or" between the provider buttons and the form; the caller shows it only under a visible provider. */
export function OrLine({ testID }: { testID?: string }) {
  const { semanticColors: sc = lightTokens } = useTheme();
  const f = useMemo(() => styleBFieldStyles(sc), [sc]);
  return (
    <View style={f.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID}>
      <View style={f.dividerLine} />
      <Text style={f.dividerText}>or</Text>
      <View style={f.dividerLine} />
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { minHeight: 56, paddingHorizontal: layout.gutter - 8, justifyContent: 'center' },
  back: {
    width: 48,
    height: 48,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
});
