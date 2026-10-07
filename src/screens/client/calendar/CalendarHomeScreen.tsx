/**
 * CalendarHomeScreen — S-SCHED client Calendar tab root.
 *
 * Next session -> later sessions -> each coach's appointment types to book,
 * then Past sessions (paged). The
 * welcome call card reads the persistent server marker (book / booked /
 * done). Times are in the client's own time zone. Empty and failed states
 * give recovery actions instead of a fake empty schedule. Phone-calendar
 * exports are explicit user-controlled copies.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BookableCoach, CoachingSession, SessionType } from '../../../api/schedulingApi';
import { resolveCallLink, resolveClientTimezone } from '../../../api/schedulingApi';
import { useBookableTypes, useMyCoaches, useMySessions, usePastSessions } from '../../../hooks/useCalendar';
import { coachTimeLabel, formatRange, formatWhen } from '../../../calendar/calendarTime';
import { calendarErrorMessage } from '../../../calendar/schedulingErrors';
import { SUPPORT_EMAIL } from '../../../constants/support';
import { SupportEmailFallback, useSupportEmail } from '../../../components/support/SupportEmailFallback';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { Body, Card, Note, PrimaryButton, SecondaryButton, Section, SessionTime, Title, calendarStyles, sessionLength, statusLabel, useOpenMessages } from './calendarUi';
import { canJoin, openCallLink } from './CalendarSessionScreen';

type Props = NativeStackScreenProps<CalendarStackParamList, 'CalendarHome'>;

export { useOpenMessages } from './calendarUi';

function CoachTypes({
  coach,
  onBook,
  onMessage,
  primaryBook,
}: {
  coach: BookableCoach;
  onBook: (coach: BookableCoach, t: SessionType) => void;
  onMessage: () => void;
  primaryBook: boolean;
}) {
  const types = useBookableTypes(coach.coach_id);
  const clientTz = resolveClientTimezone();
  const tzNote =
    coach.timezone && coach.timezone !== clientTz
      ? `${coach.name} works in ${coach.timezone.replace(/_/g, ' ')}. Times below are in your time.`
      : null;
  const list = (types.data ?? []).filter((t) => !t.archived_at);
  return (
    <View testID={`calendar-coach-${coach.coach_id}`}>
      <Body>{coach.name}</Body>
      {tzNote ? <Note text={tzNote} /> : null}
      <View style={calendarStyles.gap} />
      {types.isLoading ? <Note text="Loading appointment types." /> : null}
      {types.isError ? (
        <View>
          <Note text={calendarErrorMessage(types.error, 'load appointment types')} testID="calendar-types-error" />
          <SecondaryButton label="Refresh appointment types" onPress={() => void types.refetch()} />
        </View>
      ) : null}
      {!types.isLoading && !types.isError && list.length === 0 ? (
        <View testID="calendar-types-empty">
          <Body muted>{`${coach.name} has not opened any appointment types yet. You can ask in your conversation.`}</Body>
          <SecondaryButton label="Message your coach" onPress={onMessage} testID="calendar-message-coach" />
        </View>
      ) : null}
      {primaryBook && !types.isLoading && !types.isError && list[0] ? (
        <PrimaryButton label="Book a session" onPress={() => onBook(coach, list[0])} />
      ) : null}
      {list.map((t) => (
        <Card
          key={t.id}
          onPress={() => onBook(coach, t)}
          accessibilityLabel={`${t.name}, ${t.duration_minutes} minutes. ${t.auto_approve ? 'Confirmed right away.' : `${coach.name} confirms each request.`}`}
          accessibilityHint="Shows open times"
          testID={`calendar-type-${t.id}`}
        >
          <Body>{t.is_welcome ? `${t.name} (welcome call)` : t.name}</Body>
          <Note text={`${t.duration_minutes} minutes. ${t.auto_approve ? 'Confirmed right away.' : `${coach.name} confirms each request.`}`} />
          {t.description ? <Note text={t.description} /> : null}
        </Card>
      ))}
    </View>
  );
}

/** Persistent welcome-call marker for one coach: book it, see it, or done. */
function WelcomeCard({
  coach,
  onBook,
  onOpen,
}: {
  coach: BookableCoach;
  onBook: () => void;
  onOpen: (sessionId: string) => void;
}) {
  const w = coach.welcome;
  if (!w) return null;
  if (w.active_session_id && w.active_session_start_at) {
    const id = w.active_session_id;
    const when = formatWhen(w.active_session_start_at);
    return (
      <Card
        onPress={() => onOpen(id)}
        accessibilityLabel={`Welcome call with ${coach.name}, ${when}. ${statusLabel(w.active_session_status ?? 'scheduled')}.`}
        accessibilityHint="Opens the session"
        testID={`calendar-welcome-booked-${coach.coach_id}`}
      >
        <Body>{`Welcome call with ${coach.name}`}</Body>
        <Note text={`${when}. ${statusLabel(w.active_session_status ?? 'scheduled')}.`} />
      </Card>
    );
  }
  if (w.completed_at) return null;
  return (
    <Card
      onPress={onBook}
      accessibilityLabel={`Book your welcome call with ${coach.name}, ${w.duration_minutes} minutes`}
      accessibilityHint="Shows open times"
      testID={`calendar-welcome-book-${coach.coach_id}`}
    >
      <Body>{`Book your welcome call with ${coach.name}`}</Body>
      <Note text={`${w.name}, ${w.duration_minutes} minutes.`} />
    </Card>
  );
}

