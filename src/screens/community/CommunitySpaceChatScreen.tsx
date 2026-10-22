/**
 * SC-M1 (agent 168, owner #167-3 / #167-5 / #167-6 op 1): the space chat. One Slack / iMessage-style stream per space,
 * newest at the bottom, for members and the coach. Registered only behind `communitySpaceChat` (off by default); with
 * the flag off SpaceTree and the coach space list open today's screens.
 *   - Rows: Studio rows (SpaceChatRow), day lines (StyleBDayMark + dayB), voice rows when communityVoiceNotes is on.
 *   - Composer: ComposerInput with this space's draft kept on the device (owner chat-discard op 1).
 *   - Announcements (a coach-posting space): members get no composer, only SC-W03; the coach posts as usual.
 *   - No access (the server answers 404: not a member, or banned): no space content and no composer (owner 10-22 ban
 *     ruling, 6352485175), one line where the composer was.
 *   - "New messages" line and pill from SC-BE2's read cursor; both hidden while the server has no read route.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import ComposerInput from '../../components/community/ComposerInput';
import SpaceChatRow, { NewMessagesLine } from '../../components/community/space-chat/SpaceChatRow';
import { useSpaceChat, type PendingRow } from '../../components/community/space-chat/useSpaceChat';
import { SPACE_MESSAGE_MAX, type SpaceMessage } from '../../components/community/space-chat/spaceChatApi';
import { StyleBDayMark, dayB } from '../../components/messaging/StyleBThread';
import { describeCommunityFailure } from '../../api/communityErrors';
import { useCommunityCohorts } from '../../hooks/useCommunity';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { featureFlags } from '../../config/featureFlags';
import { forestPop as fp, radius, spacing, typography } from '../../theme/tokens';

type Params = { CommunitySpaceChat: { cohortId: string; messageId?: string } };
type Item =
  | { type: 'msg'; key: string; m: SpaceMessage }
  | { type: 'local'; key: string; r: PendingRow }
  | { type: 'day'; key: string; label: string }
  | { type: 'new'; key: string };

const drawable = (m: SpaceMessage) =>
  !m.deleted && (m.kind === 'voice' ? featureFlags.communityVoiceNotes && !!m.voice_note : m.kind === 'text' && !!m.body);

export default function CommunitySpaceChatScreen(): React.ReactElement {
  const navigation = useNavigation();
  const { cohortId, messageId } = useRoute<RouteProp<Params, 'CommunitySpaceChat'>>().params;
  const client = useCurrentUser();
  const { isOnline } = useNetworkStatus();
  const cohorts = useCommunityCohorts();
  const cohort = cohorts.data?.cohorts.find((c) => c.id === cohortId);
  const chat = useSpaceChat(cohortId, client?.id ?? null, isOnline);
  const isCoachViewer = cohort?.my_role === 'coach' || cohort?.my_role === 'owner';
  const coachOnly = cohort?.kind === 'announcement' || (cohort as { posting_policy?: string } | undefined)?.posting_policy === 'coach';
  const canPost = !!cohort && !chat.noAccess && (isCoachViewer || !coachOnly);

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
      const d = dayB(row.at);
      if (d !== day) { day = d; out.push({ type: 'day', key: `day-${row.at}`, label: d }); }
      if (lastRead && !newDrawn && !row.mine && row.item.type === 'msg' && row.at > lastRead) {
        newDrawn = true;
        out.push({ type: 'new', key: 'new-line' });
      }
      out.push(row.item);
    }
    return out.reverse();
  }, [chat.messages, chat.pending, chat.readCursor, client?.id]);

  // Open at the message asked for, else at the New messages line (once per visit).
  const listRef = useRef<FlatList<Item>>(null);
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || items.length === 0) return;
    const index = items.findIndex((i) => (messageId ? i.key === messageId : i.type === 'new'));
    jumped.current = true;
    if (index > 0) requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }));
  }, [items, messageId]);

  // The pill: new rows from others while you read older ones; tap goes to the bottom.
  const [away, setAway] = useState(false);
  const [pill, setPill] = useState(false);
  const newest = chat.messages.find(drawable);
  const seenNewest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!newest || newest.id === seenNewest.current) return;
    const first = seenNewest.current === undefined;
    seenNewest.current = newest.id;
    if (!first && away && newest.sender_user_id !== client?.id) setPill(true);
  }, [newest, away, client?.id]);
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!newest || away || marked.current === newest.id) return;
    marked.current = newest.id;
    chat.markRead(newest.id);
  }, [newest, away, chat]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const isAway = e.nativeEvent.contentOffset.y > 240;
    setAway(isAway);
    if (!isAway) setPill(false);
  }, []);

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item.type === 'day') return <StyleBDayMark label={item.label} />;
    if (item.type === 'new') return <NewMessagesLine />;
    if (item.type === 'local') {
      const r = item.r;
      return (
        <SpaceChatRow
          id={r.localId} name={myName} isCoach={isCoachViewer} createdAt={r.createdAt} body={r.body}
          authorId={client?.id ?? ''} state={r.state} onRetry={() => chat.retry(r)} viewerUserId={client?.id}
          offline={!isOnline}
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
  const failure = chat.list.isError && !chat.noAccess && items.length === 0
    ? describeCommunityFailure(chat.list.error, 'load_space') : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']} testID="space-chat-screen">
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back" style={s.icon} testID="space-chat-back">
          <Ionicons name="chevron-back" size={24} color={fp.onDeep} />
        </TouchableOpacity>
        <View style={s.titles} accessible accessibilityRole="header">
          <Text style={s.title} numberOfLines={1}>{cohort ? `# ${cohort.name}` : ' '}</Text>
          {cohort ? <Text style={s.sub}>{`${cohort.member_count} members`}</Text> : null}
        </View>
      </View>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {chat.noAccess ? <View style={s.flex} /> : loading && items.length === 0 ? (
          <View style={s.center}><ActivityIndicator color={fp.n700} /></View>
        ) : failure ? (
          <View style={s.center} testID="space-chat-error">
            <Ionicons name={isOnline ? 'alert-circle-outline' : 'cloud-offline-outline'} size={28} color={fp.n700} />
            <Text style={s.muted}>{failure.message}</Text>
            <TouchableOpacity onPress={() => chat.list.refetch()} accessibilityRole="button" accessibilityLabel="Try again" style={s.retry} testID="space-chat-reload">
              <Text style={s.retryLabel}>Try again</Text>
            </TouchableOpacity>
          </View>
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
            onScroll={onScroll}
            scrollEventThrottle={100}
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
          <Text style={s.line} testID="space-chat-no-access">You can&apos;t see or send messages in this space.</Text>
        ) : canPost ? (
          <ComposerInput
            placeholder="Type a message..."
            maxLength={SPACE_MESSAGE_MAX}
            onSubmit={chat.send}
            draftKey={`space:${cohortId}`}
            testID="space-chat-composer"
          />
        ) : cohort ? (
          <Text style={s.line} testID="space-chat-hint">Only your coach posts here. Press and hold a message to reply.</Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: fp.deep },
  flex: { flex: 1, backgroundColor: fp.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, backgroundColor: fp.deep },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0 },
  title: { ...typography.h4, color: fp.onDeep },
  sub: { ...typography.bodySmall, color: fp.onDeepMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  muted: { ...typography.body, color: fp.n700, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.button, borderWidth: 1, borderColor: fp.deep },
  retryLabel: { ...typography.bodyMd, color: fp.deep },
  stream: { paddingVertical: spacing.sm },
  pill: {
    position: 'absolute', alignSelf: 'center', bottom: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.chip, backgroundColor: fp.deep,
  },
  pillText: { ...typography.bodyMd, color: fp.onDeep },
  line: { ...typography.bodySmall, color: fp.n700, textAlign: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.n700 },
});
