/**
 * CalendarHomeScreen — S-SCHED client Calendar tab root.
 *
 * My coaches -> each coach's approved appointment types -> book; then
 * Upcoming sessions with their status, then Past sessions (paged). The
 * welcome call card reads the persistent server marker (book / booked /
 * done). Times are in the client's own time zone. Empty and failed states
 * give recovery actions instead of a fake empty schedule. Phone-calendar
 * exports are explicit user-controlled copies.
 */
import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BookableCoach, CoachingSession, SessionType } from '../../../api/schedulingApi';
import { resolveClientTimezone } from '../../../api/schedulingApi';
import { useBookableTypes, useMyCoaches, useMySessions, usePastSessions } from '../../../hooks/useCalendar';
import { coachTimeLabel, formatRange, formatWhen } from '../../../calendar/calendarTime';
import { calendarErrorMessage } from '../../../calendar/schedulingErrors';
import { SUPPORT_EMAIL } from '../../../constants/support';
import { SupportEmailFallback, useSupportEmail } from '../../../components/support/SupportEmailFallback';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { Body, Card, Note, SecondaryButton, Section, Title, calendarStyles, statusLabel } from './calendarUi';

type Props = NativeStackScreenProps<CalendarStackParamList, 'CalendarHome'>;

export function useOpenMessages(): () => void {
  const nav = useNavigation<NavigationProp<ParamListBase>>();
  return () => {
    // Messages lives in the Home stack; jump there from any tab.
    nav.navigate('Home', { screen: 'Messages' });
  };
}

function CoachTypes({
  coach,
  onBook,
  onMessage,
}: {
  coach: BookableCoach;
  onBook: (coach: BookableCoach, t: SessionType) => void;
  onMessage: () => void;
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
  if (s.meeting_link_status === 'pending') return 'Your coach will add the call link before it starts.';
  return null;
}

function SessionRow({
  s,
  coachTz,
  onPress,
}: {
  s: CoachingSession;
  coachTz: string | null;
  onPress: () => void;
}) {
  const coachClock = coachTimeLabel(s.start_at, coachTz);
  const link = linkNote(s);
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${s.title}. ${formatWhen(s.start_at)}. ${statusLabel(s.status)}.`}
      accessibilityHint="Opens the session"
      testID={`calendar-session-${s.id}`}
    >
      <Body>{s.title}</Body>
      <Note text={`${formatWhen(s.start_at)}. ${formatRange(s.start_at, s.end_at)}.`} />
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

  return (
    <SafeAreaView style={[calendarStyles.screen, { backgroundColor: sc.bgPrimary }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={calendarStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="calendar-home"
      >
        <Title>Calendar</Title>
        <Body muted>Book time with your coach and see your sessions. Times are shown in your time zone.</Body>

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
          {(coaches.data ?? []).map((c) => (
            <CoachTypes
              key={c.coach_id}
              coach={c}
              onMessage={openMessages}
              onBook={(coach, t) =>
                navigation.navigate('CalendarBook', { coachId: coach.coach_id, sessionTypeId: t.id })
              }
            />
          ))}
        </Section>

        <Section title="Upcoming sessions">
          {list.isLoading ? <Note text="Loading upcoming sessions." /> : null}
          {list.isError ? (
            <View>
              <Note text={calendarErrorMessage(list.error, 'load upcoming sessions')} testID="calendar-sessions-error" />
              <SecondaryButton label="Refresh sessions" onPress={() => void list.refetch()} />
            </View>
          ) : null}
          {!list.isLoading && !list.isError && rows.length === 0 ? (
            <View testID="calendar-upcoming-empty">
              <Body muted>Nothing booked yet. Pick an appointment type above, or message your coach.</Body>
              <SecondaryButton label="Message your coach" onPress={openMessages} testID="calendar-empty-message" />
            </View>
          ) : null}
          {rows.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              coachTz={coachById.get(s.coach_id)?.timezone ?? null}
              onPress={() => navigation.navigate('CalendarSession', { sessionId: s.id })}
            />
          ))}
        </Section>

        <PastSessions onOpen={(sessionId) => navigation.navigate('CalendarSession', { sessionId })} />
      </ScrollView>
    </SafeAreaView>
  );
}
