/**
 * COACH-DM-M: New message (Studio frame "start"). The coach's active clients with a name, A to Z, with search. A tap
 * asks the server to open the thread first (POST /community/workspaces/:id/dms {recipient_user_id}, b#1243 CONTRACT
 * 6763103674), then replaces this page with that thread, so Back returns to where the coach started. A client who has
 * never opened Community answers 404: this page then says so in one true line and opens nothing (operator ruling
 * 01:2x, PLAN question 4), never "This conversation is closed". A block either way opens the thread, whose closed
 * line says who closed it.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackActions, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import { ThreadHeader } from '../../../components/community';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import { communityApi } from '../../../api/communityApi';
import { describeCommunityFailure } from '../../../api/communityErrors';
import { isClosedRefusal } from '../../../components/messaging/ConversationClosed';
import { useCommunityMe } from '../../../hooks/useCommunity';
import { useTheme } from '../../../theme/useTheme';
import { forestPop as fp, radius, spacing, withAlpha } from '../../../theme/tokens';
import type { CoachCommunityNav } from '../coachCommunityNavTypes';
import { DmState, OFF_SEND_LINE, dmCode, initialsOf, isDmOff, useDmRoster, type RosterEntry } from './coachDm';

const notJoinedLine = (name: string) => `${name} has not joined your community yet. You can message them here once they do.`;

export default function CoachDmNewScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const { semanticColors: c } = useTheme();
  const workspaceId = useCommunityMe().data?.workspace_id ?? '';
  const roster = useDmRoster();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clients = useMemo(
    () => [...(roster.data ?? new Map<string, RosterEntry>())]
      .flatMap(([id, r]) => (r.archived || !r.name ? [] : [{ id, name: r.name }]))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [roster.data],
  );
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = clients.filter((k) => words.every((w) => k.name.toLowerCase().includes(w)));

  const openWith = async (k: { id: string; name: string }) => {
    if (busy || !workspaceId) return;
    setBusy(k.id);
    setNotice(null);
    const toThread = () => navigation.dispatch(StackActions.replace('CommunityDmThread', { recipientId: k.id, name: k.name }));
    try {
      await communityApi.openDmThread(workspaceId, k.id);
      toThread();
    } catch (err) {
      const code = dmCode(err);
      if (code === 'community.dm.not_found') setNotice(notJoinedLine(k.name));
      else if (isDmOff(err)) setNotice(OFF_SEND_LINE);
      else if (isClosedRefusal(err)) toThread(); // blocked either way: the thread draws BAM-2a or BAM-2b
      else setNotice(describeCommunityFailure(err, 'send_message').message);
    } finally {
      setBusy(null);
    }
  };

  let body: React.ReactElement;
  if (roster.isError) {
    body = <DmState icon="alert-circle-outline" line="Clients did not load. Check the connection and try again." action="Try again"
      outlined onAction={() => void roster.refetch()} testID="coach-dm-new-error" />;
  } else if (!roster.data) {
    body = <DmState busy line="Loading…" testID="coach-dm-new-loading" />;
  } else {
    body = (
      <FlatList
        data={shown}
        keyExtractor={(k) => k.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<Text style={[styles.section, { color: c.textMuted }]}>Your clients</Text>}
        ListEmptyComponent={<Text style={[styles.empty, { color: c.textMuted }]}>{clients.length === 0 ? 'No clients yet' : `No clients match "${query.trim()}".`}</Text>}
        renderItem={({ item }) => (
          <HapticPressable intent="light" onPress={() => void openWith(item)} accessibilityRole="button" accessibilityLabel={item.name}
            accessibilityState={{ busy: busy === item.id }} testID={`coach-dm-new-row-${item.id}`}
            style={[styles.row, { borderBottomColor: c.border }]}>
            <View style={styles.tile}><Text style={styles.tileText}>{initialsOf(item.name)}</Text></View>
            <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>{item.name}</Text>
            {busy === item.id ? <ActivityIndicator color={c.accent} /> : null}
          </HapticPressable>
        )}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: fp.deep }]} edges={['top']} testID="coach-dm-new-screen">
      <ForestStatusBar />
      <ThreadHeader tone="deep" title="New message" subtitle="Choose a client. Only they see it." backKind="close"
        onBack={() => navigation.goBack()} testID="coach-dm-new-header" />
      <View style={styles.searchBand}>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={fp.onDeepMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search clients" placeholderTextColor={fp.onDeepMuted}
            accessibilityLabel="Search clients" autoCorrect={false} style={styles.searchInput} testID="coach-dm-new-search" />
        </View>
      </View>
      <View style={[styles.flex, { backgroundColor: c.bgPrimary }]}>
        {notice ? (
          <View style={[styles.notice, { backgroundColor: c.bgSurface, borderColor: c.border }]} accessibilityLiveRegion="polite" testID="coach-dm-new-notice">
            <Ionicons name="information-circle-outline" size={18} color={c.textMuted} />
            <Text style={[styles.noticeText, { color: c.textPrimary }]}>{notice}</Text>
          </View>
        ) : null}
        {body}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchBand: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.input, backgroundColor: withAlpha(fp.onDeep, 0.12) },
  searchInput: { flex: 1, color: fp.onDeep, fontSize: 15, paddingVertical: spacing.sm },
  section: { fontFamily: 'Inter_600SemiBold', fontSize: 12, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  tile: { width: 36, height: 36, borderRadius: radius.input, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, fontWeight: '600', color: fp.deep },
  name: { flex: 1, fontSize: 15 },
  empty: { fontSize: 14, textAlign: 'center', padding: spacing.xl },
  notice: { flexDirection: 'row', gap: spacing.sm, margin: spacing.lg, padding: spacing.md, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
});
