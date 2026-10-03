/**
 * ClientUpcomingSessionsScreen — confirmed upcoming sessions, with a
 * lockout-aware Cancel button (disabled when < 4h before start).
 *
 * Filters `useMyUpcomingSessions` to `status === 'scheduled'`.
 *
 * B-NOTIF-6: a booking push opens this screen with `params.sessionId`; that
 * session is outlined and scrolled into view. When it is no longer scheduled
 * (cancelled or declined), a short line says so above the list.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
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

/** The session a push tap asked for: in the list, missing, or none asked. */
export function focusFor(
  upcoming: ReadonlyArray<{ id: string }>,
  requested: unknown,
): { focusedId: string | null; missing: boolean } {
  if (typeof requested !== 'string' || requested.length === 0) {
    return { focusedId: null, missing: false };
  }
  return upcoming.some((s) => s.id === requested)
    ? { focusedId: requested, missing: false }
    : { focusedId: null, missing: true };
}

interface ClientUpcomingSessionsProps {
  route?: { params?: { sessionId?: unknown } };
}

export default function ClientUpcomingSessionsScreen({ route }: ClientUpcomingSessionsProps = {}) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView | null>(null);
  const scrolledTo = useRef<string | null>(null);
  const oxblood = colors.error;
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

  const { focusedId, missing } = focusFor(upcoming, route?.params?.sessionId);

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

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={oxblood} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>
          Could not load sessions.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => refetch()}
          style={[styles.primaryBtn, { backgroundColor: oxblood }]}
        >
          <Text style={[typography.body, { color: colors.textOnPrimary }]}>
            Retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[typography.h2, { color: colors.textPrimary }]}>
        Upcoming sessions
      </Text>

      {missing ? (
        <Text
          testID="upcoming-session-missing"
          style={[typography.bodySmall, { color: colors.textMuted, marginTop: spacing.sm }]}
        >
          That session is no longer scheduled. Your upcoming sessions are below.
        </Text>
      ) : null}

      {upcoming.length === 0 ? (
        <Text
          style={[
            typography.body,
            {
              color: colors.textMuted,
              marginTop: spacing.lg,
              textAlign: 'center',
            },
          ]}
        >
          No upcoming sessions.
        </Text>
      ) : null}

      {upcoming.map((s) => {
        const locked = isSessionLocked(s);
        const busy = cancel.isPending && cancel.variables?.id === s.id;
        const focused = s.id === focusedId;
        return (
          <View
            key={s.id}
            testID={focused ? 'upcoming-session-focused' : undefined}
            onLayout={
              focused
                ? (e) => {
                    // Once per requested session, so a refetch does not
                    // pull the list back while the client scrolls.
                    if (scrolledTo.current === s.id) return;
                    scrolledTo.current = s.id;
                    scrollRef.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: true });
                  }
                : undefined
            }
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: focused ? oxblood : colors.border,
                borderWidth: focused ? 2 : 1,
              },
            ]}
          >
            <Text style={[typography.h3, { color: colors.textPrimary }]}>
              {s.title}
            </Text>
            <Text
              style={[
                typography.bodySmall,
                { color: colors.textMuted, marginTop: spacing.xs },
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
                      'Copy the link from your email or message your coach.',
                    );
                  });
                }}
                style={[
                  styles.joinBtn,
                  { backgroundColor: oxblood, marginTop: spacing.sm },
                ]}
              >
                <Text
                  style={[typography.body, { color: colors.textOnPrimary }]}
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
                    borderColor: oxblood,
                    opacity: locked || busy ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={[typography.body, { color: oxblood }]}>
                  Reschedule
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={
                  locked
                    ? `Cancel disabled: less than 4 hours before start`
                    : `Cancel ${s.title}`
                }
                accessibilityHint={
                  locked
                    ? 'Cancellations close 4 hours before the session starts.'
                    : undefined
                }
                disabled={locked || busy}
                onPress={() => onCancel(s)}
                style={[
                  styles.cancelBtn,
                  {
                    backgroundColor: oxblood,
                    opacity: locked || busy ? 0.4 : 1,
                  },
                ]}
              >
                <Text
                  style={[typography.body, { color: colors.textOnPrimary }]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
            {locked ? (
              <Text
                style={[
                  typography.bodySmall,
                  { color: colors.textMuted, marginTop: spacing.xs },
                ]}
              >
                Cancellations close 4h before the session.
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
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  rescheduleBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginRight: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginLeft: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryBtn: {
    marginTop: spacing.md,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  joinBtn: {
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
});
