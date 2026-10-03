/**
 * calendarUi — small shared pieces for the S-SCHED client Calendar screens.
 * Plain words, no emoji, no exclamation marks (TGP copy rules).
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoachingSession, SchedulingSessionStatus } from '../../../api/schedulingApi';
import { formatWhen } from '../../../calendar/calendarTime';
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
    case 'expired':
      return 'Not confirmed in time';
    default:
      return 'Status unavailable. Refresh Calendar or message your coach.';
  }
}

/**
 * S-SCHED-5: a request past its clear time reads as expired at once, even if
 * the copy on screen was loaded before the server closed it.
 */
export function isRequestLapsed(
  s: Pick<CoachingSession, 'status' | 'request_expires_at'>,
  nowMs: number = Date.now(),
): boolean {
  if (s.status !== 'requested' || !s.request_expires_at) return false;
  const at = new Date(s.request_expires_at).getTime();
  return Number.isFinite(at) && at <= nowMs;
}

export function asSeen<T extends CoachingSession>(s: T, nowMs: number = Date.now()): T {
  return isRequestLapsed(s, nowMs)
    ? { ...s, status: 'expired', cancellable: false, reschedulable: false }
    : s;
}

/** The answer-by line on a pending request, per side. Null when unknown. */
export function requestDeadlineNote(
  s: Pick<CoachingSession, 'status' | 'request_expires_at'>,
  viewer: 'client' | 'coach',
  tz?: string,
): string | null {
  if (s.status !== 'requested' || !s.request_expires_at) return null;
  if (!Number.isFinite(new Date(s.request_expires_at).getTime())) return null;
  const when = formatWhen(s.request_expires_at, tz);
  return viewer === 'client'
    ? `Your coach has until ${when} to confirm. If they have not by then, the request closes and the time opens up again.`
    : `Answer by ${when}. After that the request closes on its own and the time opens up again.`;
}

/** Why an expired request closed, and the next step. */
export const EXPIRED_REQUEST_CLIENT_NOTE =
  'Your coach did not confirm this request in time, so it closed and the time opened up again. Pick another time whenever it suits you.';

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
