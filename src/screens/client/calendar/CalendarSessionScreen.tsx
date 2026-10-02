/**
 * CalendarSessionScreen — S-SCHED one session for the client.
 *
 * Status, time (client zone, coach clock when different), Join when a real
 * video link exists, the coach's recap when present, Add to my calendar,
 * Reschedule and Cancel. Cancel asks once and explains manual calendar-copy
 * removal. Booking action notifications can route to this registered screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resolveClientTimezone, resolveVideoUrl, type CoachingSession } from '../../../api/schedulingApi';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { useCancelSession, useSession } from '../../../hooks/useScheduling';
import { coachTimeLabel, formatRange, formatWhen } from '../../../calendar/calendarTime';
import { addSessionToPhoneCalendar, phoneCalendarResultMessage } from '../../../calendar/phoneCalendar';
import { calendarErrorMessage } from '../../../calendar/schedulingErrors';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { useOpenMessages } from './CalendarHomeScreen';
import { Body, Note, PrimaryButton, SecondaryButton, Section, Title, calendarStyles, statusLabel } from './calendarUi';

type Props = NativeStackScreenProps<CalendarStackParamList, 'CalendarSession'>;

const LIVE_STATUSES = new Set(['requested', 'scheduled', 'pending_provider']);
/** Join opens 15 minutes before the start and stays until the end. */
const JOIN_EARLY_MS = 15 * 60 * 1000;

export function canJoin(s: CoachingSession, now: number = Date.now()): boolean {
  if (s.status !== 'scheduled') return false;
  if (!resolveVideoUrl(s.video_url)) return false;
  const start = new Date(s.start_at).getTime();
  const end = new Date(s.end_at).getTime();
  return now >= start - JOIN_EARLY_MS && now <= end;
}

export function canChange(s: CoachingSession, now: number = Date.now()): boolean {
  if (!LIVE_STATUSES.has(s.status)) return false;
  if (s.cancellable !== undefined) return s.cancellable;
  // Existing server locks client changes inside 24 hours.
  return new Date(s.start_at).getTime() - now > 24 * 60 * 60 * 1000;
}

export default function CalendarSessionScreen({ route, navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const sessionId = route.params?.sessionId;
  const q = useSession(sessionId);
  const coaches = useMyCoaches();
  const cancel = useCancelSession();
  const openMessages = useOpenMessages();
  const [msg, setMsg] = useState<string | null>(null);
  const cancelling = useRef(false);
  const clientTz = resolveClientTimezone();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const wrap = (children: React.ReactNode) => (
    <SafeAreaView style={[calendarStyles.screen, { backgroundColor: sc.bgPrimary }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={calendarStyles.content} testID="calendar-session">
        {children}
      </ScrollView>
    </SafeAreaView>
  );

  if (!sessionId) {
    return wrap(
      <View testID="calendar-session-incomplete-link">
        <Body>This session link is incomplete. Open Calendar to find your session.</Body>
        <PrimaryButton label="See Calendar" onPress={() => navigation.navigate('CalendarHome')} />
      </View>,
    );
  }
  if (q.isLoading) return wrap(<Note text="Loading." />);
  if (!q.data) {
    return wrap(
      <View testID="calendar-session-missing">
        <Body>{calendarErrorMessage(q.error, 'load this session')}</Body>
        <SecondaryButton label="Try again" onPress={() => void q.refetch()} />
      </View>,
    );
  }

  const s = q.data;
  const coach = coaches.data?.find((c) => c.coach_id === s.coach_id);
  const coachName = coach?.name ?? 'your coach';
  const coachClock = coachTimeLabel(s.start_at, coach?.timezone, clientTz);
  const link = resolveVideoUrl(s.video_url);
  const changeable = canChange(s, now);
  const live = LIVE_STATUSES.has(s.status) && new Date(s.end_at).getTime() > Date.now();

  const onCancel = () => {
    if (cancelling.current) return;
    Alert.alert('Cancel this session?', `${coachName} will be told.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel session',
        style: 'destructive',
        onPress: () => {
          if (cancelling.current) return;
          cancelling.current = true;
          cancel.mutate(
            { id: s.id },
            {
              onSuccess: () => {
                setMsg('Cancelled in TGP. If you copied this session to your phone calendar, remove that copy in your calendar app.');
              },
              onError: (err) => { setMsg(calendarErrorMessage(err, 'cancel the session')); void q.refetch(); },
              onSettled: () => {
                cancelling.current = false;
              },
            },
          );
        },
      },
    ]);
  };

  const onAdd = async () => {
    const r = await addSessionToPhoneCalendar(s, coachName);
    setMsg(phoneCalendarResultMessage(r));
  };

  return wrap(
    <View>
      <Title>{s.title}</Title>
      <Body testID="calendar-session-status">{statusLabel(s.status)}</Body>
      <Note text={`${formatWhen(s.start_at, clientTz)}. ${formatRange(s.start_at, s.end_at, clientTz)}.`} />
      {coachClock ? <Note text={coachClock} /> : null}
      <Note text={`With ${coachName}.`} />

      {canJoin(s, now) && link ? (
        <PrimaryButton
          label="Join"
          onPress={() => void Linking.openURL(link).catch((err: unknown) => setMsg(calendarErrorMessage(err, 'open the call link')))}
          accessibilityHint="Opens the video call"
          testID="calendar-join"
        />
      ) : null}
      {s.status === 'scheduled' && link && !canJoin(s, now) && live ? (
        <Note text="Join opens 15 minutes before the start." />
      ) : null}
      {s.status === 'scheduled' && !link && live ? (
        <Note text={`${coachName} will add the call link before the session.`} />
      ) : null}

      {live && s.status === 'scheduled' ? (
        <SecondaryButton label="Add to my calendar" onPress={() => void onAdd()} testID="calendar-add-phone" />
      ) : null}
      {live && !changeable ? <Note text="Changes are locked within 24 hours of the start. Message your coach if you need help changing this session." /> : null}
      {changeable ? (
        <>
          <SecondaryButton
            label="Reschedule"
            onPress={() =>
              navigation.navigate('CalendarBook', {
                coachId: s.coach_id,
                sessionTypeId: s.session_type_id ?? undefined,
                rescheduleSessionId: s.id,
              })
            }
            testID="calendar-reschedule"
          />
          <SecondaryButton label="Cancel session" onPress={onCancel} disabled={cancel.isPending} testID="calendar-cancel" />
        </>
      ) : null}
      {msg ? <Note text={msg} testID="calendar-session-msg" /> : null}

      {s.client_recap_md ? (
        <Section title={`Recap from ${coachName}`}>
          <Body testID="calendar-recap">{s.client_recap_md}</Body>
        </Section>
      ) : null}

      <SecondaryButton label="Message your coach" onPress={openMessages} testID="calendar-session-message" />
    </View>,
  );
}
