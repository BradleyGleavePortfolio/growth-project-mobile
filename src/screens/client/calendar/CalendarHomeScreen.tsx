/**
 * CalendarHomeScreen — S-SCHED client Calendar tab root.
 *
 * My coaches -> each coach's approved appointment types -> book; then
 * Upcoming sessions with their status. Times are in the client's own time
 * zone. Empty and failed states give recovery actions instead of a fake
 * empty schedule. Phone-calendar exports are explicit user-controlled copies.
 */
import React, { useMemo, useState } from 'react';
import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BookableCoach, CoachingSession, SessionType } from '../../../api/schedulingApi';
import { resolveClientTimezone } from '../../../api/schedulingApi';
import { useBookableTypes, useMyCoaches, useMySessions } from '../../../hooks/useCalendar';
import { coachTimeLabel, formatRange, formatWhen } from '../../../calendar/calendarTime';
import { calendarErrorMessage } from '../../../calendar/schedulingErrors';
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
          <Body>{t.name}</Body>
          <Note text={`${t.duration_minutes} minutes. ${t.auto_approve ? 'Confirmed right away.' : `${coach.name} confirms each request.`}`} />
          {t.description ? <Note text={t.description} /> : null}
        </Card>
      ))}
    </View>
  );
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
    </Card>
  );
}

export default function CalendarHomeScreen({ navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const coaches = useMyCoaches();
  const upcoming = useMySessions();
  const [supportMessage, setSupportMessage] = useState<string | null>(null);
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
              <Note text="Ask your coach for an invite code or contact Bradley@Bradleytgpcoaching.com for help getting matched." />
              <SecondaryButton label="Contact support" onPress={() => void Linking.openURL('mailto:Bradley@Bradleytgpcoaching.com').catch((err: unknown) => setSupportMessage(calendarErrorMessage(err, 'open support email')))} />
              {supportMessage ? <Note text={supportMessage} /> : null}
            </View>
          ) : null}
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
      </ScrollView>
    </SafeAreaView>
  );
}
