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
 *
 * U-04-2: open times load 14 days at a time (the server's range cap). Show
 * later times / Show earlier times step through the coach's booking window
 * (booking_window_days on the open-slots reply); an older backend that does
 * not send it keeps the first 14 days only.
 *
 * Quiet booking: day overlines, 44-point text slots, forest selection and
 * one time-labelled action. Paging, refresh, messages, device-calendar copies
 * and session-detail routes remain available. Missing links are facts, not promises.
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
import { OPEN_SLOTS_RANGE_DAYS, useBookableTypes, useMyCoaches, useOpenSlots } from '../../../hooks/useCalendar';
import { useRequestSession, useRescheduleSession, useSession } from '../../../hooks/useScheduling';
import {
  coachTimeLabel,
  formatDayLabel,
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
    return `Requested, waiting for your coach. Check Calendar for ${coachName}'s response.${copyNote}`;
  }
  if (session.status === 'pending_provider') return `Your time is reserved. The call link is being prepared. Open Calendar to check its status.${copyNote}`;
  const base = moved ? `Moved. ${coachName} has the new time.` : `Booked. ${coachName} will see it in the booking inbox.`;
  const linkNote = session.meeting_link_status === 'pending' ? ' Call link not added yet.' : '';
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * U-04-2: which 14-day page of open times is showing, whether the coach's
 * booking window reaches past it, and a plain label for its dates.
 */
export function openTimesPage(
  baseIso: string,
  page: number,
  windowDays: number | undefined,
  tz: string,
): { fromIso: string; hasEarlier: boolean; hasLater: boolean; rangeLabel: string } {
  const base = Date.parse(baseIso);
  const from = base + page * OPEN_SLOTS_RANGE_DAYS * DAY_MS;
  const pageEnd = from + OPEN_SLOTS_RANGE_DAYS * DAY_MS;
  const windowEnd = typeof windowDays === 'number' && windowDays > 0 ? base + windowDays * DAY_MS : pageEnd;
  const last = Math.max(from, Math.min(pageEnd, windowEnd) - 60_000);
  return {
    fromIso: new Date(from).toISOString(),
    hasEarlier: page > 0,
    hasLater: windowEnd > pageEnd,
    rangeLabel: `${formatDayLabel(new Date(from), tz)} to ${formatDayLabel(new Date(last), tz)}`,
  };
}

/** "two weeks", or the coach's shorter booking window ("7 days"). */
export function firstPageSpan(windowDays: number | undefined): string {
  if (typeof windowDays !== 'number' || windowDays >= OPEN_SLOTS_RANGE_DAYS) return 'two weeks';
  return `${windowDays} day${windowDays === 1 ? '' : 's'}`;
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
  // Welcome heading and tutorial signal follow the type actually booked: a
  // regular type picked from the welcome fallback is not a welcome call.
  const bookingWelcome = !!params.welcome && !!type && pickWelcomeType([type], welcomeInfo?.session_type_id) !== null;

  // Persistent marker: the welcome call is already booked (upcoming) or done.
  const welcomeDone =
    !!params.welcome && !params.rescheduleSessionId && !selectedTypeId && !!welcomeInfo &&
    (!!welcomeInfo.active_session_id || !!welcomeInfo.completed_at);
  useEffect(() => {
    if (welcomeDone) emitTutorialSignal('welcome_call_booked');
  }, [welcomeDone]);

  const [baseIso] = useState(() => nowToMinuteIso());
  const [page, setPage] = useState(0);
  // The window is the same on every page; keep the last one the server sent.
  const [windowDays, setWindowDays] = useState<number | undefined>(undefined);
  const paging = openTimesPage(baseIso, page, windowDays, clientTz);
  const slotsQ = useOpenSlots(coachId, type, paging.fromIso);
  const sentWindow = slotsQ.data?.booking_window_days;
  useEffect(() => {
    if (typeof sentWindow === 'number') setWindowDays(sentWindow);
  }, [sentWindow]);
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
      if (bookingWelcome) emitTutorialSignal('welcome_call_booked');
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

  const goToPage = (next: number) => {
    setPicked(null);
    setError(null);
    setPage(Math.max(0, next));
  };
  const pageButtons = (
    <>
      {paging.hasLater ? (
        <SecondaryButton label="Show later times" onPress={() => goToPage(page + 1)} disabled={busy} testID="calendar-later-times" />
      ) : null}
      {paging.hasEarlier ? (
        <SecondaryButton label="Show earlier times" onPress={() => goToPage(page - 1)} disabled={busy} testID="calendar-earlier-times" />
      ) : null}
    </>
  );

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
        {done.status === 'scheduled' ? <SecondaryButton label="Add to phone calendar" onPress={() => void addToPhone(done)} testID="calendar-add-phone" /> : null}
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
              ? `You asked for ${formatWhen(startAt, clientTz)}. Waiting for ${coachName} to confirm.`
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
        <Title>{(params.welcome && !type) || bookingWelcome ? `Welcome call with ${coachName}` : type?.name ?? 'Book a time'}</Title>
        <Body muted>
          {!type
            ? params.welcome
              ? `${coachName} has not opened welcome calls yet. You can see other times in Calendar, or ask in your conversation.`
              : 'This appointment type is no longer offered.'
            : page > 0
              ? `There are no open times from ${paging.rangeLabel}. ${coachName} can suggest one in your conversation.`
              : `There are no open times in the next ${firstPageSpan(windowDays)}. ${paging.hasLater ? 'Show later times to look further ahead, or ask' : 'Ask'} ${coachName} to suggest one in your conversation.`}
        </Body>
        {type ? pageButtons : null}
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
      <Title>{bookingWelcome ? `Book your welcome call with ${coachName}` : type.name}</Title>
      <Note
        text={`${type.duration_minutes} minutes. ${type.auto_approve ? 'Confirmed right away.' : `${coachName} confirms each request.`} Times are in your time zone.`}
      />
      {paging.hasLater || paging.hasEarlier ? (
        <Note text={`Showing open times from ${paging.rangeLabel}.`} testID="calendar-times-range" />
      ) : null}
      {(() => {
        const warning = params.rescheduleSessionId ? moveNeedsApprovalWarning(moving.data, type.auto_approve, coachName) : null;
        return warning ? <Note text={warning} testID="calendar-move-approval-warning" /> : null;
      })()}
      {days.map((d) => (
        <View key={d.key} style={styles.day}>
          <Text style={[styles.dayLabel, { color: sc.textMuted }]} accessibilityRole="header">
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
                    { borderColor: sel ? sc.accent : sc.border, backgroundColor: sel ? sc.accent : sc.bgPrimary },
                  ]}
                  testID={`calendar-slot-${s.start_at}`}
                >
                  <Text style={[styles.slotText, { color: sel ? sc.textOnAccent : sc.textPrimary }]}>
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
            label={`${params.rescheduleSessionId ? 'Move to' : type.auto_approve ? 'Book' : 'Request'} ${formatTime(new Date(picked.start_at), clientTz)}`}
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
      {pageButtons}
      <SecondaryButton label="Refresh open times" onPress={() => { setPicked(null); void slotsQ.refetch(); }} disabled={busy} />
    </View>,
  );
}

const styles = StyleSheet.create({
  day: { marginTop: spacing.xl },
  dayLabel: { ...typography.eyebrow, fontSize: 13, lineHeight: 20, marginBottom: spacing.sm },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    minHeight: 44,
    minWidth: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  slotText: { ...typography.body, fontVariant: ['tabular-nums'] },
  confirm: { marginTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.lg },
});
