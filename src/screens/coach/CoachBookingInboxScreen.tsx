/**
 * CoachBookingInboxScreen — pending booking requests, with Confirm /
 * Decline actions.
 *
 * S-SCHED-3: requests and the agenda each come from the server's status
 * filter (`status=requested`, `status=scheduled,pending_provider`), paged
 * on (start_at, id), so a busy week never hides requests behind a fixed list
 * size. Confirm and Decline send the start time the coach is looking at; a
 * request the client moved meanwhile answers SESSION_MOVED and the inbox
 * refreshes instead of confirming a time the coach never saw.
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
  useAttachManualVideoLink,
  useCancelSession,
} from '../../hooks/useScheduling';
import { useUpcomingSessionsByStatus } from '../../hooks/useCalendar';
import type { CoachingSession, SchedulingSessionStatus } from '../../api/schedulingApi';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import { normalizeCallLinkInput, resolveCallLink } from '../../api/schedulingApi';

const REQUESTED: readonly SchedulingSessionStatus[] = ['requested'];
const CONFIRMED: readonly SchedulingSessionStatus[] = ['scheduled', 'pending_provider'];

function initialLinkText(raw: string | null | undefined): string {
  const link = resolveCallLink(raw);
  if (!link) return '';
  return link.kind === 'phone' ? link.display : link.url;
}

function CoachSessionActions({ session }: { session: CoachingSession }) {
  const { colors } = useTheme();
  const attach = useAttachManualVideoLink();
  const cancel = useCancelSession();
  const [link, setLink] = useState(initialLinkText(session.video_url));
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const busy = attach.isPending || cancel.isPending;

  const save = () => {
    if (inFlight.current) return;
    const parsed = normalizeCallLinkInput(link);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return;
    }
    const url = parsed.url;
    inFlight.current = true;
    attach.mutate({ id: session.id, input: { video_url: url } }, {
      onSuccess: () =>
        setMessage(
          url.startsWith('tel:')
            ? 'Phone number saved. Your client can call it from their session.'
            : 'Call link saved. Your client can open it from their session.',
        ),
      onError: (err) => setMessage(calendarErrorMessage(err, 'save the call link', 'coach')),
      onSettled: () => { inFlight.current = false; },
    });
  };
  const onCancel = () => {
    Alert.alert('Cancel this session?', 'Your client will be told. Calendar copies must be removed in the calendar app.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel session', style: 'destructive', onPress: () => {
        if (inFlight.current) return;
        inFlight.current = true;
        cancel.mutate({ id: session.id, input: { expected_start_at: session.start_at } }, {
          onSuccess: () => setMessage('Session cancelled in TGP.'),
          onError: (err) => setMessage(calendarErrorMessage(err, 'cancel the session', 'coach')),
          onSettled: () => { inFlight.current = false; },
        });
      } },
    ]);
  };
  return (
    <View>
      <TextInput
        value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        accessibilityLabel={`Call link or phone number for ${session.title}`} placeholder="https://your-call-link or +1 425 555 0100"
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
  const requestsQ = useUpcomingSessionsByStatus(REQUESTED);
  const agendaQ = useUpcomingSessionsByStatus(CONFIRMED);
  const isLoading = requestsQ.isLoading || agendaQ.isLoading;
  const isError = requestsQ.isError;
  const error = requestsQ.error;
  const refetch = async () => {
    await Promise.all([requestsQ.refetch(), agendaQ.refetch()]);
  };
  const approve = useApproveSession();
  const decline = useDeclineSession();
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const actOnRequest = (s: CoachingSession, confirm: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setMessage(null);
    const handlers = {
      onError: (err: unknown) => {
        setMessage(calendarErrorMessage(err, confirm ? 'confirm the request' : 'decline the request', 'coach'));
        void refetch();
      },
      onSettled: () => { inFlight.current = false; },
    };
    // The start time on this card: a request moved since is refused, not confirmed.
    if (confirm) approve.mutate({ id: s.id, expectedStartAt: s.start_at }, handlers);
    else decline.mutate({ id: s.id, input: { expected_start_at: s.start_at } }, handlers);
  };

  // Server-filtered pages; the status check stays as a guard for an older
  // backend that ignores the filter.
  const pending = useMemo<CoachingSession[]>(
    () => (requestsQ.data?.pages ?? []).flat().filter((s) => s.status === 'requested'),
    [requestsQ.data],
  );
  const confirmed = useMemo<CoachingSession[]>(
    () =>
      (agendaQ.data?.pages ?? []).flat().filter(
        (s) => s.status === 'scheduled' || s.status === 'pending_provider',
      ),
    [agendaQ.data],
  );

  if (isLoading) {
    return <SkeletonScreen count={5} />;
  }

  if (isError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>
          {calendarErrorMessage(error, 'load booking requests', 'coach')}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => void refetch()}
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

      {requestsQ.hasNextPage ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Show more requests" disabled={requestsQ.isFetchingNextPage} onPress={() => void requestsQ.fetchNextPage()} style={[styles.primaryBtn, { borderColor: colors.border, borderWidth: 1 }]} testID="coach-requests-more">
          <Text style={[typography.body, { color: colors.textPrimary }]}>Show more requests</Text>
        </TouchableOpacity>
      ) : null}

      <Text
        style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.xl }]}
        accessibilityRole="header"
      >
        Upcoming sessions
      </Text>
      {agendaQ.isError ? (
        <Text style={[typography.body, { color: colors.error, marginTop: spacing.md }]} testID="coach-agenda-error">
          {calendarErrorMessage(agendaQ.error, 'load upcoming sessions', 'coach')}
        </Text>
      ) : confirmed.length === 0 ? (
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
      {agendaQ.hasNextPage ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Show more upcoming sessions" disabled={agendaQ.isFetchingNextPage} onPress={() => void agendaQ.fetchNextPage()} style={[styles.primaryBtn, { borderColor: colors.border, borderWidth: 1 }]} testID="coach-agenda-more">
          <Text style={[typography.body, { color: colors.textPrimary }]}>Show more upcoming sessions</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

/** Coach agenda status line; a missing call link is a clear next action. */
export function agendaLine(s: CoachingSession): string {
  const who = s.client_name ? ` with ${s.client_name}` : '';
  const link = resolveCallLink(s.video_url);
  if (s.meeting_link_status === 'pending' || (s.meeting_link_status === undefined && !link)) {
    return `Confirmed${who}. No call link yet. Add a call link or phone number below so your client can join.`;
  }
  if (s.status === 'pending_provider') return `Confirmed${who}. Call link is being prepared.`;
  if (link?.kind === 'phone') return `Confirmed${who}. Phone call on ${link.display}.`;
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
