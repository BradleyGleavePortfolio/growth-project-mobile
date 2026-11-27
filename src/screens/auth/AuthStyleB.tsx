/**
 * C7 Style B parts for the auth screens (featureFlags.firstRunV2, MOCKUP3/C7
 * index-b-join slice 1): the round back button, the surface field card with
 * its overline inside, and the "or" line that shows only under a provider
 * button on screen. Presentation only: every handler stays in its screen.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { colors, colors as palette, darkTokens, layout, lightTokens, radius, spacing, typography, type SemanticTokens } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';

/** Read at render, so a test can switch it per file. */
export const authStyleB = (): boolean => featureFlags.firstRunV2;

/** Google's existing four-colour mark, decorative beside the provider button's label. */
export function GoogleMark({ testID }: { testID: string }): React.ReactElement {
  return (
    <View style={s.googleMark} accessible={false} importantForAccessibility="no-hide-descendants" testID={testID}>
      <Svg width={18} height={18} viewBox="0 0 48 48">
        <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </Svg>
    </View>
  );
}

/** Where the client is on the sign-up path (C7 Style B step bars and pill; LS-E4R2 B3). */
export interface SignupStep { n: number; of: number }

export function RoundBack({ onBack, label = 'Back', testID, step }: { onBack: () => void; label?: string; testID?: string; step?: SignupStep }) {
  const { semanticColors: sc = lightTokens } = useTheme();
  return (
    <View style={[s.topBar, step && s.topRow]} testID={testID}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID ? `${testID}-back` : undefined}
        style={({ pressed }) => [s.back, { backgroundColor: palette.cream }, pressed && s.pressed]}
      >
        <Ionicons name="chevron-back" size={22} color={sc.textPrimary} />
      </Pressable>
      {/* The pill reads the step; the bars are drawn only (no second announcement). */}
      {step ? (
        <View style={s.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="signup-step-bars">
          {Array.from({ length: step.of }, (_, i) => (
            <View key={i} style={[s.bar, { backgroundColor: i < step.n ? sc.accent : sc.border }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** "Step n of m" under the bars; the count is the client's own path (role, account, inbox; no role step from a link). */
export function StepPill({ step }: { step: SignupStep }) {
  const { semanticColors: sc = lightTokens } = useTheme();
  return (
    <View style={[s.pill, { backgroundColor: sc === darkTokens ? sc.bgSurface : colors.cream }]} testID="signup-step-pill">
      <Text style={[s.pillText, { color: sc.textPrimary }]}>{`Step ${step.n} of ${step.of}`}</Text>
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
    googleButtonText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: sc.textPrimary },
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
  googleMark: { marginRight: spacing.sm },
  topBar: { minHeight: 56, paddingHorizontal: layout.gutter - 8, justifyContent: 'center' },
  back: {
    width: 48,
    height: 48,
    borderRadius: radius.chip,
    // C7 Style B draws every auth back button as a cream disc with no outline (B_signin, B_error, B_create, B_role,
    // B_reset; FIX-935R1, m#935 B3).
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 16 },
  bars: { flex: 1, flexDirection: 'row', gap: 4, paddingRight: 8 },
  bar: { flex: 1, height: 4, borderRadius: radius.chip },
  pill: { alignSelf: 'flex-start', borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  pillText: { ...typography.bodySmall, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
});
