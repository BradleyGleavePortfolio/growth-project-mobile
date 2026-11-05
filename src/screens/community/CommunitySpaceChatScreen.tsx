/**
 * SC-M1 (agent 168, owner #167-3 / #167-5 / #167-6 op 1), FX-871 (agent 169): the space chat. One Slack / iMessage-style
 * stream per space, newest at the bottom, for members and the coach. Registered only behind `communitySpaceChat` (off by
 * default); with the flag off SpaceTree and the coach space list open today's screens.
 *   - Header (mockup VOICE-B 05b): the space list on the left (members: the space drawer; the coach: the coach's space
 *     list), `# name` and the member count, and the info button: the coach's opens the space's page (members, invites,
 *     removals); a member's opens a read-only sheet with the space's name, member count, purpose and people
 *     (SpaceInfoSheet: FR-871R6 Opus B1, FR-871R7 Sol B871-1).
 *   - Rows: Studio rows (SpaceChatRow), day lines (Style B's day format), voice rows when communityVoiceNotes is on.
 *   - Composer: SpaceChatComposer (pill field, slots for SC-M4's "+" and SC-M2's mic), shown only once the server let
 *     this person in on this visit (useServerAnswered: a page restored from the saved cache at a cold start does not
 *     count, FR-871R6 Opus B3), so a banned member never gets a box to type in (owner 10-22 ban ruling).
 *   - Announcements (a coach-posting space): members get no composer, only "Only your coach posts here."; the coach
 *     posts as usual. A member who chooses Reply on the coach's post gets the field until the reply is sent or cancelled.
 *   - SC-M3 (agent 184, owner #167-5 TEXT-REPLIES): press and hold a row for the sheet (Reply, Copy; SpaceMessageSheet).
 *     Reply puts ReplyComposer above the field (no mic while it is set) and the text goes with parent_message_id; a
 *     reply draws its quote (SpaceReplyQuote), which scrolls to the message when it is loaded here. Report, Block and
 *     Delete stay on the row's own ••• (SafetyMenu, unchanged).
 *     FR-909: reply mode and the sheet follow the message (useSpaceChat): a removal, a delete, a block or a closed space
 *     ends reply mode and closes the sheet, Copy reads the message as it is when it runs, and a member's reply refused
 *     for its words in Announcements keeps the field until it is back in it (LO-909 B2).
 *   - No access (the server answers a read or a send with 404 or 403: not a member, or banned): no space content and no
 *     composer, one line where the composer was: "This conversation is closed" (BAM-1, owner #169-5).
 *   - "New messages" line and pill from SC-BE2's read cursor; both hidden while the server has no read route. The page
 *     opens there (or at the message asked for), loading older pages until that row is loaded (FR-871 Sol B1), once the
 *     cursor has answered. Read marks and the pill follow what is on screen (FlatList viewability), not a scroll
 *     distance: the newest row seen is marked, only while the page is in front and after it has opened in place. A row
 *     counts as seen when most of it is on screen, or when it fills most of the screen (a message taller than the
 *     screen; FR-871R5, m#871 Sol B2). Opening in place tries the row again until the rows around it have measured
 *     (FR-871R5, m#871 Opus B1 / Sol B1).
 *   - A row the coach removed (b#1165: deleted with removed_by) keeps its place as one quiet line (REMOVED-BY-M2, owner
 *     #174-4); an author's own delete still vanishes. Only live rows count for the read mark, the New messages line and
 *     the pill: the server counts unread without deleted rows and will not take one as the read mark.
 *   - Offline: no line about it; a voice note waiting on the phone says so in its card (owner 10-20 12:25, FR-871R5).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from '@react-navigation/native';
import { SpaceListButton } from '../../components/community/SpaceDrawer';
import SpaceChatComposer from '../../components/community/space-chat/SpaceChatComposer';
import SpaceChatMic from '../../components/community/space-chat/SpaceChatMic';
import SpaceInfoSheet from '../../components/community/space-chat/SpaceInfoSheet';
import SpaceMessageSheet from '../../components/community/space-chat/SpaceMessageSheet';
import { firstLine, quoteOf, quoteOfTarget, voiceLine } from '../../components/community/space-chat/SpaceReplyQuote';
import type { SpaceReplyTarget } from '../../components/community/space-chat/spaceChatOutbox';
import * as Clipboard from 'expo-clipboard';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useSpaceVoiceOutbox } from '../../components/community/space-chat/useSpaceVoiceOutbox';
import type { VoiceOutboxItem } from '../../hooks/useVoiceOutbox';
import SpaceChatRow, { DayLine, HashGlyph, MenuGlyph, NewMessagesLine, SMALL_GREY, spaceDay } from '../../components/community/space-chat/SpaceChatRow';
import { isCoachRemoved, spaceRemovedLine } from '../../components/community/space-chat/removed/SpaceRemovedPlaceholder';
import { useSpaceChat, type PendingRow } from '../../components/community/space-chat/useSpaceChat';
import { type SpaceMessage } from '../../components/community/space-chat/spaceChatApi';
import { useServerAnswered } from '../../components/messaging/ConversationClosed';
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
  | { type: 'voice'; key: string; v: VoiceOutboxItem; at: string }
  | { type: 'day'; key: string; label: string }
  | { type: 'new'; key: string };

// The kinds this page draws; a coach's removal draws in place whatever the kind (the removal rule reads none).
const kindDrawn = (m: SpaceMessage) => (m.kind === 'voice' ? featureFlags.communityVoiceNotes : m.kind === 'text');
const live = (m: SpaceMessage) =>
  kindDrawn(m) && !m.deleted && (m.kind === 'voice' ? !!m.voice_note : !!m.body);
const drawable = (m: SpaceMessage) => live(m) || (kindDrawn(m) && isCoachRemoved(m));

export default function CommunitySpaceChatScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { cohortId, messageId } = useRoute<RouteProp<Params, 'CommunitySpaceChat'>>().params;
  // The coach's stack has the space's member page; the member stack has the space drawer.
  const coachStack = !!navigation.getState?.()?.routeNames?.includes('CoachCommunityCohortDetail');
  // A removed row's author gets a link to Community safety where that page is on the stack (the member side).
  const safetyRoute = !!navigation.getState?.()?.routeNames?.includes('CommunitySafety');
  const client = useCurrentUser();
  const isOnline = isEffectivelyOnline(useNetworkStatus());
  const focused = useIsFocused();
  const cohorts = useCommunityCohorts();
  const cohort = cohorts.data?.cohorts.find((c) => c.id === cohortId);
  const chat = useSpaceChat(cohortId, client?.id ?? null, isOnline, focused);
  const isCoachViewer = cohort?.my_role === 'coach' || cohort?.my_role === 'owner';
  const coachOnly = cohort?.kind === 'announcement' || (cohort as { posting_policy?: string } | undefined)?.posting_policy === 'coach';
  // Only once the server has let this person in on this visit (no 404 / 403): never while loading, never on a page
  // restored from the saved cache at a cold start (online until the read answers, or offline), FR-871R6 Opus B3.
  const answered = useServerAnswered(chat.list);
  const admitted = !!cohort && answered && !chat.noAccess;
  const canPost = admitted && (isCoachViewer || !coachOnly);
  // SC-M2: voice notes into this space (m#848's outbox, sent with this space's id) while communityVoiceNotes is on.
  const voiceOn = featureFlags.communityVoiceNotes && !!cohort?.workspace_id && !!client?.id;
  const voice = useSpaceVoiceOutbox(voiceOn ? cohort?.workspace_id ?? null : null, client?.id ?? null, cohortId);

  const myName = useMemo(() => chat.messages.find((m) => m.sender_user_id === client?.id)?.sender?.name
    ?? client?.name ?? [client?.firstName, client?.lastName].filter(Boolean).join(' '), [chat.messages, client]);

  // Oldest -> newest with day lines and the New messages line, then reversed for the inverted list.
  const items = useMemo(() => {
    const rows: Array<{ at: string; item: Item; mine: boolean }> = [
      ...chat.messages.filter(drawable).map((m) => ({ at: m.created_at, item: { type: 'msg', key: m.id, m } as Item, mine: m.sender_user_id === client?.id })),
      ...chat.pending.filter((r) => r.state !== 'sent' || !chat.messages.some((m) => m.id === r.serverId))
        .map((r) => ({ at: r.createdAt, item: { type: 'local', key: r.localId, r } as Item, mine: true })),
      ...voice.rows.map(({ v, at }) => ({ at, item: { type: 'voice', key: v.id, v, at } as Item, mine: true })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const lastRead = chat.readCursor?.last_read_at ?? null;
    const out: Item[] = [];
    let day = '';
    let newDrawn = false;
    for (const row of rows) {
      const d = spaceDay(row.at);
      if (d !== day) { day = d; out.push({ type: 'day', key: `day-${row.at}`, label: d }); }
      if (lastRead && !newDrawn && !row.mine && row.item.type === 'msg' && live(row.item.m) && row.at > lastRead) {
        newDrawn = true;
        out.push({ type: 'new', key: 'new-line' });
      }
      out.push(row.item);
    }
    return out.reverse();
  }, [chat.messages, chat.pending, chat.readCursor, client?.id, voice.rows]);

  // Open at the message asked for, else at the New messages line, once per visit after the read cursor has answered.
  // Older pages load first until that row is loaded (the asked-for row, or the oldest unread one) or there are none.
  const listRef = useRef<FlatList<Item>>(null);
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [placed, setPlaced] = useState(false);
  const [seenRows, setSeenRows] = useState<ReadonlySet<string>>(() => new Set());
  const [seenTall, setSeenTall] = useState<ReadonlySet<string>>(() => new Set());
  const seen = useMemo(() => new Set([...seenRows, ...seenTall]), [seenRows, seenTall]);
  const viewPairs = useRef([setSeenRows, setSeenTall].map((set, i) => ({
    viewabilityConfig: VIEWABLE[i],
    onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => set(new Set(viewableItems.map((v) => v.key))),
  }))).current;
  // The row to open at, tried again (a few frames at most) while the rows around it have not measured yet.
  const tries = useRef(0);
  const placedRef = useRef(false);
  placedRef.current = placed;
  const toRow = useCallback((index: number) => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), []);
  // SC-M3: the row a quote scrolls to, while that scroll is on its way.
  const jumping = useRef<number | null>(null);
  const onPlaceFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    // SC-M3: a quote's message far off screen: once more, once the guess has brought its rows in.
    if (jumping.current === info.index) {
      jumping.current = null;
      setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 100);
      return;
    }
    if (tries.current >= 5) return;
    tries.current += 1;
    setTimeout(() => { if (!placedRef.current) toRow(info.index); }, 50);
  }, [toRow]);
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
    if (index > 0) requestAnimationFrame(() => toRow(index));
  }, [items, messageId, target, chat.readSettled, chat.readCursor, chat.messages, chat.list, toRow]);
  // In place once the row it opened at is on screen (or the person scrolls); only then do read marks count.
  useEffect(() => { if (!placed && (target === null || (!!target && seen.has(target)))) setPlaced(true); }, [placed, target, seen]);

  // The pill: someone else posts while the row that was newest is off screen; it goes once the newest row is seen.
  const [pill, setPill] = useState(false);
  const newest = chat.messages.find(live);
  const prevNewest = useRef<{ id: string; at: string } | undefined>(undefined);
  useEffect(() => {
    if (!newest || newest.id === prevNewest.current?.id) return;
    const prev = prevNewest.current;
    prevNewest.current = { id: newest.id, at: newest.created_at };
    // Only a newer row: a removal that leaves an older row newest is not a new message.
    if (prev !== undefined && newest.created_at > prev.at && !seen.has(prev.id) && newest.sender_user_id !== client?.id) setPill(true);
  }, [newest, seen, client?.id]);
  useEffect(() => { if (newest && seen.has(newest.id)) setPill(false); }, [newest, seen]);
  // Read up to the newest row actually on screen; a failed mark is tried again with the next one seen.
  const newestSeen = placed && focused ? chat.messages.find((m) => live(m) && seen.has(m.id)) : undefined;
  const marked = useRef('');
  useEffect(() => {
    if (!newestSeen || newestSeen.created_at <= (marked.current || chat.readCursor?.last_read_at || '')) return;
    const before = marked.current;
    marked.current = newestSeen.created_at;
    void chat.markRead(newestSeen.id).then((ok) => { if (!ok && marked.current === newestSeen.created_at) marked.current = before; });
  }, [newestSeen, chat]);

  // SC-M3: the row whose sheet is open and the message a reply answers (reply mode; both kept by useSpaceChat, FR-909),
  // the row a quote just scrolled to.
  const { reply, setReply, held, setHeld } = chat;
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    if (!lit) return undefined;
    const t = setTimeout(() => setLit(null), 1500);
    return () => clearTimeout(t);
  }, [lit]);
  // What Reply answers: the row, or on a reply the first message of its thread (the server keeps one level, as a Slack
  // thread does). None where the server would refuse it: a message gone, a space this person is not let into, and in a
  // space only the coach posts in, a member's own top-level row (members answer the coach's posts there).
  // FR-909: with who wrote it and when, so a block or a removal ends reply mode.
  const replyTo = useCallback((m: SpaceMessage): SpaceReplyTarget | null => {
    if (!admitted || m.deleted) return null;
    if (m.parent || m.parent_message_id) {
      const q = quoteOf(m.parent ?? null);
      const root = m.parent ? chat.messages.find((x) => x.id === m.parent?.id) : undefined;
      return m.parent && q && !q.gone
        ? { id: m.parent.id, authorLabel: q.name, body: q.text, authorId: root?.sender_user_id, at: root?.created_at } : null;
    }
    if (coachOnly && !isCoachViewer && !m.sender?.is_coach) return null;
    const body = m.kind === 'voice' ? voiceLine(m.voice_note?.duration_ms ?? 0) : firstLine(m.body);
    return { id: m.id, authorLabel: m.sender?.name ?? '', body, authorId: m.sender_user_id, at: m.created_at };
  }, [admitted, coachOnly, isCoachViewer, chat.messages]);
  const { readable } = chat;
  const copyOf = useCallback((m: SpaceMessage) => (m.kind === 'text' && m.body && !m.deleted ? () => {
    const body = readable(m.id)?.body;
    if (body) void Clipboard.setStringAsync(body).then(() => HapticService.success(), () => undefined);
  } : undefined), [readable]);
  const loaded = useMemo(() => new Set(items.map((i) => i.key)), [items]);
  const jump = useCallback((id: string) => {
    const index = items.findIndex((i) => i.key === id);
    if (index < 0) return;
    jumping.current = index;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setLit(id);
  }, [items]);

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item.type === 'day') return <DayLine label={item.label} />;
    if (item.type === 'new') return <NewMessagesLine />;
    if (item.type === 'local') {
      const r = item.r;
      return (
        <SpaceChatRow
          id={r.localId} name={myName} isCoach={isCoachViewer} createdAt={r.createdAt} body={r.body}
          authorId={client?.id ?? ''} state={r.state} onRetry={() => chat.retry(r)} onDiscard={() => chat.removeLocal(r.localId)}
          viewerUserId={client?.id} offline={!isOnline} rejected={r.reason === 'rejected'}
          quote={r.reply ? quoteOfTarget(r.reply) : null}
        />
      );
    }
    if (item.type === 'voice') {
      const v = item.v;
      return (
        <SpaceChatRow
          id={v.id} name={myName} isCoach={isCoachViewer} createdAt={item.at} body={null}
          voice={{ id: v.id, duration_ms: v.input.durationMs, waveform_peaks: v.peaks }} localUri={v.input.uri}
          authorId={client?.id ?? ''} state={v.status} onRetry={() => voice.retry(v.id)} onDiscard={() => voice.discard(v.id)}
          viewerUserId={client?.id} offline={!isOnline}
        />
      );
    }
    const m = item.m;
    const answer = replyTo(m);
    const copy = copyOf(m);
    const parentId = m.parent && !m.parent.gone && loaded.has(m.parent.id) ? m.parent.id : null;
    return (
      <SpaceChatRow
        id={m.id} name={m.sender?.name ?? ''} avatarUrl={m.sender?.avatar_url} isCoach={!!m.sender?.is_coach}
        createdAt={m.created_at} body={m.body} voice={m.voice_note} authorId={m.sender_user_id}
        viewerUserId={client?.id} viewerCoachId={client?.coach_id} offline={!isOnline}
        onDelete={() => chat.remove(m.id, m.voice_note?.id)} onBlocked={chat.dropAuthor}
        onRemove={isCoachViewer ? () => chat.removeForEveryone(m.id, m.voice_note?.id) : undefined}
        removed={spaceRemovedLine(m, client?.id)} onSafety={safetyRoute ? () => navigation.navigate('CommunitySafety') : undefined}
        quote={quoteOf(m.parent ?? null)} onQuote={parentId ? () => jump(parentId) : undefined}
        onHold={answer || copy ? () => { Keyboard.dismiss(); setHeld(m.id); } : undefined}
        onReply={answer ? () => setReply(answer) : undefined} onCopy={copy} held={held?.id === m.id || lit === m.id}
      />
    );
  }, [chat, client, isCoachViewer, isOnline, myName, voice, navigation, safetyRoute, replyTo, copyOf, loaded, jump, held, lit, setHeld, setReply]);

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
  const [info, setInfo] = useState(false);
  const heldNow = held && live(held) ? held : undefined;
  const heldReply = heldNow ? replyTo(heldNow) : null;
  // LO-909 B2: a member's reply refused for its words keeps the field (Announcements) until it is back in it.
  const refusedReply = chat.pending.some((r) => r.state === 'failed' && r.reason === 'rejected' && !!r.reply && !r.reply.gone);
  // FR-871R6 (m#879 Opus B1 / Sol B879-1): the member's tab bar steps aside here (ClientNavigator), so the dock and its
  // lines keep clear of the home indicator / Android navigation bar themselves, in their own colour; with the keyboard
  // up the dock sits on the keyboard (no double gap). The coach's tab bar steps aside too (CoachNavigator, FIN-871R6 m#879 B2).
  const insets = useSafeAreaInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const up = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const down = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => { up.remove(); down.remove(); };
  }, []);
  const dockInset = keyboardUp ? 0 : insets.bottom;
  const lineInset = dockInset ? { paddingBottom: spacing.lg + dockInset } : null;

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
          {cohort ? (
            <TouchableOpacity
              onPress={() => {
                if (coachStack) { navigation.navigate('CoachCommunityCohortDetail', { cohortId, cohortName: cohort.name }); return; }
                Keyboard.dismiss(); // FR-897 (LO-897 C1): the sheet never opens under the keyboard
                setInfo(true);
              }}
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
            viewabilityConfigCallbackPairs={viewPairs}
            onScrollBeginDrag={() => setPlaced(true)}
            keyboardShouldPersistTaps="handled"
            onEndReached={() => { if (chat.list.hasNextPage && !chat.list.isFetchingNextPage) void chat.list.fetchNextPage(); }}
            onEndReachedThreshold={0.4}
            onScrollToIndexFailed={onPlaceFailed}
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
          <Text style={[s.line, lineInset]} testID="space-chat-no-access">This conversation is closed</Text>
        ) : canPost || (admitted && (reply || refusedReply)) ? (
          // SC-M3: a member answering the coach in a space only the coach posts in gets the field while the reply is set.
          // No mic in reply mode: a voice reply is SC-M3 part 2 (after BPF-1-M).
          <SpaceChatComposer
            cohortId={cohortId}
            onSend={(body) => { chat.send(body, reply ?? undefined); setReply(null); }}
            bottomInset={dockInset}
            reply={reply}
            onReply={setReply}
            trailing={voiceOn && !reply ? <SpaceChatMic cohortName={cohort?.name ?? ''} userId={client?.id ?? ''} coach={isCoachViewer} onSend={voice.send} /> : undefined}
          />
        ) : admitted ? (
          <Text style={[s.line, lineInset]} testID="space-chat-hint">Only your coach posts here.</Text>
        ) : null}
      </KeyboardAvoidingView>
      {info && cohort && !coachStack ? (
        <SpaceInfoSheet cohortId={cohortId} name={cohort.name} members={members} description={cohort.description} viewerId={client?.id}
          people={chat.noAccess ? 'closed' : admitted ? 'open' : chat.list.isError ? 'failed' : 'wait'}
          error={chat.list.error} onRetry={reload} retrying={chat.list.isFetching} offline={!isOnline} onClose={() => setInfo(false)} />
      ) : null}
      {heldNow ? (
        <SpaceMessageSheet onClose={() => setHeld(null)} onCopy={copyOf(heldNow)}
          onReply={heldReply ? () => setReply(heldReply) : undefined} />
      ) : null}
    </SafeAreaView>
  );
}

/** Seen: most of the row is on screen, or the row fills most of the screen (one taller than the screen). */
const VIEWABLE = [{ itemVisiblePercentThreshold: 60 }, { viewAreaCoveragePercentThreshold: 60 }];
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
