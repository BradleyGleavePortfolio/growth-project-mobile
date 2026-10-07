/**
 * ClientUpcomingSessionsScreen — confirmed upcoming sessions, with a
 * server-aware Cancel button (device cutoff is a legacy fallback).
 *
 * Filters `useMyUpcomingSessions` to `status === 'scheduled'`.
 * Quiet layout: semantic bone canvas, hairline rows, the first available
 * Join as the single forest primary, and text-only move/cancel. Join,
 * RescheduleSheet, cancellation confirmation and retry retain their effects.
 * Server lockout and cancellation errors use factual copy.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useCancelSession,
  useMyUpcomingSessions,
} from '../../hooks/useScheduling';
import type { CoachingSession } from '../../api/schedulingApi';
import { resolveVideoUrl } from '../../api/schedulingApi';
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import RescheduleSheet from './RescheduleSheet';

const LOCKOUT_MS = 4 * 60 * 60 * 1000;

export function isWithinLockout(now: Date, startIso: string): boolean {
  return new Date(startIso).getTime() - now.getTime() < LOCKOUT_MS;
}

/**
 * P3-3 / R16: never trust the device clock for authoritative lockout
 * decisions. When the backend returns a `cancellable` flag on the
 * session row, that is the truth — a user who has backdated their
 * device clock cannot bypass the lockout. Falls back to the
 * device-clock lockout only when the server omitted the flag (e.g.
 * during the rollout window before the backend ships the field).
 */
export function isSessionLocked(
  session: { start_at: string; cancellable?: boolean },
  now: Date = new Date(),
): boolean {
  if (typeof session.cancellable === 'boolean') return !session.cancellable;
  return isWithinLockout(now, session.start_at);
}

export default function ClientUpcomingSessionsScreen() {
  const { semanticColors: sc } = useTheme();
  const { data, isLoading, isError, refetch } = useMyUpcomingSessions(50);
  const cancel = useCancelSession();
  const [rescheduling, setRescheduling] = useState<CoachingSession | null>(
    null,
  );

  const upcoming = useMemo<CoachingSession[]>(
    () =>
      (data ?? [])
        .filter((s) => s.status === 'scheduled')
        .sort(
          (a, b) =>
            new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
        ),
    [data],
  );

  const onCancel = useCallback(
    (session: CoachingSession) => {
      Alert.alert(
        'Cancel session',
        'Are you sure? Your coach will be notified.',
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Cancel session',
            style: 'destructive',
            onPress: () => cancel.mutate({ id: session.id }),
          },
        ],
      );
    },
    [cancel],
  );

  const primaryJoinId = upcoming.find((s) => resolveVideoUrl(s.video_url))?.id;
  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: sc.bgPrimary }]}>
        <ActivityIndicator color={sc.accent} />
        <Text style={[typography.bodySmall, { color: sc.textMuted, marginTop: spacing.md }]}>Loading upcoming sessions.</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.centered, { backgroundColor: sc.bgPrimary }]}>
        <Text style={[typography.body, { color: sc.textPrimary }]}>
          Sessions could not be loaded. Refresh to try again.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => refetch()}
          style={[styles.primaryBtn, { backgroundColor: sc.accent }]}
        >
          <Text style={[typography.body, { color: sc.textOnAccent }]}>
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: sc.bgPrimary }}
      contentContainerStyle={styles.container}
    >
      <Text style={[typography.h1, { color: sc.textPrimary }]} accessibilityRole="header">
        Upcoming sessions
      </Text>
      {upcoming.length > 0 ? <Text style={[typography.h3, { color: sc.textPrimary, marginTop: spacing.md }]}>{`${upcoming.length} confirmed session${upcoming.length === 1 ? '' : 's'}.`}</Text> : null}

      {upcoming.length === 0 ? (
        <Text
          style={[
            typography.body,
            {
              color: sc.textMuted,
              marginTop: spacing.lg,
              textAlign: 'center',
            },
          ]}
        >
          No upcoming sessions.
        </Text>
      ) : null}

      {cancel.isError ? <Text style={[typography.bodySmall, { color: sc.textMuted }]} accessibilityLiveRegion="polite">{calendarErrorMessage(cancel.error, 'cancel the session')}</Text> : null}
      {upcoming.map((s) => {
        const locked = isSessionLocked(s);
        const busy = cancel.isPending && cancel.variables?.id === s.id;
        return (
          <View
            key={s.id}
            style={[
              styles.card,
              { borderColor: sc.border },
            ]}
          >
            <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>
              {s.title}
            </Text>
            <Text
              style={[
                typography.bodySmall,
                { color: sc.textMuted, marginTop: spacing.xs, fontVariant: ['tabular-nums'] },
              ]}
            >
              {new Date(s.start_at).toLocaleString()}
            </Text>
            {/* V-3 / C9: Join CTA. Only rendered when there is a real
                http(s) video link. resolveVideoUrl filters out null,
                tgp-stub:// URLs, and any non-http(s) scheme so stub
                sessions never show a Join button. */}
            {resolveVideoUrl(s.video_url) ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Join ${s.title}${
                  s.video_provider && s.video_provider !== 'stub'
                    ? ` on ${s.video_provider.replace(/_/g, ' ')}`
                    : ''
                }`}
                onPress={() => {
                  const url = resolveVideoUrl(s.video_url) as string;
                  Linking.openURL(url).catch(() => {
                    Alert.alert(
                      'Could not open link',
                      'Open the session from Calendar or message your coach for the call link.',
                    );
                  });
                }}
                style={[
                  styles.joinBtn,
                  { backgroundColor: s.id === primaryJoinId ? sc.accent : sc.bgPrimary, marginTop: spacing.sm },
                ]}
              >
                <Text
                  style={[typography.body, { color: s.id === primaryJoinId ? sc.textOnAccent : sc.textPrimary }]}
                >
                  Join session
                  {s.video_provider && s.video_provider !== 'stub'
                    ? ` (${s.video_provider.replace(/_/g, ' ')})`
                    : ''}
                </Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.actions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Reschedule ${s.title}`}
                disabled={locked || busy}
                onPress={() => setRescheduling(s)}
                style={[
                  styles.rescheduleBtn,
                  {
                    opacity: locked || busy ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={[typography.body, { color: sc.textPrimary }]}>
                  Reschedule
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={
                  locked
                    ? `Cancel disabled for ${s.title}`
                    : `Cancel ${s.title}`
                }
                accessibilityHint={
                  locked
                    ? 'This session can no longer be changed here.'
                    : undefined
                }
                disabled={locked || busy}
                onPress={() => onCancel(s)}
                style={[
                  styles.cancelBtn,
                  {
                    opacity: locked || busy ? 0.4 : 1,
                  },
                ]}
              >
                <Text
                  style={[typography.body, { color: sc.textPrimary }]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
            {locked ? (
              <Text
                style={[
                  typography.bodySmall,
                  { color: sc.textMuted, marginTop: spacing.xs },
                ]}
              >
                This session can no longer be changed here. Message your coach if you need help.
              </Text>
            ) : null}
          </View>
        );
      })}

      {rescheduling ? (
        <RescheduleSheet
          session={rescheduling}
          onClose={() => setRescheduling(null)}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xl,
    marginTop: spacing.lg,
  },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  rescheduleBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginRight: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginLeft: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  joinBtn: {
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
});
