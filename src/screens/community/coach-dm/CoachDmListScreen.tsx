/**
 * COACH-DM-M: the coach's community direct messages (Studio frame "list"). Rows come from GET .../dms (b#1243: the
 * coach's current clients only, newest first, ?limit=100), named from the roster read. States: loading, error with Try
 * again, off (403 community.dm.disabled, 503 community.disabled, the server switch, no workspace: no switch drawn, and
 * no New message, which could only answer "off"), empty with Message a client, and the rows.
 */
import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import { DmRow, ThreadHeader } from '../../../components/community';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import { useTheme } from '../../../theme/useTheme';
import { forestPop as fp } from '../../../theme/tokens';
import type { CoachCommunityNav } from '../coachCommunityNavTypes';
import { DmState, NO_NAME, OFF_LINE, OFF_TITLE, initialsOf, useCoachDms, useDmRoster } from './coachDm';

export default function CoachDmListScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const { semanticColors: c } = useTheme();
  const { me, threads, off } = useCoachDms();
  const roster = useDmRoster();
  const failed = !off && (me.isError || threads.isError || roster.isError);
  const loading = !off && !failed && (me.isLoading || threads.isLoading || roster.isLoading || !threads.data || !roster.data);
  const rows = [...(threads.data ?? [])].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
  const startNew = () => navigation.navigate('CoachCommunityDmNew');
  const retry = () => {
    if (me.isError) void me.refetch();
    if (threads.isError) void threads.refetch();
    if (roster.isError) void roster.refetch();
  };

  let body: React.ReactElement;
  if (off) {
    body = <DmState icon="chatbubble-outline" title={OFF_TITLE} line={OFF_LINE} testID="coach-dm-list-off" />;
  } else if (failed) {
    body = (
      <DmState icon="alert-circle-outline" line="Your conversations did not load. Check your connection, then try again."
        action="Try again" onAction={retry} outlined testID="coach-dm-list-error" actionTestID="coach-dm-list-retry" />
    );
  } else if (loading) {
    body = (
      <View style={styles.flex} accessibilityState={{ busy: true }} testID="coach-dm-list-loading">
        {[0, 1, 2, 3].map((n) => (
          <View key={n} style={[styles.skeleton, { borderBottomColor: c.border }]}>
            <View style={[styles.skTile, { backgroundColor: c.bgSurface }]} />
            <View style={[styles.skBar, { backgroundColor: c.bgSurface }]} />
          </View>
        ))}
        <DmState line="Loading…" />
      </View>
    );
  } else if (rows.length === 0) {
    body = (
      <DmState icon="chatbubble-outline" title="No conversations yet"
        line="When a client sends you a direct message in your community, it shows here."
        action="Message a client" onAction={startNew} testID="coach-dm-list-empty" actionTestID="coach-dm-list-start" />
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(t) => t.thread_id}
        renderItem={({ item }) => {
          const name = roster.data?.get(item.other_user_id)?.name ?? null;
          return (
            <DmRow
              thread={item}
              participantLabel={name ?? NO_NAME}
              initials={initialsOf(name)}
              chevron
              onPress={() => navigation.navigate('CommunityDmThread', { recipientId: item.other_user_id, ...(name ? { name } : {}) })}
              testID={`coach-dm-row-${item.other_user_id}`}
            />
          );
        }}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: fp.deep }]} edges={['top']} testID="coach-dm-list">
      <ForestStatusBar />
      <ThreadHeader
        tone="deep"
        title="Direct messages"
        onBack={() => navigation.goBack()}
        trailing={off ? null : (
          <HapticPressable intent="light" onPress={startNew} accessibilityRole="button" accessibilityLabel="New message"
            testID="coach-dm-new" style={styles.slot}>
            <Ionicons name="create-outline" size={22} color={fp.onDeep} />
          </HapticPressable>
        )}
        testID="coach-dm-list-header"
      />
      <View style={[styles.flex, { backgroundColor: c.bgPrimary }]}>{body}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  slot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  skeleton: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  skTile: { width: 40, height: 40, borderRadius: 12 },
  skBar: { height: 12, width: '50%', borderRadius: 6 },
});
