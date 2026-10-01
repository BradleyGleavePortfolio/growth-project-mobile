/**
 * CalendarHomeScreen — S-SCHED client Calendar tab root.
 *
 * My coaches -> each coach's approved appointment types -> book; then
 * Upcoming and Past sessions with their status. Times are in the client's
 * own time zone. Empty and offline states are calm and point to "Message
 * your coach". Also keeps phone-calendar events in step with the server
 * (moved -> updated, cancelled or declined -> removed).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BookableCoach, CoachingSession, SessionType } from '../../../api/schedulingApi';
import { resolveClientTimezone } from '../../../api/schedulingApi';
import { useBookableTypes, useMyCoaches, useMySessions } from '../../../hooks/useCalendar';
import { coachTimeLabel, formatRange, formatWhen } from '../../../calendar/calendarTime';
import { syncPhoneCalendar } from '../../../calendar/phoneCalendar';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { spacing, typography } from '../../../theme/tokens';
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
      {types.isError && list.length === 0 ? (
        <Note text="Appointment types could not load. Check your connection and pull to refresh." testID="calendar-types-error" />
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
  const upcoming = useMySessions('upcoming');
  const past = useMySessions('past');
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const openMessages = useOpenMessages();

  const coachById = useMemo(() => {
    const m = new Map<string, BookableCoach>();
    for (const c of coaches.data ?? []) m.set(c.coach_id, c);
    return m;
  }, [coaches.data]);

  // Keep phone events this device added in step with the server.
  useEffect(() => {
    const all = [...(upcoming.data ?? []), ...(past.data ?? [])];
    if (all.length === 0) return;
    void syncPhoneCalendar(all, (s) => coachById.get(s.coach_id)?.name ?? 'your coach');
  }, [upcoming.data, past.data, coachById]);

  const refreshing = coaches.isRefetching || upcoming.isRefetching || past.isRefetching;
  const onRefresh = () => {
    void coaches.refetch();
    void upcoming.refetch();
    void past.refetch();
  };

  const list = tab === 'upcoming' ? upcoming : past;
  const rows = list.data ?? [];
  const offline = (coaches.isError || list.isError) && !coaches.data;

  return (
    <SafeAreaView style={[calendarStyles.screen, { backgroundColor: sc.bgPrimary }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={calendarStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="calendar-home"
      >
        <Title>Calendar</Title>
        <Body muted>Book time with your coach and see your sessions. Times are shown in your time zone.</Body>

        {offline ? (
          <Note text="You appear to be offline. Pull to refresh when you are back online." testID="calendar-offline" />
        ) : null}

        <Section title={(coaches.data?.length ?? 0) > 1 ? 'Your coaches' : 'Your coach'}>
          {coaches.isLoading ? <Note text="Loading." /> : null}
          {!coaches.isLoading && !coaches.isError && (coaches.data ?? []).length === 0 ? (
            <View testID="calendar-no-coach">
              <Body muted>You are not matched with a coach yet. Once you are, their open times appear here.</Body>
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

        <Section title="Your sessions">
          <View style={styles.segment} accessibilityRole="tablist">
            {(['upcoming', 'past'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === k }}
                accessibilityLabel={k === 'upcoming' ? 'Upcoming' : 'Past'}
                style={[styles.segItem, { borderColor: sc.textPrimary, backgroundColor: tab === k ? sc.textPrimary : 'transparent' }]}
                testID={`calendar-tab-${k}`}
              >
                <Text style={[styles.segText, { color: tab === k ? sc.bgPrimary : sc.textPrimary }]}>
                  {k === 'upcoming' ? 'Upcoming' : 'Past'}
                </Text>
              </Pressable>
            ))}
          </View>
          {list.isLoading ? <Note text="Loading." /> : null}
          {!list.isLoading && rows.length === 0 ? (
            <View testID={`calendar-${tab}-empty`}>
              <Body muted>
                {tab === 'upcoming'
                  ? 'Nothing booked yet. Pick an appointment type above, or message your coach.'
                  : 'Your past sessions will appear here.'}
              </Body>
              {tab === 'upcoming' ? (
                <SecondaryButton label="Message your coach" onPress={openMessages} testID="calendar-empty-message" />
              ) : null}
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

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', marginBottom: spacing.md },
  segItem: { flex: 1, borderWidth: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  segText: { ...typography.bodyMd },
});
