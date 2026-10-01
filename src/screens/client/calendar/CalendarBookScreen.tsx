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
 * `welcome: true` (end of Roman's tutorial) resolves the coach's welcome
 * appointment type by its server marker, never by name. With no welcome
 * type or no open times it falls back to Calendar and "Message your coach".
 */
import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  resolveClientTimezone,
  schedulingErrorCode,
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
  type Slot,
} from '../../../calendar/calendarTime';
import { addSessionToPhoneCalendar } from '../../../calendar/phoneCalendar';
import { emitTutorialSignal } from '../../../tutorial/tutorialEvents';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, spacing, typography } from '../../../theme/tokens';
import { useOpenMessages } from './CalendarHomeScreen';
import { Body, Note, PrimaryButton, SecondaryButton, Title, calendarStyles } from './calendarUi';

type Props = NativeStackScreenProps<CalendarStackParamList, 'CalendarBook'>;

const NOTE_MAX = 500;

export function bookingErrorMessage(err: unknown): string {
  const status = schedulingErrorStatus(err);
  const code = schedulingErrorCode(err);
  if (status === null) {
    return 'No connection. Nothing was booked. Please try again when you are back online.';
  }
  if (code === 'SLOT_TAKEN' || code === 'SLOT_UNAVAILABLE' || status === 409) {
    return 'That time was just taken or is no longer open. Please pick another.';
  }
  if (status === 402) return 'Booking is part of your coaching plan. Please check your plan in Profile and more.';
  if (status === 403) return 'You can only book with your own coach.';
  return 'Something went wrong and nothing was booked. Please try again.';
}

export function bookedMessage(session: CoachingSession, coachName: string, moved: boolean): string {
  if (session.status === 'requested') {
    return `Requested, waiting for your coach. You will get a notification when ${coachName} confirms.`;
  }
  return moved ? `Moved. ${coachName} has the new time.` : `Booked. ${coachName} will see it in Calendar.`;
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

  const type = useMemo(() => {
    const list = (types.data ?? []).filter((t) => !t.archived_at);
    if (params.welcome) return list.find((t) => t.is_welcome) ?? null;
    const id = params.sessionTypeId ?? moving.data?.session_type_id ?? undefined;
    return list.find((t) => t.id === id) ?? null;
  }, [types.data, params.welcome, params.sessionTypeId, moving.data?.session_type_id]);

  const [fromIso] = useState(() => nowToMinuteIso());
  const slotsQ = useOpenSlots(coachId, type?.id, fromIso);
  const days = useMemo(() => {
    const own = moving.data;
    const slots = (slotsQ.data?.slots ?? []).filter((s) => !own || s.start_at !== own.start_at);
    return groupSlotsByDay(slots, clientTz);
  }, [slotsQ.data, clientTz, moving.data]);

  const [picked, setPicked] = useState<Slot | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CoachingSession | null>(null);
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  const request = useRequestSession();
  const reschedule = useRescheduleSession();
  const busy = request.isPending || reschedule.isPending;

  const submit = () => {
    if (!picked || !type || !coachId || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    const onSuccess = (s: CoachingSession) => {
      setDone(s);
      if (params.welcome) emitTutorialSignal('welcome_call_booked');
    };
    const onError = (err: unknown) => {
      setError(bookingErrorMessage(err));
      if (schedulingErrorStatus(err) === 409) {
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
          notes: note.trim() === '' ? undefined : note.trim().slice(0, NOTE_MAX),
          client_timezone: clientTz,
        },
        { onSuccess, onError, onSettled },
      );
    }
  };

  const addToPhone = async (s: CoachingSession) => {
    const r = await addSessionToPhoneCalendar(s, coachName);
    if (r.kind === 'added' || r.kind === 'updated') setPhoneMsg('Added to your calendar.');
    else if (r.kind === 'denied')
      setPhoneMsg('Calendar access is off, so nothing was added. You can turn it on in your phone settings at any time.');
    else if (r.kind === 'no_calendar') setPhoneMsg('No calendar on this phone accepts new events.');
    else setPhoneMsg('That did not work. Your session is still booked here.');
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
        <SecondaryButton label="Add to my calendar" onPress={() => void addToPhone(done)} testID="calendar-add-phone" />
        {phoneMsg ? <Note text={phoneMsg} testID="calendar-phone-msg" /> : null}
        <PrimaryButton
          label="Done"
          onPress={() => navigation.navigate('CalendarSession', { sessionId: done.id })}
          testID="calendar-book-finish"
        />
      </View>,
    );
  }

  const loading = coaches.isLoading || types.isLoading || (!!type && slotsQ.isLoading);
  if (loading) return screen(<Note text="Loading open times." />);

  const offline = coaches.isError || types.isError || slotsQ.isError;
  if (offline && !slotsQ.data) {
    return screen(
      <View testID="calendar-book-offline">
        <Body>Open times could not load. Check your connection and try again.</Body>
        <SecondaryButton label="Try again" onPress={() => void (type ? slotsQ.refetch() : types.refetch())} />
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
      {days.map((d) => (
        <View key={d.key} style={styles.day}>
          <Text style={[styles.dayLabel, { color: sc.textPrimary }]} accessibilityRole="header">
            {d.label}
          </Text>
          <View style={styles.slotWrap}>
            {d.slots.map((s) => {
              const sel = picked?.start_at === s.start_at;
              const coachClock = coachTimeLabel(s.start_at, slotsQ.data?.timezone ?? coach?.timezone, clientTz);
              return (
                <Pressable
                  key={s.start_at}
                  onPress={() => {
                    setPicked(s);
                    setError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={`${d.label}, ${formatTime(new Date(s.start_at), clientTz)}${coachClock ? `, ${coachClock}` : ''}`}
                  style={[
                    styles.slot,
                    { borderColor: sc.textPrimary, backgroundColor: sel ? sc.textPrimary : 'transparent' },
                  ]}
                  testID={`calendar-slot-${s.start_at}`}
                >
                  <Text style={[styles.slotText, { color: sel ? sc.bgPrimary : sc.textPrimary }]}>
                    {formatTime(new Date(s.start_at), clientTz)}
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
          {!params.rescheduleSessionId ? (
            <TextInput
              value={note}
              onChangeText={(t) => setNote(t.slice(0, NOTE_MAX))}
              placeholder={`Anything ${coachName} should know (optional)`}
              placeholderTextColor={sc.textMuted}
              accessibilityLabel={`Note for ${coachName}, optional`}
              multiline
              maxLength={NOTE_MAX}
              style={[styles.input, { color: sc.textPrimary, borderColor: sc.border }]}
              testID="calendar-note"
            />
          ) : null}
          <PrimaryButton
            label={params.rescheduleSessionId ? 'Move to this time' : type.auto_approve ? 'Book this time' : 'Request this time'}
            onPress={submit}
            busy={busy}
            testID="calendar-submit"
          />
        </View>
      ) : null}
      {error ? <Note text={error} testID="calendar-book-error" /> : null}
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
  input: {
    marginTop: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 72,
    ...typography.body,
  },
});
