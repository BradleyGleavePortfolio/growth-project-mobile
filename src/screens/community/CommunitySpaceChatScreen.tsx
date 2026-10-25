/**
 * SC-M1 (agent 168, owner #167-3 / #167-5 / #167-6 op 1), FX-871 (agent 169): the space chat. One Slack / iMessage-style
 * stream per space, newest at the bottom, for members and the coach. Registered only behind `communitySpaceChat` (off by
 * default); with the flag off SpaceTree and the coach space list open today's screens.
 *   - Header (mockup VOICE-B 05b): the space list on the left (members: the space drawer; the coach: the coach's space
 *     list), `# name` and the member count, and on the coach's side the info button (members, invites, removals).
 *   - Rows: Studio rows (SpaceChatRow), day lines (Style B's day format), voice rows when communityVoiceNotes is on.
 *   - Composer: SpaceChatComposer (pill field, slots for SC-M4's "+" and SC-M2's mic), shown only once the space has
 *     loaded and the server let this person in, so a banned member never gets a box to type in (owner 10-22 ban ruling).
 *   - Announcements (a coach-posting space): members get no composer, only SC-W03; the coach posts as usual.
 *   - No access (the server answers 404 or 403: not a member, or banned): no space content and no composer, one line
 *     where the composer was: "This conversation is closed" (BAM-1, owner #169-5).
 *   - "New messages" line and pill from SC-BE2's read cursor; both hidden while the server has no read route. The page
 *     opens there (or at the message asked for), loading older pages until that row is loaded (FR-871 Sol B1), once the
 *     cursor has answered. Read marks and the pill follow what is on screen (FlatList viewability), not a scroll
 *     distance: the newest row seen is marked, only while the page is in front and after it has opened in place.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View, type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from '@react-navigation/native';
import { SpaceListButton } from '../../components/community/SpaceDrawer';
import SpaceChatComposer from '../../components/community/space-chat/SpaceChatComposer';
import SpaceChatRow, { DayLine, HashGlyph, MenuGlyph, NewMessagesLine, SMALL_GREY, spaceDay } from '../../components/community/space-chat/SpaceChatRow';
import { useSpaceChat, type PendingRow } from '../../components/community/space-chat/useSpaceChat';
import { type SpaceMessage } from '../../components/community/space-chat/spaceChatApi';
import { describeCommunityFailure } from '../../api/communityErrors';
import { CommunityApiError } from '../../api/apiCall';
import { useCommunityCohorts } from '../../hooks/useCommunity';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isEffectivelyOnline, useNetworkStatus } from '../../hooks/useNetworkStatus';
import { featureFlags } from '../../config/featureFlags';
import { colors, forestPop as fp, radius, spacing, typography } from '../../theme/tokens';

type Params = { CommunitySpaceChat: { cohortId: string; messageId?: string } };
type Item =
  | { type: 'msg'; key: string; m: SpaceMessage }
  | { type: 'local'; key: string; r: PendingRow }
  | { type: 'day'; key: string; label: string }
  | { type: 'new'; key: string };

const drawable = (m: SpaceMessage) =>
  !m.deleted && (m.kind === 'voice' ? featureFlags.communityVoiceNotes && !!m.voice_note : m.kind === 'text' && !!m.body);

export default function CommunitySpaceChatScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { cohortId, messageId } = useRoute<RouteProp<Params, 'CommunitySpaceChat'>>().params;
  // The coach's stack has the space's member page; the member stack has the space drawer.
  const coachStack = !!navigation.getState?.()?.routeNames?.includes('CoachCommunityCohortDetail');
  const client = useCurrentUser();
  const isOnline = isEffectivelyOnline(useNetworkStatus());
  const focused = useIsFocused();
  const cohorts = useCommunityCohorts();
  const cohort = cohorts.data?.cohorts.find((c) => c.id === cohortId);
  const chat = useSpaceChat(cohortId, client?.id ?? null, isOnline, focused);
  const isCoachViewer = cohort?.my_role === 'coach' || cohort?.my_role === 'owner';
  const coachOnly = cohort?.kind === 'announcement' || (cohort as { posting_policy?: string } | undefined)?.posting_policy === 'coach';
  // Only once the server has let this person in (a loaded page, no 404 / 403): never while loading or offline cold.
  const admitted = !!cohort && !!chat.list.data && !chat.noAccess;
  const canPost = admitted && (isCoachViewer || !coachOnly);

  const myName = useMemo(() => chat.messages.find((m) => m.sender_user_id === client?.id)?.sender?.name
    ?? client?.name ?? [client?.firstName, client?.lastName].filter(Boolean).join(' '), [chat.messages, client]);

  // Oldest -> newest with day lines and the New messages line, then reversed for the inverted list.
  const items = useMemo(() => {
    const rows: Array<{ at: string; item: Item; mine: boolean }> = [
      ...chat.messages.filter(drawable).map((m) => ({ at: m.created_at, item: { type: 'msg', key: m.id, m } as Item, mine: m.sender_user_id === client?.id })),
      ...chat.pending.filter((r) => r.state !== 'sent' || !chat.messages.some((m) => m.id === r.serverId))
        .map((r) => ({ at: r.createdAt, item: { type: 'local', key: r.localId, r } as Item, mine: true })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const lastRead = chat.readCursor?.last_read_at ?? null;
    const out: Item[] = [];
    let day = '';
    let newDrawn = false;
    for (const row of rows) {
      const d = spaceDay(row.at);
      if (d !== day) { day = d; out.push({ type: 'day', key: `day-${row.at}`, label: d }); }
      if (lastRead && !newDrawn && !row.mine && row.item.type === 'msg' && row.at > lastRead) {
        newDrawn = true;
        out.push({ type: 'new', key: 'new-line' });
      }
      out.push(row.item);
    }
    return out.reverse();
  }, [chat.messages, chat.pending, chat.readCursor, client?.id]);

  // Open at the message asked for, else at the New messages line, once per visit after the read cursor has answered.
  // Older pages load first until that row is loaded (the asked-for row, or the oldest unread one) or there are none.
  const listRef = useRef<FlatList<Item>>(null);
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [placed, setPlaced] = useState(false);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => setSeen(new Set(viewableItems.map((v) => v.key)))).current;
  useEffect(() => {
    if (target !== undefined || !chat.readSettled || items.length === 0) return;
    const lastRead = chat.readCursor?.last_read_at;
    const oldest = chat.messages[chat.messages.length - 1];
    const short = messageId ? !items.some((i) => i.key === messageId) : !!lastRead && !!oldest && oldest.created_at > lastRead;
    // At most 10 pages (300 rows): past that the line sits above the oldest row loaded (C, edge, deferred to 10k clients).
    if (short && chat.list.hasNextPage && (chat.list.data?.pages.length ?? 0) < 10) {
      if (!chat.list.isFetchingNextPage) void chat.list.fetchNextPage();
      return;
    }
    const index = items.findIndex((i) => (messageId ? i.key === messageId : i.type === 'new'));
    setTarget(index > 0 ? items[index].key : null);
    if (index > 0) requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }));
  }, [items, messageId, target, chat.readSettled, chat.readCursor, chat.messages, chat.list]);
  // In place once the row it opened at is on screen (or the person scrolls); only then do read marks count.
  useEffect(() => { if (!placed && (target === null || (!!target && seen.has(target)))) setPlaced(true); }, [placed, target, seen]);

  // The pill: someone else posts while the row that was newest is off screen; it goes once the newest row is seen.
  const [pill, setPill] = useState(false);
  const newest = chat.messages.find(drawable);
  const prevNewest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!newest || newest.id === prevNewest.current) return;
    const prev = prevNewest.current;
    prevNewest.current = newest.id;
    if (prev !== undefined && !seen.has(prev) && newest.sender_user_id !== client?.id) setPill(true);
  }, [newest, seen, client?.id]);
  useEffect(() => { if (newest && seen.has(newest.id)) setPill(false); }, [newest, seen]);
  // Read up to the newest row actually on screen; a failed mark is tried again with the next one seen.
  const newestSeen = placed && focused ? chat.messages.find((m) => drawable(m) && seen.has(m.id)) : undefined;
  const marked = useRef('');
  useEffect(() => {
    if (!newestSeen || newestSeen.created_at <= (marked.current || chat.readCursor?.last_read_at || '')) return;
    const before = marked.current;
    marked.current = newestSeen.created_at;
    void chat.markRead(newestSeen.id).then((ok) => { if (!ok && marked.current === newestSeen.created_at) marked.current = before; });
  }, [newestSeen, chat]);

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item.type === 'day') return <DayLine label={item.label} />;
    if (item.type === 'new') return <NewMessagesLine />;
    if (item.type === 'local') {
      const r = item.r;
      return (
        <SpaceChatRow
          id={r.localId} name={myName} isCoach={isCoachViewer} createdAt={r.createdAt} body={r.body}
          authorId={client?.id ?? ''} state={r.state} onRetry={() => chat.retry(r)} onDiscard={() => chat.removeLocal(r.localId)}
          viewerUserId={client?.id} offline={!isOnline}
        />
      );
    }
    const m = item.m;
    return (
      <SpaceChatRow
        id={m.id} name={m.sender?.name ?? ''} avatarUrl={m.sender?.avatar_url} isCoach={!!m.sender?.is_coach}
        createdAt={m.created_at} body={m.body} voice={m.voice_note} authorId={m.sender_user_id}
        viewerUserId={client?.id} viewerCoachId={client?.coach_id} offline={!isOnline}
        onDelete={() => chat.remove(m.id)} onBlocked={chat.dropAuthor}
      />
    );
  }, [chat, client, isCoachViewer, isOnline, myName]);

  const loading = chat.list.isLoading || cohorts.isLoading;
  // Offline with nothing kept: say so at once rather than spin through the retries.
  const offlineEmpty = !isOnline && !chat.list.data;
  const offlineError = new CommunityApiError('network', 0, 'offline', { isAxiosError: true });
  // The space's name and posting rules come from the cohort list: without them there is no header and no composer.
  const metaFailed = cohorts.isError && !cohort;
  const failure = chat.noAccess ? null
    : metaFailed ? describeCommunityFailure(isOnline ? cohorts.error : offlineError, 'load_space')
      : (chat.list.isError || offlineEmpty) && items.length === 0
        ? describeCommunityFailure(isOnline ? chat.list.error : offlineError, 'load_space') : null;
  const reload = () => {
    if (cohorts.isError) void cohorts.refetch();
    void chat.list.refetch();
  };
  const members = cohort ? `${cohort.member_count.toLocaleString('en-US')} ${cohort.member_count === 1 ? 'member' : 'members'}` : '';

  return (
    <SafeAreaView style={s.safe} edges={['top']} testID="space-chat-screen">
      <View style={s.header}>
        <View style={s.icon}>
          {coachStack ? (
            <TouchableOpacity onPress={() => navigation.navigate('CoachCommunityCohorts')} accessibilityRole="button" accessibilityLabel="Open space list" style={s.icon} testID="space-chat-spaces">
              <MenuGlyph color={fp.onDeep} />
            </TouchableOpacity>
          ) : <SpaceListButton icon={<MenuGlyph color={fp.onDeep} />} />}
        </View>
        <View style={s.titles} accessible accessibilityRole="header">
          <View style={s.titleRow}>
            {cohort ? <HashGlyph color={fp.onDeepMuted} /> : null}
            <Text style={s.title} numberOfLines={1}>{cohort ? cohort.name : ' '}</Text>
          </View>
          {cohort ? <Text style={s.sub}>{members}</Text> : null}
        </View>
        <View style={s.icon}>
          {coachStack && cohort ? (
            <TouchableOpacity
              onPress={() => navigation.navigate('CoachCommunityCohortDetail', { cohortId, cohortName: cohort.name })}
              accessibilityRole="button" accessibilityLabel="Space info" style={s.icon} testID="space-chat-info"
            >
              <Ionicons name="information-circle-outline" size={24} color={fp.onDeep} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {chat.noAccess ? <View style={s.flex} /> : failure ? (
          <View style={s.center} testID="space-chat-error">
            <Ionicons name={isOnline ? 'alert-circle-outline' : 'cloud-offline-outline'} size={28} color={SMALL_GREY} />
            <Text style={s.muted}>{failure.message}</Text>
            <TouchableOpacity onPress={reload} accessibilityRole="button" accessibilityLabel="Try again" style={s.retry} testID="space-chat-reload">
              <Text style={s.retryLabel}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : loading && items.length === 0 ? (
          <View style={s.center} testID="space-chat-loading"><ActivityIndicator color={fp.forest} /></View>
        ) : items.length === 0 ? (
          <View style={s.center} testID="space-chat-empty">
            {canPost ? <Text style={s.muted}>No messages yet. Say hello.</Text> : null}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={renderItem}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={VIEWABLE}
            onScrollBeginDrag={() => setPlaced(true)}
            keyboardShouldPersistTaps="handled"
            onEndReached={() => { if (chat.list.hasNextPage && !chat.list.isFetchingNextPage) void chat.list.fetchNextPage(); }}
            onEndReachedThreshold={0.4}
            onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })}
            contentContainerStyle={s.stream}
            testID="space-chat-list"
          />
        )}
        {pill && chat.readCursor ? (
          <TouchableOpacity
            onPress={() => { listRef.current?.scrollToOffset({ offset: 0, animated: true }); setPill(false); }}
            accessibilityRole="button" accessibilityLabel="New messages" style={s.pill} testID="space-chat-pill"
          >
            <Ionicons name="arrow-down" size={16} color={fp.onDeep} />
            <Text style={s.pillText}>New messages</Text>
          </TouchableOpacity>
        ) : null}
        {chat.noAccess ? (
          <Text style={s.line} testID="space-chat-no-access">This conversation is closed</Text>
        ) : canPost ? (
          <SpaceChatComposer cohortId={cohortId} onSend={chat.send} />
        ) : admitted ? (
          <Text style={s.line} testID="space-chat-hint">Only your coach posts here. Press and hold a message to reply.</Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const VIEWABLE = { itemVisiblePercentThreshold: 60 };
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: fp.deep },
  flex: { flex: 1, backgroundColor: colors.bone },
  // 05b .mast: 2 6 10 padding, 2 pt gaps; a 19 pt semibold title after a drawn muted hash, a 13 pt count under it.
  header: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingTop: 2, paddingBottom: 10, backgroundColor: fp.deep },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0, paddingHorizontal: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 19, lineHeight: 24, color: fp.onDeep, flexShrink: 1 },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: fp.onDeepMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  muted: { ...typography.body, color: SMALL_GREY, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.button, borderWidth: 1, borderColor: fp.deep },
  retryLabel: { ...typography.bodyMd, color: fp.deep },
  stream: { paddingVertical: spacing.sm },
  pill: {
    position: 'absolute', alignSelf: 'center', bottom: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.chip, backgroundColor: fp.deep,
  },
  pillText: { ...typography.bodyMd, color: fp.onDeep },
  line: { ...typography.bodySmall, color: SMALL_GREY, textAlign: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.sageLine },
});
