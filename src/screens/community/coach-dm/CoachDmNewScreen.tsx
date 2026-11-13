/**
 * COACH-DM-M: New message (Studio frame "start"). The coach's active clients with a name, A to Z, with search. A tap
 * asks the server to open the thread first (POST /community/workspaces/:id/dms {recipient_user_id}, b#1243 CONTRACT
 * 6763103674), then replaces this page with that thread, so Back returns to where the coach started. A client who has
 * never opened Community answers 404: this page then says so in one true line and opens nothing (operator ruling
 * 01:2x, PLAN question 4), never "This conversation is closed". A block either way opens the thread, whose closed
 * line says who closed it.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useTheme } from '../../../theme/useTheme';
import { brand, forestPop as fp, radius, spacing, withAlpha } from '../../../theme/tokens';
import type { CoachCommunityNav } from '../coachCommunityNavTypes';
import { DmState, OFF_SEND_LINE, dmCode, initialsOf, isDmOff, rosterOf, useDmRoster, useStudioInk } from './coachDm';

const notJoinedLine = (name: string) => `${name} has not joined your community yet. You can message them here once they do.`;

export default function CoachDmNewScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const { semanticColors: c, colorScheme } = useTheme();
  const ink = useStudioInk();
  const workspaceId = useCommunityMe().data?.workspace_id ?? '';
  const roster = useDmRoster();
  const blocked = useBlockedUsersStore((s) => s.blocked); // KT-2: a client I blocked is not offered (Unblock in Settings)
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clients = useMemo(
    () => [...rosterOf(roster.data)]
      .flatMap(([id, r]) => (r.archived || !r.name || blocked.some((b) => b.id === id) ? [] : [{ id, name: r.name }]))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [roster.data, blocked],
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
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={[styles.section, { color: colorScheme === 'dark' ? c.textMuted : brand[500] }]}>Your clients</Text>
        {shown.length === 0 ? (
          <Text style={[styles.empty, { color: c.textMuted }]}>{clients.length === 0 ? 'No clients yet' : `No clients match "${query.trim()}".`}</Text>
        ) : shown.map((item) => (
          <HapticPressable key={item.id} intent="light" onPress={() => void openWith(item)} accessibilityRole="button" accessibilityLabel={item.name}
            accessibilityState={{ busy: busy === item.id }} testID={`coach-dm-new-row-${item.id}`}
            style={[styles.row, { borderBottomColor: ink.line }]}>
            <View style={styles.tile} testID={`tile-coach-dm-new-row-${item.id}`}><Text style={styles.tileText}>{initialsOf(item.name)}</Text></View>
            <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>{item.name}</Text>
            {busy === item.id ? <ActivityIndicator color={c.accent} /> : null}
          </HapticPressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: fp.deep }]} edges={['top']} testID="coach-dm-new-screen">
      <ForestStatusBar />
      <ThreadHeader tone="deep" studio title="New message" subtitle="Choose a client. Only they see it." backKind="close"
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
  // Studio .search (S_start_ios.html:91): margin 0 16px 14px, padding 0 14px, gap 10px.
  searchBand: { paddingHorizontal: spacing.lg, paddingBottom: 14 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.input, backgroundColor: withAlpha(fp.onDeep, 0.12) },
  searchInput: { flex: 1, minHeight: 44, color: fp.onDeep, fontSize: 15 },
  // Studio .sect, .row (min-height 58px here), .mono.cl.sm, .nm at 500 (S_start_ios.html:52-:59). The section stays at
  // 600, not Studio's heavier caps: the app's quiet-luxury doctrine allows no heavier weight (quietLuxuryDoctrine.test.ts).
  section: { fontFamily: 'Inter_600SemiBold', fontSize: 11.5, fontWeight: '600', letterSpacing: 1.6, textTransform: 'uppercase', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58, paddingHorizontal: 18, borderBottomWidth: 1 },
  tile: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, borderColor: fp.sageLine, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, fontWeight: '600', color: fp.forest },
  name: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 16.5, fontWeight: '500' },
  empty: { fontSize: 14, textAlign: 'center', padding: spacing.xl },
  notice: { flexDirection: 'row', gap: spacing.sm, margin: spacing.lg, padding: spacing.md, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
});