function linkNote(s: CoachingSession): string | null {
  // pending_provider already reads "call link is being prepared".
  if (s.status !== 'scheduled') return null;
  if (!resolveCallLink(s.video_url)) return 'Call link not added yet.';
  return null;
}

function SessionRow({
  s,
  coachTz,
  coachName,
  hero = false,
  onPress,
}: {
  s: CoachingSession;
  coachTz: string | null;
  coachName: string;
  hero?: boolean;
  onPress: () => void;
}) {
  const coachClock = coachTimeLabel(s.start_at, coachTz);
  const link = linkNote(s);
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${s.title}. ${formatWhen(s.start_at)}. With ${coachName}. ${sessionLength(s)} ${statusLabel(s.status)}.`}
      accessibilityHint="Opens the session"
      testID={`calendar-session-${s.id}`}
    >
      <Body>{s.title}</Body>
      {hero ? <SessionTime session={s} /> : <Note text={`${formatWhen(s.start_at)}. ${formatRange(s.start_at, s.end_at)}.`} />}
      <Note text={`With ${coachName}. ${sessionLength(s)}`} />
      {coachClock ? <Note text={coachClock} /> : null}
      <Note text={statusLabel(s.status)} />
      {link ? <Note text={link} /> : null}
    </Card>
  );
}

function PastSessions({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const past = usePastSessions();
  const rows = (past.data?.pages ?? []).flat();
  return (
    <Section title="Past sessions">
      {past.isLoading ? <Note text="Loading past sessions." /> : null}
      {past.isError ? (
        <View>
          <Note text={calendarErrorMessage(past.error, 'load past sessions')} testID="calendar-past-error" />
          <SecondaryButton label="Refresh past sessions" onPress={() => void past.refetch()} />
        </View>
      ) : null}
      {!past.isLoading && !past.isError && rows.length === 0 ? (
        <Note text="Sessions you have had appear here, with any recap from your coach." testID="calendar-past-empty" />
      ) : null}
      {rows.map((s) => (
        <Card
          key={s.id}
          onPress={() => onOpen(s.id)}
          accessibilityLabel={`${s.title}. ${formatWhen(s.start_at)}. ${statusLabel(s.status)}.`}
          accessibilityHint="Opens the session"
          testID={`calendar-past-${s.id}`}
        >
          <Body>{s.title}</Body>
          <Note text={`${formatWhen(s.start_at)}. ${statusLabel(s.status)}.`} />
          {s.client_recap_md ? <Note text="Recap from your coach inside." /> : null}
        </Card>
      ))}
      {past.hasNextPage ? (
        <SecondaryButton
          label="Show earlier sessions"
          onPress={() => void past.fetchNextPage()}
          disabled={past.isFetchingNextPage}
          testID="calendar-past-more"
        />
      ) : null}
    </Section>
  );
}

export default function CalendarHomeScreen({ navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const coaches = useMyCoaches();
  const upcoming = useMySessions();
  // One shared support-email opener (mobile #324, Sol B-324-1): a phone with
  // no email app gets the address as selectable text, Copy and Try again.
  const supportEmail = useSupportEmail('Calendar help');
  const openMessages = useOpenMessages();
  const [callMessage, setCallMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const coachById = useMemo(() => {
    const m = new Map<string, BookableCoach>();
    for (const c of coaches.data ?? []) m.set(c.coach_id, c);
    return m;
  }, [coaches.data]);

  const refreshing = coaches.isRefetching || upcoming.isRefetching;
  const onRefresh = () => {
    void coaches.refetch();
    void upcoming.refetch();
  };

  const list = upcoming;
  const rows = list.data ?? [];
  const next = [...rows].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .find((s) => ['requested', 'scheduled', 'pending_provider'].includes(s.status) && Date.parse(s.end_at) > now);
  const nextCoach = next ? coachById.get(next.coach_id)?.name ?? next.coach_name ?? 'your coach' : '';
  const nextLink = next ? resolveCallLink(next.video_url) : null;
  const bookingPrimary = !list.isLoading && !list.isError && !next;

  return (
    <SafeAreaView style={[calendarStyles.screen, { backgroundColor: sc.bgPrimary }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={calendarStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="calendar-home"
      >
        <Title>Calendar</Title>
        <Body muted>{(coaches.data?.length ?? 0) > 0
          ? 'Book time with your coach and see your sessions. Times are shown in your time zone.'
          : 'Times are shown in your time zone.'}</Body>

        <Section title={next ? 'Next session' : 'Upcoming sessions'}>
          {list.isLoading ? <Note text="Loading upcoming sessions." /> : null}
          {list.isError ? (
            <View>
              <Note text={calendarErrorMessage(list.error, 'load upcoming sessions')} testID="calendar-sessions-error" />
              <SecondaryButton label="Refresh sessions" onPress={() => void list.refetch()} />
            </View>
          ) : null}
          {next ? (
            <View testID="calendar-next-session">
              <SessionRow s={next} hero coachName={nextCoach} coachTz={coachById.get(next.coach_id)?.timezone ?? null}
                onPress={() => navigation.navigate('CalendarSession', { sessionId: next.id })} />
              {canJoin(next, now) && nextLink ? (
                <PrimaryButton label={nextLink.kind === 'phone' ? `Call ${nextLink.display}` : 'Join'}
                  onPress={() => void openCallLink(nextLink, nextCoach).then(setCallMessage)} testID="calendar-home-join" />
              ) : null}
              {callMessage ? <Note text={callMessage} /> : null}
            </View>
          ) : null}
          {!list.isLoading && !list.isError && rows.length === 0 ? (
            <View testID="calendar-upcoming-empty">
              <Body muted>{(coaches.data?.length ?? 0) > 0
                ? 'Nothing booked yet. Choose an appointment type below, or message your coach.'
                : 'No upcoming sessions.'}</Body>
              {(coaches.data?.length ?? 0) > 0 ? (
                <SecondaryButton label="Message your coach" onPress={openMessages} testID="calendar-empty-message" />
              ) : null}
            </View>
          ) : null}
          {rows.filter((s) => s.id !== next?.id).map((s) => (
            <SessionRow key={s.id} s={s} coachName={coachById.get(s.coach_id)?.name ?? s.coach_name ?? 'your coach'}
              coachTz={coachById.get(s.coach_id)?.timezone ?? null}
              onPress={() => navigation.navigate('CalendarSession', { sessionId: s.id })} />
          ))}
        </Section>

        <Section title={(coaches.data?.length ?? 0) > 1 ? 'Your coaches' : 'Your coach'}>
          {coaches.isLoading ? <Note text="Loading your coach." /> : null}
          {coaches.isError ? (
            <View>
              <Note text={calendarErrorMessage(coaches.error, 'load your coach')} testID="calendar-coaches-error" />
              <SecondaryButton label="Refresh your coach" onPress={() => void coaches.refetch()} />
            </View>
          ) : null}
          {!coaches.isLoading && !coaches.isError && (coaches.data ?? []).length === 0 ? (
            <View testID="calendar-no-coach">
              <Body muted>You are not matched with a coach yet. Once you are, their open times appear here.</Body>
              <Note text={`Ask your coach for an invite code or contact ${SUPPORT_EMAIL} for help getting matched.`} />
              <SecondaryButton label="Contact support" onPress={() => void supportEmail.open()} testID="calendar-contact-support" />
              <SupportEmailFallback
                handle={supportEmail}
                textStyle={[calendarStyles.noteText, { color: sc.textMuted }]}
                linkColor={sc.accentText}
                testID="calendar-support-fallback"
              />
            </View>
          ) : null}
          {(coaches.data ?? []).map((c) => (
            <WelcomeCard
              key={`welcome-${c.coach_id}`}
              coach={c}
              onBook={() => navigation.navigate('CalendarBook', { coachId: c.coach_id, welcome: true })}
              onOpen={(sessionId) => navigation.navigate('CalendarSession', { sessionId })}
            />
          ))}
          {(coaches.data ?? []).map((c, index) => (
            <CoachTypes
              key={c.coach_id}
              coach={c}
              primaryBook={bookingPrimary && index === 0}
              onMessage={openMessages}
              onBook={(coach, t) =>
                navigation.navigate('CalendarBook', { coachId: coach.coach_id, sessionTypeId: t.id })
              }
            />
          ))}
        </Section>

        <PastSessions onOpen={(sessionId) => navigation.navigate('CalendarSession', { sessionId })} />
      </ScrollView>
    </SafeAreaView>
  );
}
