/**
 * TimelinePage (TIMELINE T1, Style C; behind clientTimelineV2, off). The client's own record, one card a
 * day, newest first. Weigh-ins and wins only, coached and coachless alike: no coach message ever shows
 * (#TIMELINE-COACH op 1, backend b#1078); a missed check-in is a plain grey "No check-in"
 * (#TIMELINE-MISSED op 1). Rows print the server's own words, in the client's unit with the C8 trend.
 * The door is a row on Progress (#TIMELINE-DOOR op 1). Flag off, TimelineScreen is unchanged.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type ParamListBase } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchTimeline, type TimelineEvent, type TimelineLane } from '../../../services/timelineApi';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { PrimaryButton, Screen } from '../../../ui';
import { QuietError, isConnectionFailure } from '../../../ui/states/QuietStates';
import { Skeleton } from '../../../ui/skeletons/Skeleton';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, spacing, typography, type SemanticTokens } from '../../../theme/tokens';

export const TIMELINE_COPY = {
  title: 'Timeline',
  subline: 'Weigh-ins and wins, newest first.',
  loading: 'Loading your timeline',
  empty: 'Your timeline starts with your first weigh-in.',
  logWeight: 'Log weight',
  offline: 'Newer days load when you are back online.',
  failed: 'Your timeline did not load.',
  noAnswer: 'Check the connection and try again.',
} as const;

// Lanes by name: a server before b#1078 never sends its coach lane here either.
const LANES: TimelineLane[] = ['body', 'win', 'friction'];
const PAGE = { sinceDays: 365, limit: 20, lanes: LANES };

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A weigh-in is a calendar day (sent as UTC midnight); every other event is a moment, read in local time. */
export const dayOf = (e: TimelineEvent) => (e.eventType === 'weight_logged' ? e.at.slice(0, 10) : localDay(new Date(e.at)));

/** "Today" with its date on the right, else "Friday, October 16" (the year only when it is not this year). */
export function dayHeading(day: string, now = new Date()): { title: string; date?: string } {
  const [y, m, d] = day.split('-').map(Number);
  const long = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', ...(y === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return day === localDay(now) ? { title: 'Today', date: long } : { title: long };
}

export function groupByDay(events: TimelineEvent[]): { day: string; rows: TimelineEvent[] }[] {
  const days = new Map<string, TimelineEvent[]>();
  for (const e of events) days.set(dayOf(e), [...(days.get(dayOf(e)) ?? []), e]);
  return [...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, rows]) => ({ day, rows }));
}

type Feed = {
  events: TimelineEvent[];
  next: string | null;
  status: 'loading' | 'ready' | 'failed';
  noAnswer: boolean; // the last full load got no answer (offline, dropped, timed out)
  more: 'idle' | 'busy' | 'failed' | 'noAnswer'; // older days; noAnswer is a failure with no answer
  refreshing: boolean;
};
const START: Feed = { events: [], next: null, status: 'loading', noAnswer: false, more: 'idle', refreshing: false };

function Row({ event, last, sc }: { event: TimelineEvent; last: boolean; sc: SemanticTokens }) {
  const missed = event.eventType === 'missed_checkin';
  const icon = event.lane === 'body' ? 'scale-outline' : missed ? 'ellipse-outline' : 'checkmark-circle-outline';
  return (
    <View
      accessible
      accessibilityLabel={[event.title, event.body].filter(Boolean).join('. ')}
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border }]}
    >
      <Ionicons name={icon} size={20} color={missed ? sc.data.missed : sc.data.moss} style={styles.icon} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: missed ? sc.data.missed : sc.textPrimary }]}>{event.title}</Text>
        {event.body ? <Text style={[styles.rowBody, { color: sc.textMuted }]}>{event.body}</Text> : null}
      </View>
    </View>
  );
}

