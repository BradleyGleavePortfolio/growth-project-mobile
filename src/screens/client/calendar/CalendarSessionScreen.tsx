/**
 * CalendarSessionScreen — S-SCHED one session for the client.
 *
 * Status, time (client zone, coach clock when different), Join when a real
 * video link exists (Call when the coach gave a phone number, S-SCHED-3), the coach's recap when present, Add to my calendar,
 * Reschedule and Cancel. Cancel asks once and explains manual calendar-copy
 * removal. Booking action notifications can route to this registered screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resolveCallLink, resolveClientTimezone, type CallLink, type CoachingSession } from '../../../api/schedulingApi';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { useCancelSession, useSession } from '../../../hooks/useScheduling';
import { coachTimeLabel } from '../../../calendar/calendarTime';
import { addSessionToPhoneCalendar, phoneCalendarResultMessage } from '../../../calendar/phoneCalendar';
import { calendarErrorMessage } from '../../../calendar/schedulingErrors';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { Body, Note, PrimaryButton, SecondaryButton, Section, SessionTime, Title, calendarStyles, sessionLength, statusLabel, useOpenMessages } from './calendarUi';

type Props = NativeStackScreenProps<CalendarStackParamList, 'CalendarSession'>;

const LIVE_STATUSES = new Set(['requested', 'scheduled', 'pending_provider']);
/** Join opens 15 minutes before the start and stays until the end. */
const JOIN_EARLY_MS = 15 * 60 * 1000;

export function canJoin(s: CoachingSession, now: number = Date.now()): boolean {
  if (s.status !== 'scheduled') return false;
  if (!resolveCallLink(s.video_url)) return false;
  const start = new Date(s.start_at).getTime();
  const end = new Date(s.end_at).getTime();
  return now >= start - JOIN_EARLY_MS && now <= end;
}

export function canChange(s: CoachingSession, now: number = Date.now()): boolean {
  if (!LIVE_STATUSES.has(s.status)) return false;
  if (s.cancellable !== undefined) return s.cancellable;
  // Older backend without server flags: keep the conservative 24-hour lock.
  return new Date(s.start_at).getTime() - now > 24 * 60 * 60 * 1000;
}

/** Server rule first (S-SCHED-2 `reschedulable`), else the cancel rule. */
export function canReschedule(s: CoachingSession, now: number = Date.now()): boolean {
  if (s.reschedulable !== undefined) return s.reschedulable && canChange(s, now);
  return canChange(s, now) && (s.status === 'requested' || s.status === 'scheduled');
}

/**
 * Open the call. A phone number goes to the dialer. A device that cannot
 * place calls (tablet, simulator) rejects the dialer link; the client then
 * gets the number and a next step instead of a silent failure. (No
 * canOpenURL pre-check: on iOS it needs a declared query scheme.)
 */
export async function openCallLink(link: CallLink, coachName: string): Promise<string | null> {
  if (link.kind === 'phone') {
    try {
      await Linking.openURL(link.url);
      return null;
    } catch {
      return `This device could not start the call. Call ${link.display} from a phone, or message ${coachName}.`;
    }
  }
  try {
    await Linking.openURL(link.url);
    return null;
  } catch (err) {
    return calendarErrorMessage(err, 'open the call link');
  }
}

/** Calm, specific call-link line for the client, or null when not needed. */
export function clientLinkLine(s: CoachingSession, _coachName: string, hasLink: boolean): string | null {
  // pending_provider already reads "call link is being prepared".
  if (s.status !== 'scheduled' && s.status !== 'requested') return null;
  return hasLink ? null : 'Call link not added yet.';
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
  if (q.isLoading) return wrap(<Note text="Loading this session." />);
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
  const coachName = coach?.name ?? s.coach_name ?? 'your coach';
  const coachClock = coachTimeLabel(s.start_at, coach?.timezone, clientTz);
  const link = resolveCallLink(s.video_url);
  const changeable = canChange(s, now);
  const movable = canReschedule(s, now);
  const live = LIVE_STATUSES.has(s.status) && new Date(s.end_at).getTime() > Date.now();
  const linkLine = live ? clientLinkLine(s, coachName, !!link) : null;

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
      <SessionTime session={s} />
      {coachClock ? <Note text={coachClock} /> : null}
      <Note text={`With ${coachName}.`} />
      <Note text={sessionLength(s)} />

      {canJoin(s, now) && link ? (
        <PrimaryButton
          label={link.kind === 'phone' ? `Call ${link.display}` : 'Join'}
          onPress={() => void openCallLink(link, coachName).then((m) => { if (m) setMsg(m); })}
          accessibilityHint={link.kind === 'phone' ? 'Opens your phone app to call your coach' : 'Opens the video call'}
          testID="calendar-join"
        />
      ) : null}
      {s.status === 'scheduled' && link && !canJoin(s, now) && live ? (
        <Note
          text={
            link.kind === 'phone'
              ? `This is a phone call on ${link.display}. Call opens 15 minutes before the start.`
              : 'Join opens 15 minutes before the start.'
          }
          testID="calendar-join-later"
        />
      ) : null}
      {linkLine ? <Note text={linkLine} testID="calendar-session-link-pending" /> : null}

      {live && s.status === 'scheduled' ? (
        <SecondaryButton label="Add to calendar" onPress={() => void onAdd()} testID="calendar-add-phone" />
      ) : null}
      {live && !changeable ? (
        <Note
          text={
            s.cancellable === false
              ? 'This session has started, so it can no longer be changed here. Message your coach if you need help.'
              : 'Changes are locked within 24 hours of the start. Message your coach if you need help changing this session.'
          }
        />
      ) : null}
      {changeable ? (
        <>
          {movable ? (
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
          ) : null}
          <SecondaryButton label="Cancel session" onPress={onCancel} disabled={cancel.isPending} testID="calendar-cancel" />
        </>
      ) : null}
      {s.status === 'expired' ? (
        <SecondaryButton
          label="Pick another time"
          onPress={() =>
            navigation.navigate('CalendarBook', { coachId: s.coach_id, sessionTypeId: s.session_type_id ?? undefined })
          }
          testID="calendar-expired-rebook"
        />
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
