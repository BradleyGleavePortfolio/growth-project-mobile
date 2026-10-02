/**
 * CalendarBookScreen — S-SCHED pick an open time and book (or move) a session.
 *
 * Slots come from the server (open-slots honours time off, booked sessions,
 * the appointment type length and the coach time zone). They are shown in
 * the client's time zone, with the coach's clock when it differs.
 *
 * Auto-approve types are confirmed instantly; others read "Requested,
 * waiting for your coach". One tap books once: the submit is locked while a
 * request is in flight. A slot taken by someone else a moment earlier
 * returns 409 and the list refreshes.
 *
 * `welcome: true` preselects the coach's welcome type from the persistent
 * server marker (my-coaches `welcome`, SessionType.is_welcome); the day-1
 * seed name is only a fallback for an older backend. When the welcome call
 * is already booked or done, the screen says so (and satisfies the tutorial
 * step) instead of offering a second booking.
 * No open times provides a refresh and a working coach-message action.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  resolveClientTimezone,
  schedulingErrorStatus,
  type CoachingSession,
} from '../../../api/schedulingApi';
import { useBookableTypes, useMyCoaches, useOpenSlots } from '../../../hooks/useCalendar';
import { useRequestSession, useRescheduleSession, useSession } from '../../../hooks/useScheduling';
import {
  coachTimeLabel,
  formatRange,
  formatTime,
  formatWhen,
  groupSlotsByDay,
  nowToMinuteIso,
  zoneAbbrev,
  type Slot,
} from '../../../calendar/calendarTime';
import { addSessionToPhoneCalendar, phoneCalendarResultMessage } from '../../../calendar/phoneCalendar';
import { bookingOutcomeUncertain, calendarErrorMessage, shouldRefreshSlots } from '../../../calendar/schedulingErrors';
import { emitTutorialSignal } from '../../../tutorial/tutorialEvents';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, spacing, typography } from '../../../theme/tokens';
import { useOpenMessages } from './CalendarHomeScreen';
import { Body, Note, PrimaryButton, SecondaryButton, Title, calendarStyles } from './calendarUi';

type Props = NativeStackScreenProps<CalendarStackParamList, 'CalendarBook'>;

export function bookingErrorMessage(err: unknown): string {
  return calendarErrorMessage(err, 'confirm the booking');
}

/** Repeated after every move: phone-calendar copies never update themselves. */
export const MOVED_PHONE_COPY_NOTE =
  'If you copied this session to your phone calendar, update that copy in your calendar app.';

export function bookedMessage(session: CoachingSession, coachName: string, moved: boolean): string {
  const copyNote = moved ? ` ${MOVED_PHONE_COPY_NOTE}` : '';
  if (session.status === 'requested') {
    return `Requested, waiting for your coach. Check Calendar to see when ${coachName} confirms.${copyNote}`;
  }
  if (session.status === 'pending_provider') return `Your time is reserved. The call link is being prepared. Open Calendar to check its status.${copyNote}`;
  const base = moved ? `Moved. ${coachName} has the new time.` : `Booked. ${coachName} will see it in Calendar.`;
  const linkNote = session.meeting_link_status === 'pending' ? ` ${coachName} will add the call link before it starts.` : '';
  return `${base}${linkNote}${copyNote}`;
}

/**
 * S-SCHED-3 (C-325-4 / backend C-634-4): moving a confirmed session of a type
 * that needs approval sends it back as a request and gives up the current
 * time. Say so before the client picks a new time.
 */
export function moveNeedsApprovalWarning(
  moving: CoachingSession | undefined,
  autoApprove: boolean | undefined,
  coachName: string,
): string | null {
  if (!moving || moving.status !== 'scheduled') return null;
  const needsApproval = autoApprove === false || moving.session_type?.auto_approve === false;
  if (!needsApproval) return null;
  return `This session is confirmed. Moving it sends the new time to ${coachName} for approval and gives up your current time. If ${coachName} declines, you will need to pick another time.`;
}