export default function TimelinePage() {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const online = isEffectivelyOnline(useNetworkStatus());
  const [feed, setFeed] = useState<Feed>(START);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const live = useRef(true);

  // The native Back sits on the forest masthead.
  useLayoutEffect(() => {
    navigation.setOptions({ headerStyle: { backgroundColor: sc.surface.masthead }, headerTintColor: sc.textOnAccent });
  }, [navigation, sc]);

  const load = useCallback(async (refreshing = false) => {
    setFeed((f) => ({ ...f, refreshing, status: f.events.length || refreshing ? f.status : 'loading' }));
    try {
      const r = await fetchTimeline(PAGE);
      if (live.current) setFeed({ ...START, events: r.events, next: r.nextCursor, status: 'ready' });
    } catch (err) {
      if (!live.current) return;
      const noAnswer = isConnectionFailure(err);
      // Offline keeps the days already loaded; any other failure keeps nothing old on screen.
      setFeed((f) => (noAnswer && f.events.length ? { ...f, noAnswer, refreshing: false } : { ...START, status: 'failed', noAnswer }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    const { next, more, status } = feedRef.current;
    if (!next || more === 'busy' || status !== 'ready') return;
    setFeed((f) => ({ ...f, more: 'busy' }));
    try {
      const r = await fetchTimeline({ ...PAGE, cursor: next });
      if (!live.current) return;
      setFeed((f) => {
        const seen = new Set(f.events.map((e) => e.id));
        return { ...f, events: [...f.events, ...r.events.filter((e) => !seen.has(e.id))], next: r.nextCursor, more: 'idle' };
      });
    } catch (err) {
      if (live.current) setFeed((f) => ({ ...f, more: isConnectionFailure(err) ? 'noAnswer' : 'failed' }));
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  // Back online: the newer days load, as the offline line says.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void load(feedRef.current.events.length > 0);
    wasOnline.current = online;
  }, [online, load]);

  const failedLine = (noAnswer: boolean) => (noAnswer ? `${TIMELINE_COPY.failed} ${TIMELINE_COPY.noAnswer}` : TIMELINE_COPY.failed);
  const masthead = (
    <View style={[styles.masthead, { backgroundColor: sc.surface.masthead }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: sc.textOnAccent }]}>{TIMELINE_COPY.title}</Text>
      <Text style={[styles.subline, { color: sc.textOnMastheadMuted }]}>{TIMELINE_COPY.subline}</Text>
    </View>
  );

  if (feed.status !== 'ready' || feed.events.length === 0) {
    const empty = feed.status === 'ready';
    return (
      <Screen
        edges={[]}
        scroll={false}
        header={masthead}
        testID="timeline-page"
        footer={empty ? (
          <PrimaryButton
            label={TIMELINE_COPY.logWeight}
            onPress={() => navigation.navigate('Progress', { logWeightAt: Date.now() })}
            testID="timeline-log-weight"
          />
        ) : undefined}
      >
        {feed.status === 'loading' ? (
          <View accessible accessibilityLabel={TIMELINE_COPY.loading} testID="timeline-loading" style={styles.list}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.day}>
                <Skeleton width="40%" height={18} borderRadius={radius.control} />
                <View style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
                  {[0, 1].map((j) => (
                    <View key={j} style={[styles.row, styles.skeletonRow]}>
                      <Skeleton width={20} height={20} borderRadius={radius.control} />
                      <View style={styles.rowText}>
                        <Skeleton width="70%" height={14} />
                        <Skeleton width="40%" height={12} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : empty ? (
          <Text style={[styles.empty, { color: sc.textPrimary }]}>{TIMELINE_COPY.empty}</Text>
        ) : (
          <View style={styles.list}>
            <QuietError message={failedLine(feed.noAnswer)} onRetry={() => void load()} layout="inline" testID="timeline-error" />
          </View>
        )}
      </Screen>
    );
  }

  const offline = !online || feed.noAnswer;
  return (
    <FlatList
      testID="timeline-page"
      style={{ backgroundColor: sc.bgPrimary }}
      contentContainerStyle={styles.listEnd}
      data={groupByDay(feed.events)}
      keyExtractor={(d) => d.day}
      ListHeaderComponent={(
        <>
          {masthead}
          {offline ? <Text style={[styles.offline, { color: sc.textMuted }]} testID="timeline-offline">{TIMELINE_COPY.offline}</Text> : null}
        </>
      )}
      renderItem={({ item }) => {
        const heading = dayHeading(item.day);
        return (
          <View style={[styles.day, styles.gutter]}>
            <View style={styles.dayHead} accessible accessibilityRole="header" accessibilityLabel={heading.date ? `${heading.title}, ${heading.date}` : heading.title}>
              <Text style={[styles.dayTitle, { color: sc.textPrimary }]}>{heading.title}</Text>
              {heading.date ? <Text style={[styles.dayDate, { color: sc.textMuted }]}>{heading.date}</Text> : null}
            </View>
            <View style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
              {item.rows.map((e, i) => <Row key={e.id} event={e} last={i === item.rows.length - 1} sc={sc} />)}
            </View>
          </View>
        );
      }}
      ListFooterComponent={
        feed.more === 'busy' ? (
          <ActivityIndicator color={sc.textMuted} style={styles.more} />
        ) : feed.more !== 'idle' ? (
          <View style={styles.gutter}>
            <QuietError message={failedLine(feed.more === 'noAnswer')} onRetry={() => void loadMore()} layout="inline" testID="timeline-more-error" />
          </View>
        ) : null
      }
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.4}
      refreshing={feed.refreshing}
      onRefresh={() => void load(true)}
    />
  );
}

const styles = StyleSheet.create({
  masthead: {
    paddingHorizontal: layout.gutter,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
  },
  title: { ...typography.h1 },
  subline: { ...typography.body },
  list: { paddingTop: spacing.xl },
  listEnd: { paddingBottom: spacing['2xl'] },
  gutter: { paddingHorizontal: layout.gutter },
  offline: { ...typography.bodySmall, paddingHorizontal: layout.gutter, paddingTop: spacing.lg },
  day: { paddingTop: spacing.xl, gap: spacing.md },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  dayTitle: { ...typography.h3, flexShrink: 1 },
  dayDate: { ...typography.bodySmall },
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { minHeight: layout.rowMinHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  skeletonRow: { alignItems: 'flex-start' },
  icon: { width: 20 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyMd, lineHeight: 22 },
  rowBody: { ...typography.bodySmall, lineHeight: 20 },
  empty: { ...typography.h2, paddingTop: spacing.xl },
  more: { paddingVertical: spacing.xl },
});
