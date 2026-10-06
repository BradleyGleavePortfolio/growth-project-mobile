/**
 * CoachBroadcastsScreen — the coach's broadcasts: scheduled one-offs,
 * recurring series and sent history (GET /coach/broadcasts), with cancel,
 * pause and resume. "New broadcast" opens the composer.
 *
 * Server-gated: FEATURE_COACH_BROADCASTS off answers 503 broadcasts.disabled
 * (404 on a backend without the module); the screen then says so, and the
 * Messages entry (BroadcastsEntry) is hidden in the first place.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  broadcastErrorMessage,
  broadcastsApi,
  broadcastsOff,
  type Broadcast,
} from '../../../api/broadcastsApi';
import { spacing, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  STATUS_LABELS,
  actionsFor,
  describeAudience,
  describeStats,
  describeTiming,
  sectionOf,
  type BroadcastSection,
} from './broadcastFormat';

export const broadcastsListKey = ['broadcasts', 'list'] as const;

const SECTIONS: Array<{ key: BroadcastSection; label: string; empty: string }> = [
  { key: 'scheduled', label: 'Scheduled', empty: 'Nothing scheduled. One-time broadcasts set for later show here.' },
  { key: 'recurring', label: 'Recurring', empty: 'No recurring broadcasts. Weekly check-ins and other repeats show here.' },
  { key: 'sent', label: 'Sent', empty: 'Nothing sent yet. Sent and canceled broadcasts show here.' },
];

const ACTION_LABELS = { cancel: 'Cancel', pause: 'Pause', resume: 'Resume' } as const;

export default function CoachBroadcastsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const qc = useQueryClient();
  const [section, setSection] = useState<BroadcastSection>('scheduled');
  const [actionError, setActionError] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: broadcastsListKey,
    queryFn: ({ pageParam }) => broadcastsApi.list(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

  const { refetch } = q;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const items = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const counts = useMemo(() => {
    const c: Record<BroadcastSection, number> = { scheduled: 0, recurring: 0, sent: 0 };
    for (const b of items) c[sectionOf(b)] += 1;
    return c;
  }, [items]);
  const shown = items.filter((b) => sectionOf(b) === section);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'pause' | 'resume' }) => broadcastsApi.transition(id, action),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: broadcastsListKey });
    },
    onError: (err, vars) => {
      const verb = vars.action === 'cancel' ? 'canceled' : vars.action === 'pause' ? 'paused' : 'resumed';
      setActionError(broadcastErrorMessage(err, verb));
      void qc.invalidateQueries({ queryKey: broadcastsListKey });
    },
  });

  const onAction = (b: Broadcast, action: 'cancel' | 'pause' | 'resume') => {
    if (action !== 'cancel') {
      act.mutate({ id: b.id, action });
      return;
    }
    Alert.alert(
      'Cancel this broadcast?',
      b.recurrence
        ? 'No more copies go out. Clients who already got it keep the message.'
        : 'It will not be sent. Clients who already got a copy keep the message.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel broadcast', style: 'destructive', onPress: () => act.mutate({ id: b.id, action: 'cancel' }) },
      ],
    );
  };

  const muted = { color: colors.textMuted };
  const off = q.isError && broadcastsOff(q.error);

  const header = (
    <View>
      <Text style={[typography.bodySmall, muted]}>
        One message to many clients. Each client gets it in their own thread with you and can reply there.
      </Text>
      {!off ? (
        <Pressable
          onPress={() => navigation.navigate('CoachBroadcastComposer')}
          accessibilityRole="button"
          accessibilityLabel="New broadcast"
          style={[styles.primary, { backgroundColor: colors.textPrimary }]}
          testID="broadcasts-new"
        >
          <Text style={[typography.bodyMd, { color: colors.background }]}>New broadcast</Text>
        </Pressable>
      ) : null}
      {!off && !q.isLoading && !q.isError ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {SECTIONS.map((s) => {
            const selected = s.key === section;
            return (
              <Pressable
                key={s.key}
                onPress={() => setSection(s.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${s.label}, ${counts[s.key]}`}
                style={[styles.tab, { borderColor: selected ? colors.textPrimary : colors.border, backgroundColor: selected ? colors.textPrimary : 'transparent' }]}
                testID={`broadcasts-tab-${s.key}`}
              >
                <Text style={[typography.bodySmall, { color: selected ? colors.background : colors.textPrimary }]}>
                  {s.label} ({counts[s.key]})
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {actionError ? (
        <Text style={[typography.bodySmall, { color: colors.error, marginTop: spacing.md }]} accessibilityLiveRegion="polite" testID="broadcasts-action-error">
          {actionError}
        </Text>
      ) : null}
      {q.isLoading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.textMuted} /> : null}
      {q.isError ? (
        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.body, muted]} testID="broadcasts-load-error">
            {off
              ? 'Broadcasts are not available on this account yet. One-to-one messages with clients work as usual.'
              : broadcastErrorMessage(q.error, 'loaded')}
          </Text>
          {!off ? (
            <Pressable onPress={() => void q.refetch()} accessibilityRole="button" accessibilityLabel="Refresh broadcasts" style={[styles.secondary, { borderColor: colors.border }]}>
              <Text style={[typography.body, { color: colors.textPrimary }]}>Refresh broadcasts</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      data={q.isError ? [] : shown}
      keyExtractor={(b) => b.id}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.textMuted} />}
      ListEmptyComponent={
        q.isLoading || q.isError ? null : (
          <Text style={[typography.bodySmall, muted, { marginTop: spacing.lg }]} testID="broadcasts-empty">
            {SECTIONS.find((s) => s.key === section)?.empty}
          </Text>
        )
      }
      ListFooterComponent={
        q.hasNextPage ? (
          <Pressable onPress={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} accessibilityRole="button" accessibilityLabel="Show older broadcasts" style={[styles.secondary, { borderColor: colors.border }]}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{q.isFetchingNextPage ? 'Loading' : 'Show older broadcasts'}</Text>
          </Pressable>
        ) : null
      }
      renderItem={({ item }) => {
        const stats = describeStats(item);
        const busy = act.isPending && act.variables?.id === item.id;
        return (
          <View style={[styles.row, { borderColor: colors.border }]} testID={`broadcast-row-${item.id}`}>
            <View style={styles.rowTop}>
              <Text style={[typography.caption, muted]}>{STATUS_LABELS[item.status]}</Text>
              <Text style={[typography.caption, muted]}>{describeAudience(item.segment)}</Text>
            </View>
            <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.xs }]} numberOfLines={3}>
              {item.body}
            </Text>
            <Text style={[typography.bodySmall, muted, { marginTop: spacing.xs }]} testID={`broadcast-timing-${item.id}`}>
              {describeTiming(item)}
            </Text>
            {stats ? <Text style={[typography.bodySmall, muted]}>{stats}</Text> : null}
            <View style={styles.actions}>
              {actionsFor(item).map((a) => (
                <Pressable
                  key={a}
                  onPress={() => onAction(item, a)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${ACTION_LABELS[a]} broadcast`}
                  accessibilityState={{ disabled: busy, busy }}
                  style={[styles.action, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
                  testID={`broadcast-${a}-${item.id}`}
                >
                  <Text style={[typography.bodySmall, { color: a === 'cancel' ? colors.error : colors.textPrimary }]}>{ACTION_LABELS[a]}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  secondary: { minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, flexWrap: 'wrap' },
  tab: { minHeight: 44, borderWidth: 1, borderRadius: 2, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: { minHeight: 44, minWidth: 72, borderWidth: 1, borderRadius: 2, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
});
