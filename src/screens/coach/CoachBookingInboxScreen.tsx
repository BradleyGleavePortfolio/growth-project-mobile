/**
 * CoachBookingInboxScreen — pending booking requests, with Confirm /
 * Decline actions.
 *
 * Backend has no dedicated "pending" endpoint. We use the session
 * list and filter to `status === 'requested'` client-side. Documented
 * in /home/user/workspace/concierge-phase1-mobile/AUDIT.md §3.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import {
  useApproveSession,
  useDeclineSession,
  useMyUpcomingSessions,
  useAttachManualVideoLink,
  useCancelSession,
} from '../../hooks/useScheduling';
import type { CoachingSession } from '../../api/schedulingApi';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import { resolveVideoUrl } from '../../api/schedulingApi';

function CoachSessionActions({ session }: { session: CoachingSession }) {
  const { colors } = useTheme();
  const attach = useAttachManualVideoLink();
  const cancel = useCancelSession();
  const [link, setLink] = useState(resolveVideoUrl(session.video_url) ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const busy = attach.isPending || cancel.isPending;

  const save = () => {
    if (inFlight.current) return;
    const url = link.trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || url.length > 2000) throw new Error('invalid');
    } catch {
      setMessage('Enter a complete https call link without a password, then tap Save call link.');
      return;
    }
    inFlight.current = true;
    attach.mutate({ id: session.id, input: { video_url: url } }, {
      onSuccess: () => setMessage('Call link saved. Your client can open it from their session.'),
      onError: (err) => setMessage(calendarErrorMessage(err, 'save the call link')),
      onSettled: () => { inFlight.current = false; },
    });
  };
  const onCancel = () => {
    Alert.alert('Cancel this session?', 'Your client will be told. Calendar copies must be removed in the calendar app.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel session', style: 'destructive', onPress: () => {
        if (inFlight.current) return;
        inFlight.current = true;
        cancel.mutate({ id: session.id }, {
          onSuccess: () => setMessage('Session cancelled in TGP.'),
          onError: (err) => setMessage(calendarErrorMessage(err, 'cancel the session')),
          onSettled: () => { inFlight.current = false; },
        });
      } },
    ]);
  };
  return (
    <View>
      <TextInput
        value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        accessibilityLabel={`Call link for ${session.title}`} placeholder="https://your-call-link"
        placeholderTextColor={colors.textMuted} maxLength={2000}
        style={[styles.linkInput, { color: colors.textPrimary, borderColor: colors.border }]}
        testID={`coach-call-link-${session.id}`}
      />
      <TouchableOpacity onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel={`Save call link for ${session.title}`} style={[styles.primaryBtn, { backgroundColor: colors.textPrimary }]} testID={`coach-save-link-${session.id}`}>
        <Text style={[typography.body, { color: colors.background }]}>Save call link</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel={`Cancel ${session.title}`} style={[styles.primaryBtn, { borderColor: colors.border, borderWidth: 1 }]} testID={`coach-cancel-session-${session.id}`}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>Cancel session</Text>
      </TouchableOpacity>
      {message ? <Text accessibilityLiveRegion="polite" style={[typography.bodySmall, { color: colors.textMuted }]}>{message}</Text> : null}
    </View>
  );
}

export default function CoachBookingInboxScreen() {
  const { colors } = useTheme();
  const oxblood = colors.error;
  const { data, isLoading, isError, error, refetch } = useMyUpcomingSessions(100);
  const approve = useApproveSession();
  const decline = useDeclineSession();
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const actOnRequest = (s: CoachingSession, confirm: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setMessage(null);
    const mutation = confirm ? approve : decline;
    mutation.mutate({ id: s.id }, {
      onError: (err) => { setMessage(calendarErrorMessage(err, confirm ? 'confirm the request' : 'decline the request')); void refetch(); },
      onSettled: () => { inFlight.current = false; },
    });
  };

  const pending = useMemo<CoachingSession[]>(
    () => (data ?? []).filter((s) => s.status === 'requested'),
    [data],
  );
  // S-SCHED: a light agenda of confirmed upcoming sessions, same data.
  const confirmed = useMemo<CoachingSession[]>(
    () =>
      (data ?? []).filter(
        (s) => s.status === 'scheduled' || s.status === 'pending_provider',
      ),
    [data],
  );

  if (isLoading) {
    return <SkeletonScreen count={5} />;
  }

  if (isError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>
          {calendarErrorMessage(error, 'load booking requests')}
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
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[typography.h2, { color: colors.textPrimary }]}>
        Pending requests
      </Text>
      {message ? <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.error }]}>{message}</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh sessions" onPress={() => void refetch()} style={[styles.primaryBtn, { borderColor: colors.border, borderWidth: 1 }]}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>Refresh sessions</Text>
      </TouchableOpacity>

      {pending.length === 0 ? (
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
          No pending requests.
        </Text>
      ) : null}

      {pending.map((s) => {
        const busy =
          (approve.isPending && approve.variables?.id === s.id) ||
          (decline.isPending && decline.variables?.id === s.id);
        return (
          <View
            key={s.id}
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
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
              {formatRange(s.start_at, s.end_at)}
            </Text>
            <Text
              style={[
                typography.bodySmall,
                { color: colors.textMuted, marginTop: spacing.xs },
              ]}
            >
              {s.client_name ? `Client: ${s.client_name}` : 'Client not named on this request'}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Confirm session ${s.title}`}
                disabled={busy}
                onPress={() => actOnRequest(s, true)}
                style={[
                  styles.confirmBtn,
                  { backgroundColor: oxblood, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={[typography.body, { color: colors.textOnPrimary }]}
                >
                  Confirm
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Decline session ${s.title}`}
                disabled={busy}
                onPress={() => actOnRequest(s, false)}
                style={[
                  styles.declineBtn,
                  { borderColor: oxblood, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text style={[typography.body, { color: oxblood }]}>
                  Decline
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <Text
        style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.xl }]}
        accessibilityRole="header"
      >
        Upcoming sessions
      </Text>
      {confirmed.length === 0 ? (
        <Text
          style={[typography.body, { color: colors.textMuted, marginTop: spacing.md }]}
          testID="coach-agenda-empty"
        >
          No confirmed sessions coming up.
        </Text>
      ) : (
        confirmed.map((s) => (
          <View
            key={s.id}
            style={[styles.card, { borderColor: colors.border }]}
            testID={`coach-agenda-${s.id}`}
          >
            <Text style={[typography.body, { color: colors.textPrimary }]}>{s.title}</Text>
            <Text style={[typography.bodySmall, { color: colors.textMuted }]}>
              {formatRange(s.start_at, s.end_at)}
            </Text>
            <Text style={[typography.bodySmall, { color: colors.textMuted }]}>
              {agendaLine(s)}
            </Text>
            <CoachSessionActions session={s} />
          </View>
        ))
      )}
    </ScrollView>
  );
}

/** Coach agenda status line; a missing call link is a clear next action. */
export function agendaLine(s: CoachingSession): string {
  const who = s.client_name ? ` with ${s.client_name}` : '';
  if (s.meeting_link_status === 'pending' || (s.meeting_link_status === undefined && !resolveVideoUrl(s.video_url))) {
    return `Confirmed${who}. No call link yet. Add one below so your client can join.`;
  }
  if (s.status === 'pending_provider') return `Confirmed${who}. Call link is being prepared.`;
  return `Confirmed${who}. Call link ready.`;
}

function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  return `${s.toLocaleString()} – ${e.toLocaleTimeString()}`;
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  linkInput: { borderWidth: 1, padding: spacing.md, marginTop: spacing.sm, ...typography.body },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  confirmBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginRight: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  declineBtn: {
    flex: 1,
    borderWidth: 1,
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
});
