/**
 * CalendarSessionScreen — S-SCHED one session for the client.
 *
 * Status, time (client zone, coach clock when different), Join when a real
 * video link exists, the coach's recap when present, Add to my calendar,
 * Reschedule and Cancel. Cancel asks once and removes the phone event this
 * device added. Push taps for any booking event land here.
 */
import React, { useRef, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resolveClientTimezone, resolveVideoUrl, type CoachingSession } from '../../../api/schedulingApi';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { useCancelSession, useSession } from '../../../hooks/useScheduling';
import { coachTimeLabel, formatRange, formatWhen } from '../../../calendar/calendarTime';
import { addSessionToPhoneCalendar, removeSessionFromPhoneCalendar } from '../../../calendar/phoneCalendar';
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
  if (s.cancellable === false) return false;
  return new Date(s.start_at).getTime() > now;
}

export default function CalendarSessionScreen({ route, navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const { sessionId } = route.params;
  const q = useSession(sessionId);
  const coaches = useMyCoaches();
  const cancel = useCancelSession();
  const openMessages = useOpenMessages();
  const [msg, setMsg] = useState<string | null>(null);
  const cancelling = useRef(false);
  const clientTz = resolveClientTimezone();

  const wrap = (children: React.ReactNode) => (
    <SafeAreaView style={[calendarStyles.screen, { backgroundColor: sc.bgPrimary }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={calendarStyles.content} testID="calendar-session">
        {children}
      </ScrollView>
    </SafeAreaView>
  );

  if (q.isLoading) return wrap(<Note text="Loading." />);
  if (!q.data) {
    return wrap(
      <View testID="calendar-session-missing">
        <Body>This session could not load. Check your connection and try again.</Body>
        <SecondaryButton label="Try again" onPress={() => void q.refetch()} />
      </View>,
    );
  }

  const s = q.data;
  const coach = coaches.data?.find((c) => c.coach_id === s.coach_id);
  const coachName = coach?.name ?? 'your coach';
  const coachClock = coachTimeLabel(s.start_at, coach?.timezone, clientTz);
  const link = resolveVideoUrl(s.video_url);
  const changeable = canChange(s);
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
                void removeSessionFromPhoneCalendar(s.id);
                setMsg('Cancelled.');
              },
              onError: () => setMsg('That did not go through. Please check your connection and try again.'),
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
    if (r.kind === 'added' || r.kind === 'updated') setMsg('Added to your calendar.');
    else if (r.kind === 'denied')
      setMsg('Calendar access is off, so nothing was added. You can turn it on in your phone settings at any time.');
    else if (r.kind === 'no_calendar') setMsg('No calendar on this phone accepts new events.');
    else setMsg('That did not work. Your session is still booked here.');
  };

  return wrap(
    <View>
      <Title>{s.title}</Title>
      <Body testID="calendar-session-status">{statusLabel(s.status)}</Body>
      <Note text={`${formatWhen(s.start_at, clientTz)}. ${formatRange(s.start_at, s.end_at, clientTz)}.`} />
      {coachClock ? <Note text={coachClock} /> : null}
      <Note text={`With ${coachName}.`} />

      {canJoin(s) && link ? (
        <PrimaryButton
          label="Join"
          onPress={() => void Linking.openURL(link)}
          accessibilityHint="Opens the video call"
          testID="calendar-join"
        />
      ) : null}
      {s.status === 'scheduled' && link && !canJoin(s) && live ? (
        <Note text="Join opens 15 minutes before the start." />
      ) : null}
      {s.status === 'scheduled' && !link && live ? (
        <Note text={`${coachName} will add the call link before the session.`} />
      ) : null}

      {live ? (
        <SecondaryButton label="Add to my calendar" onPress={() => void onAdd()} testID="calendar-add-phone" />
      ) : null}
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