/** Welcome type for a coach: server marker first, day-1 seed name as fallback. */
export function pickWelcomeType<T extends { id: string; name: string; is_welcome?: boolean }>(
  list: readonly T[],
  markerTypeId: string | null | undefined,
): T | null {
  return (
    (markerTypeId ? list.find((t) => t.id === markerTypeId) : undefined) ??
    list.find((t) => t.is_welcome === true) ??
    list.find((t) => t.name === 'Quick initialization') ??
    null
  );
}

export default function CalendarBookScreen({ route, navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const params: CalendarStackParamList['CalendarBook'] = route.params ?? {};
  const openMessages = useOpenMessages();
  const clientTz = resolveClientTimezone();

  const coaches = useMyCoaches();
  const moving = useSession(params.rescheduleSessionId);
  const coachId = params.coachId ?? moving.data?.coach_id ?? coaches.data?.[0]?.coach_id;
  const coach = coaches.data?.find((c) => c.coach_id === coachId);
  const coachName = coach?.name ?? 'your coach';
  const types = useBookableTypes(coachId);

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const welcomeInfo = coach?.welcome ?? null;
  const type = useMemo(() => {
    const list = (types.data ?? []).filter((t) => !t.archived_at);
    // The server marks the welcome type; renamed offerings stay bookable by
    // explicit selection instead of inferring a welcome call by length.
    if (params.welcome && !selectedTypeId) return pickWelcomeType(list, welcomeInfo?.session_type_id);
    const id = selectedTypeId ?? params.sessionTypeId ?? moving.data?.session_type_id ?? undefined;
    return list.find((t) => t.id === id) ?? null;
  }, [types.data, params.welcome, params.sessionTypeId, moving.data?.session_type_id, selectedTypeId, welcomeInfo?.session_type_id]);

  // Persistent marker: the welcome call is already booked (upcoming) or done.
  const welcomeDone =
    !!params.welcome && !params.rescheduleSessionId && !selectedTypeId && !!welcomeInfo &&
    (!!welcomeInfo.active_session_id || !!welcomeInfo.completed_at);
  useEffect(() => {
    if (welcomeDone) emitTutorialSignal('welcome_call_booked');
  }, [welcomeDone]);

  const [fromIso] = useState(() => nowToMinuteIso());
  const slotsQ = useOpenSlots(coachId, type, fromIso);
  const days = useMemo(() => {
    const own = moving.data;
    const slots = (slotsQ.data?.slots ?? []).filter((s) => !own || s.start_at !== own.start_at);
    return groupSlotsByDay(slots, clientTz);
  }, [slotsQ.data, clientTz, moving.data]);

  const [picked, setPicked] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CoachingSession | null>(null);
  const [verifyBooking, setVerifyBooking] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  const request = useRequestSession();
  const reschedule = useRescheduleSession();
  const busy = request.isPending || reschedule.isPending;

  const submit = () => {
    if (!picked || !type || !coachId || inFlight.current || verifyBooking || busy) return;
    if (Date.parse(picked.start_at) < Date.now() + 5 * 60_000) {
      setPicked(null);
      setError('That time is too close or has passed. Refresh open times and choose a later time.');
      void slotsQ.refetch();
      return;
    }
    // A refetch may invalidate a previously selected slot or appointment.
    if (!slotsQ.data?.slots.some((s) => s.start_at === picked.start_at && s.end_at === picked.end_at)) {
      setPicked(null);
      setError('That time is no longer in the open times. Refresh and choose another time.');
      return;
    }
    inFlight.current = true;
    setError(null);
    const onSuccess = (s: CoachingSession) => {
      setDone(s);
      if (params.welcome) emitTutorialSignal('welcome_call_booked');
    };
    const onError = (err: unknown) => {
      setError(bookingErrorMessage(err));
      if (bookingOutcomeUncertain(err)) setVerifyBooking(true);
      if (shouldRefreshSlots(err) || schedulingErrorStatus(err) === 409) {
        setPicked(null);
        void slotsQ.refetch();
      }
    };
    const onSettled = () => {
      inFlight.current = false;
    };
    if (params.rescheduleSessionId) {
      reschedule.mutate(
        {
          id: params.rescheduleSessionId,
          input: { start_at: picked.start_at, end_at: picked.end_at, client_timezone: clientTz },
        },
        { onSuccess, onError, onSettled },
      );
    } else {
      request.mutate(
        {
          coach_id: coachId,
          session_type_id: type.id,
          title: type.name,
          start_at: picked.start_at,
          end_at: picked.end_at,
        },
        { onSuccess, onError, onSettled },
      );
    }
  };

  const addToPhone = async (s: CoachingSession) => {
    const r = await addSessionToPhoneCalendar(s, coachName);
    setPhoneMsg(phoneCalendarResultMessage(r));
  };

  const screen = (children: React.ReactNode) => (
    <SafeAreaView style={[calendarStyles.screen, { backgroundColor: sc.bgPrimary }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={calendarStyles.content} testID="calendar-book">
        {children}
      </ScrollView>
    </SafeAreaView>
  );

  if (done) {
    return screen(
      <View testID="calendar-book-done">
        <Title>{done.status === 'requested' ? 'Requested' : params.rescheduleSessionId ? 'Moved' : 'Booked'}</Title>
        <Body>{bookedMessage(done, coachName, !!params.rescheduleSessionId)}</Body>
        <Note text={`${formatWhen(done.start_at, clientTz)}. ${formatRange(done.start_at, done.end_at, clientTz)}.`} />
        {done.status === 'scheduled' ? <SecondaryButton label="Add to my calendar" onPress={() => void addToPhone(done)} testID="calendar-add-phone" /> : null}
        {phoneMsg ? <Note text={phoneMsg} testID="calendar-phone-msg" /> : null}
        <PrimaryButton
          label="Done"
          onPress={() => navigation.navigate('CalendarSession', { sessionId: done.id })}
          testID="calendar-book-finish"
        />
      </View>,
    );
  }

  if (welcomeDone && welcomeInfo) {
    const upcomingId = welcomeInfo.active_session_id;
    const startAt = welcomeInfo.active_session_start_at;
    return screen(
      <View testID="calendar-welcome-done">
        <Title>{`Welcome call with ${coachName}`}</Title>
        <Body>
          {upcomingId && startAt
            ? welcomeInfo.active_session_status === 'requested'
              ? `You asked for ${formatWhen(startAt, clientTz)}. ${coachName} will confirm it.`
              : `It is booked for ${formatWhen(startAt, clientTz)}.`
            : `You have had your welcome call with ${coachName}. Book other sessions from Calendar.`}
        </Body>
        {upcomingId ? (
          <PrimaryButton
            label="Open the session"
            onPress={() => navigation.navigate('CalendarSession', { sessionId: upcomingId })}
            testID="calendar-welcome-open"
          />
        ) : null}
        <SecondaryButton label="See Calendar" onPress={() => navigation.navigate('CalendarHome')} testID="calendar-welcome-home" />
      </View>,
    );
  }

  const loading = coaches.isLoading || types.isLoading || (!!params.rescheduleSessionId && moving.isLoading) || (!!type && slotsQ.isLoading);
  if (loading) return screen(<Note text="Loading open times." />);

  const offline = coaches.isError || types.isError || slotsQ.isError || moving.isError;
  if (offline) {
    return screen(
      <View testID="calendar-book-offline">
        <Body>{calendarErrorMessage(coaches.error ?? types.error ?? slotsQ.error ?? moving.error, 'load open times')}</Body>
        <SecondaryButton label="Refresh open times" onPress={() => {
          void coaches.refetch();
          void types.refetch();
          if (type) void slotsQ.refetch();
          if (params.rescheduleSessionId) void moving.refetch();
        }} />
        <SecondaryButton label="Message your coach" onPress={openMessages} />
      </View>,
    );
  }

  const noTimes = !type || days.length === 0;
  if (noTimes) {
    return screen(
      <View testID="calendar-book-fallback">
        <Title>{params.welcome ? `Welcome call with ${coachName}` : type?.name ?? 'Book a time'}</Title>
        <Body muted>
          {!type
            ? params.welcome
              ? `${coachName} has not opened welcome calls yet. You can see other times in Calendar, or ask in your conversation.`
              : 'This appointment type is no longer offered.'
            : `There are no open times in the next two weeks. ${coachName} can suggest one in your conversation.`}
        </Body>
        {!type && params.welcome ? (types.data ?? []).filter((t) => !t.archived_at).map((t) => (
          <SecondaryButton key={t.id} label={`${t.name}, ${t.duration_minutes} minutes`} onPress={() => { setSelectedTypeId(t.id); setPicked(null); }} />
        )) : null}
        {type ? <SecondaryButton label="Refresh open times" onPress={() => void slotsQ.refetch()} /> : null}
        <SecondaryButton label="Message your coach" onPress={openMessages} testID="calendar-fallback-message" />
        <SecondaryButton label="See Calendar" onPress={() => navigation.navigate('CalendarHome')} testID="calendar-fallback-home" />
      </View>,
    );
  }

  return screen(
    <View>
      <Title>{params.welcome ? `Book your welcome call with ${coachName}` : type.name}</Title>
      <Note
        text={`${type.duration_minutes} minutes. ${type.auto_approve ? 'Confirmed right away.' : `${coachName} confirms each request.`} Times are in your time zone.`}
      />
      {(() => {
        const warning = params.rescheduleSessionId ? moveNeedsApprovalWarning(moving.data, type.auto_approve, coachName) : null;
        return warning ? <Note text={warning} testID="calendar-move-approval-warning" /> : null;
      })()}
      {days.map((d) => (
        <View key={d.key} style={styles.day}>
          <Text style={[styles.dayLabel, { color: sc.textPrimary }]} accessibilityRole="header">
            {d.label}
          </Text>
          <View style={styles.slotWrap}>
            {d.slots.map((s) => {
              const sel = picked?.start_at === s.start_at;
              const coachClock = coachTimeLabel(s.start_at, slotsQ.data?.timezone ?? coach?.timezone, clientTz);
              const clock = formatTime(new Date(s.start_at), clientTz);
              const repeatedClock = d.slots.some((other) => other.start_at !== s.start_at && formatTime(new Date(other.start_at), clientTz) === clock);
              return (
                <Pressable
                  key={s.start_at}
                  onPress={() => {
                    setPicked(s);
                    setError(null);
                  }}
                  disabled={busy || verifyBooking}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={`${d.label}, ${formatTime(new Date(s.start_at), clientTz)} ${zoneAbbrev(new Date(s.start_at), clientTz)}${coachClock ? `, ${coachClock}` : ''}`}
                  style={[
                    styles.slot,
                    { borderColor: sc.textPrimary, backgroundColor: sel ? sc.textPrimary : 'transparent' },
                  ]}
                  testID={`calendar-slot-${s.start_at}`}
                >
                  <Text style={[styles.slotText, { color: sel ? sc.bgPrimary : sc.textPrimary }]}>
                    {repeatedClock ? `${clock} ${zoneAbbrev(new Date(s.start_at), clientTz)}` : clock}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {picked ? (
        <View style={[styles.confirm, { borderColor: sc.border }]} testID="calendar-confirm">
          <Body>{`${formatWhen(picked.start_at, clientTz)}. ${formatRange(picked.start_at, picked.end_at, clientTz)}.`}</Body>
          {(() => {
            const c = coachTimeLabel(picked.start_at, slotsQ.data?.timezone ?? coach?.timezone, clientTz);
            return c ? <Note text={c} /> : null;
          })()}
          <PrimaryButton
            label={params.rescheduleSessionId ? 'Move to this time' : type.auto_approve ? 'Book this time' : 'Request this time'}
            onPress={submit}
            busy={busy}
            disabled={verifyBooking}
            testID="calendar-submit"
          />
        </View>
      ) : null}
      {error ? <Note text={error} testID="calendar-book-error" /> : null}
      {verifyBooking ? (
        <SecondaryButton label="Check Calendar before booking again" onPress={() => navigation.navigate('CalendarHome')} testID="calendar-verify-booking" />
      ) : null}
      <SecondaryButton label="Refresh open times" onPress={() => { setPicked(null); void slotsQ.refetch(); }} disabled={busy} />
    </View>,
  );
}

const styles = StyleSheet.create({
  day: { marginTop: spacing.lg },
  dayLabel: { ...typography.bodyMd, marginBottom: spacing.sm },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    minHeight: 44,
    minWidth: 88,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  slotText: { ...typography.body },
  confirm: { marginTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.lg },
});
