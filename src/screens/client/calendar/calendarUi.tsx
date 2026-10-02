/**
 * calendarUi — small shared pieces for the S-SCHED client Calendar screens.
 * Plain words, no emoji, no exclamation marks (TGP copy rules).
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SchedulingSessionStatus } from '../../../api/schedulingApi';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, spacing, typography } from '../../../theme/tokens';

export function statusLabel(status: SchedulingSessionStatus): string {
  switch (status) {
    case 'requested':
      return 'Requested, waiting for your coach';
    case 'scheduled':
      return 'Confirmed';
    case 'pending_provider':
      return 'Booked, call link is being prepared';
    case 'declined':
      return 'Not accepted';
    case 'canceled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    case 'no_show':
      return 'Missed';
    default:
      return 'Status unavailable. Refresh Calendar or message your coach.';
  }
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: sc.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  const { semanticColors: sc } = useTheme();
  const style = [styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }];
  if (!onPress) {
    return (
      <View style={style} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  testID,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  accessibilityHint?: string;
}) {
  const { semanticColors: sc } = useTheme();
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[styles.primary, { backgroundColor: off ? sc.disabledBg : sc.accent }]}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator color={sc.textOnAccent} />
      ) : (
        <Text style={[styles.primaryText, { color: off ? sc.textOnDisabled : sc.textOnAccent }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  testID,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
}) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.secondary, { borderColor: sc.textPrimary, opacity: disabled ? 0.5 : 1 }]}
      testID={testID}
    >
      <Text style={[styles.secondaryText, { color: sc.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function Note({ text, testID }: { text: string; testID?: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Text style={[styles.note, { color: sc.textMuted }]} testID={testID} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

export function Body({ children, muted, testID }: { children: React.ReactNode; muted?: boolean; testID?: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Text style={[styles.body, { color: muted ? sc.textMuted : sc.textPrimary }]} testID={testID}>
      {children}
    </Text>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Text style={[styles.title, { color: sc.textPrimary }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export const calendarStyles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gap: { height: spacing.md },
  /** Body-small text for inline support fallbacks (matches Note). */
  noteText: { ...typography.bodySmall },
});

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
  sectionTitle: { ...typography.caption, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  primary: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  primaryText: { ...typography.bodyMd },
  secondary: {
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  secondaryText: { ...typography.bodyMd },
  note: { ...typography.bodySmall, marginTop: spacing.sm },
  body: { ...typography.body },
  title: { ...typography.h2, marginBottom: spacing.sm },
});
