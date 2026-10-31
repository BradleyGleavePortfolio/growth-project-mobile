/**
 * KT-2, the phone half (planning/KNOWN_TRAPS.md, trap KT-2: "a blocked, banned, removed or departed person leaks through
 * a new read, list, search, preview, count, push or composer"). One shared contract test: every phone screen or
 * component that shows member content (posts, comments, messages, voice notes, photos, inbox and search rows, previews,
 * unread counts) or holds a composer (typed text, voice, photo, reactions) is a row in REGISTRY below, with how it
 * applies a block (both ways), a ban, a removal, a departure and a closed conversation, and the test that proves it.
 *
 * What makes a file a surface (the inventory scan, src/ without tests):
 *   composer  COMPOSER_SIGNS: a composer part (<ComposerInput, <ReplyComposer, <ReactionBar, <VoiceNotesSection,
 *             <VoiceRecordSheet, <VoiceNoteComposer), a member-content send (useSendDm, useCreatePost, useAddComment,
 *             useReactToPost, useVoiceUpload, useVoiceOutbox, useMessageOutbox, communityApi createPost / addComment /
 *             reactToPost / sendDm / openDmThread / postWin, communityWinsApi.postWin, messagingV2Api sendMessage / editMessage, sendReply,
 *             messagesApi.send, coachApi sendClientMessage / sendNudge, communityVoiceApi create / issueUploadUrl /
 *             uploadBytes, communityChallengesApi.addComment, broadcastsApi.create, api.post('/messages')), or a
 *             <TextInput in a community or messaging folder or in a file named for messages, inboxes, chats, threads,
 *             DMs, comments, voice, posts, replies or broadcasts.
 *   list      LIST_SIGNS: a member-content read (usePosts, usePostComments, useDmThreads, useDmMessages,
 *             useCommunityToday, useCommunityBadge, useVoiceFeed, useVoiceCatchUp, useCommunitySearch, useThreadV2,
 *             useCoachInbox, useCoachPostDetail, useCoachFlagged, useClientUnreadCount, useInboxTriage, the matching
 *             communityApi / messagingV2Api / communityVoiceApi / communityChallengesApi / communitySearchApi /
 *             coachCommunityApi reads, messagesApi list / unreadCount, coachApi getClientMessages / getUnreadCounts,
 *             fetchNotifications / fetchUnreadCount, communityApi.getFeed, api.get('/messages' or a client's messages)).
 *
 * WHEN THIS GOES RED (say which one in your PR):
 *   - "not in the KT-2 registry": you added a composer or a content list. Make it apply the rules (a composer draws
 *     nothing typeable unless useConversationClosed says open, ConversationClosedLine in its place; a list drops a
 *     blocked person's rows, previews and counts at once through src/lib/blockSync.ts or a useBlockedUsersStore
 *     filter), then register it in REGISTRY with a proof. If it cannot apply a rule yet, ask the operator for a
 *     KNOWN GAP row. Never add a KNOWN GAP row or an EXEMPT row yourself to make this pass.
 *   - a behavior case failed: a registered surface stopped applying a rule. Apply the rule again; never loosen the case.
 *   - "KNOWN GAP ... now holds": you fixed a known gap. Delete its KNOWN GAP row so the rule is enforced from now on.
 *   - "stale row": a registered file moved, or no longer reads or sends member content. Update or remove the row.
 * The composers are drawn in memberContentAccess.composers.test.tsx (the same registry rows, by file).
 * Space chat (m#871, m#879, m#887, m#897) is not on main: its composers and lists join REGISTRY when it merges.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../theme/tokens').lightTokens }),
}));
const mockCounts = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), delete: jest.fn(async () => ({ data: {} })), get: jest.fn() },
  coachApi: { getUnreadCounts: () => mockCounts() },
}));
jest.mock('../services/realtime', () => ({ subscribeToMessages: () => () => undefined, onRealtimeAuthRefresh: () => () => undefined }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: false } }) }));
jest.mock('../screens/coach/broadcasts/BroadcastsEntry', () => ({ BroadcastsEntry: () => null }));
jest.mock('../screens/coach/CommunityReportsEntry', () => ({ CommunityReportsEntry: () => null }));
jest.mock('../screens/coach/CommunityEntry', () => ({ CommunityEntry: () => null }));
const mockClients = [{ id: 'client-blocked', firstName: 'Ana', lastName: 'Ruiz', status: 'active' }, { id: 'client-2', firstName: 'Ben', lastName: 'Ode', status: 'active' }];
jest.mock('../store/coachStore', () => ({ useCoachStore: () => ({ clients: mockClients, loadClients: async () => undefined }) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { registerBlockSyncClient } = require('../lib/blockSync');
const { messagesModerationApi } = require('../api/messagesApi');
const { useBlockedUsersStore } = require('../store/blockedUsersStore');
const { communityKeys } = require('../hooks/useCommunity');
const { voiceKeys } = require('../hooks/voiceQueryKeys');
const { communitySearchKeys } = require('../hooks/useCommunitySearch');
const { coachCommunityKeys } = require('../hooks/useCoachCommunity');
/* eslint-enable @typescript-eslint/no-var-requires */

const SRC = path.resolve(__dirname, '..');
const COMPOSERS_TEST = path.join(__dirname, 'memberContentAccess.composers.test.tsx');

// ─── The registry ────────────────────────────────────────────────────────────────────────────────────────────────

type Kind = 'composer' | 'list';
/** How the rules are proved. Every proof is a test in the mobile suite that runs on every push. */
type Proof =
  /** Drawn in memberContentAccess.composers.test.tsx for each closed state (that file's HOSTS, keyed by `file`). */
  | { by: 'composers' }
  /** CACHE_CASES below: the list's cache already holds a blocked person's rows, then a block is made elsewhere. */
  | { by: 'cache'; id: string }
  /** A part drawn only inside a registered host, which proves the rule for it. */
  | { by: 'host'; host: string }
  /** An existing test in the suite (file under src/, exact test titles). This test fails if one is gone. */
  | { by: 'suite'; file: string; titles: string[] }
  /** STATE_CASES below: lists kept in screen state, drawn, or (where a draw needs the whole navigator) read in the source. */
  | { by: 'state'; id: string };

/** where = file:function that misses the rule; shows = a CACHE_CASES id (run as it.failing) or a source check. */
type KnownGap = { where: string; rule: string; why: string; shows: { cache: string } | { lacks: RegExp } };
/** file under src/; what it shows or sends; how it applies a block (mine / theirs), a ban, a removal, a departure, a
 * closed conversation and the cache after a block; the proof. */
type Surface = { file: string; kind: Kind; what: string; how: string; proof: Proof | { by: 'gap'; gap: KnownGap } };

const CLIENT_THREAD = 'screens/client/__tests__/MessagesScreenV2.test.tsx';
const COACH_THREAD = 'screens/coach/__tests__/ClientMessagesScreenV2.test.tsx';
const gap = (where: string, rule: string, why: string, shows: KnownGap['shows']): Surface['proof'] => ({ by: 'gap', gap: { where, rule, why, shows } });
/** blockSync.blockPlaced filters only the DM list and the coach inbox: every other cached list keeps the rows. */
const cacheGap = (key: string, cache: string, why: string) => gap(`lib/blockSync.ts:blockPlaced (${key})`, 'block (cache after a block)', why, { cache });

const REGISTRY: Surface[] = [
  // ── Composers ──
  { file: 'screens/community/CommunityDmThreadScreen.tsx', kind: 'composer', what: 'a member DM: typed text (ComposerInput -> useSendDm)',
    how: 'useConversationClosed(recipient, [thread read, send]) + ConversationClosedLine; my block from the block store, theirs and a ban or departure from the read refusal (community.dm.blocked_by_them / dm.not_found / workspace.no_access); nothing editable before the read answers (useServerAnswered)',
    proof: { by: 'composers' } },
  { file: 'screens/community/CommunityComposerScreen.tsx', kind: 'composer', what: 'a new post in a space, or a first message to my coach (TextInput -> useCreatePost / useSendDm)',
    how: 'useConversationClosed(dm recipient or null, [posts or dm read, send]); ready = useServerAnswered(gate read) && workspace; closed draws the line and no field',
    proof: { by: 'composers' } },
  { file: 'screens/community/CommunityThreadScreen.tsx', kind: 'composer', what: 'a reply to a post (ComposerInput -> useAddComment) and reactions (useReactToPost)',
    how: 'useConversationClosed(null, [post read, comments read, reply]); a post gone behind a block (post.not_found), a ban or a departure closes it and draws none of the post\'s words; a block of the post author is a list rule (the author\'s rows)',
    proof: { by: 'composers' } },
  { file: 'screens/community/CommunitySpaceScreen.tsx', kind: 'composer', what: '"New post" entry and the voice note record entry (VoiceNotesSection)',
    how: 'useConversationClosed(null, [posts read]); a ban or departure (workspace.no_access) draws the closed line and neither entry; a one-to-one block does not close a space',
    proof: { by: 'composers' } },
  { file: 'screens/community/CommunityChallengeDetailScreen.tsx', kind: 'composer', what: 'challenge notes (ComposerInput -> addComment) and progress (ChallengeProgressSheet)',
    how: 'useConversationClosed(null, [detail, notes]); a ban, a departure or a challenge gone (challenge.not_found) closes the notes box',
    proof: { by: 'composers' } },
  { file: 'components/community/ComposerInput.tsx', kind: 'composer', what: 'the shared typed-text box of the community composers',
    how: 'drawn only by a host that asked useConversationClosed', proof: { by: 'host', host: 'screens/community/CommunityDmThreadScreen.tsx' } },
  { file: 'components/community/ChallengeProgressSheet.tsx', kind: 'composer', what: 'my challenge progress value',
    how: 'opened only from the challenge screen', proof: { by: 'host', host: 'screens/community/CommunityChallengeDetailScreen.tsx' } },
  { file: 'components/community/VoiceNotesSection.tsx', kind: 'composer', what: 'the voice note record entry of a space',
    how: 'drawn only while the space is open', proof: { by: 'host', host: 'screens/community/CommunitySpaceScreen.tsx' } },
  { file: 'components/community/VoiceRecordSheet.tsx', kind: 'composer', what: 'recording a voice note',
    how: 'opened only from VoiceNotesSection', proof: { by: 'host', host: 'screens/community/CommunitySpaceScreen.tsx' } },
  { file: 'screens/community/CommunityVoiceComposerScreen.tsx', kind: 'composer', what: 'recording and sending a voice note (useVoiceUpload / useVoiceOutbox)',
    how: 'none of its own: it trusts the space that opened it',
    proof: gap('screens/community/CommunityVoiceComposerScreen.tsx:CommunityVoiceComposerScreen', 'ban, departure (a closed space)',
      'it reads nothing that can refuse and asks no closed gate, so a member banned or gone while it is open can still record and press send (the server refuses the upload)',
      { lacks: /useConversationClosed|isClosedRefusal/ }) },
  { file: 'screens/client/MessagesScreen.tsx', kind: 'composer', what: 'the client to coach chat: typed text, replies, edits (ReplyComposer, ThreadV2Parts)',
    how: 'useConversationClosed(coach, [thread, send]) + useCoachingRow (the inbox row\'s closed / blocked_by_me); edit sheet nulled when closed; a refused send is remembered (closedRefusals)',
    proof: { by: 'suite', file: CLIENT_THREAD, titles: [
      'my coach blocked me: the inbox row says closed, so there is never a box and no message text',
      'I blocked my coach: no message box, only the closed line; an unblock opens it again',
      'my coach blocked me (server 403 BLOCKED on send): closed at once, nothing sent twice, no "Not sent" bubble',
      'open: the message box is there and the closed line is not',
    ] } },
  { file: 'screens/coach/ClientMessagesScreen.tsx', kind: 'composer', what: 'the coach to client chat: typed text, edits (ThreadV2Parts)',
    how: 'useConversationClosed(client, [thread, send]) + useCoachingRow; edit sheet nulled when closed',
    proof: { by: 'suite', file: COACH_THREAD, titles: [
      'the client blocked me: the inbox row says closed, so there is never a box',
      'I blocked this client: no message box, only the closed line; an unblock opens it again',
      'the client blocked me (server 403 BLOCKED on send): closed at once, no "Message not sent" box',
      'FR-872 (Sol B5): an edit sheet already open goes when a read says the client blocked me; nothing to save',
      'open: the message box is there and the closed line is not',
    ] } },
  { file: 'components/messaging/ThreadV2Parts.tsx', kind: 'composer', what: 'the edit sheet of a coaching message',
    how: 'opened only by the two coaching chats, which null it when closed', proof: { by: 'host', host: 'screens/coach/ClientMessagesScreen.tsx' } },
  { file: 'screens/client/CommunityScreen.tsx', kind: 'composer', what: 'posting a win (title and description -> communityApi.postWin)',
    how: 'none: the form is drawn whatever the member\'s community access',
    proof: gap('screens/client/CommunityScreen.tsx:CommunityScreen', 'ban, departure',
      'the wins form asks no closed gate, so a banned or departed member can type and send a win (the server decides)',
      { lacks: /useConversationClosed|isClosedRefusal|useBlockedUsersStore/ }) },
  ...([
    ['screens/coach/ClientDetailScreen.tsx', 'ClientDetailScreen:sendNudge', 'a typed nudge (title and body)'],
    ['screens/coach/lookup/useLookupNudge.tsx', 'useLookupNudge', 'a typed nudge from the coach lookup'],
    ['screens/coach/ClientRiskDetailScreen.tsx', 'ClientRiskDetailScreen:sendNudge', 'a fixed check-in nudge'],
  ] as const).map(([file, fn, what]): Surface => ({
    file, kind: 'composer', what: `${what} pushed to a client (coachApi.sendNudge)`, how: 'none: no closed gate before the send',
    proof: gap(`${file}:${fn}`, 'block (both ways), closed conversation',
      'the nudge is offered and sent to a client who blocked the coach, or whom the coach blocked; nothing on the phone asks whether the chat is closed (the server decides)',
      { lacks: /useConversationClosed|useCoachingRow|useCoachChatClosed|closed_client_ids|useBlockedUsersStore/ }),
  })),

  // ── Lists, previews and counts ──
  { file: 'screens/community/CommunityDmListScreen.tsx', kind: 'list', what: 'my DM rows: name, preview, unread',
    how: 'blockSync drops the row from communityKeys.dmThreads at once on my block; the server leaves out theirs, a ban and a departure',
    proof: { by: 'cache', id: 'dm-list' } },
  { file: 'screens/coach/CoachInboxV2.tsx', kind: 'list', what: 'the coach inbox: rows (text, voice, photo previews), unread',
    how: 'blockSync drops the row and its unread from the cached inbox; the screen also hides my blocks, closed_client_ids and closed / blocked_by_me rows',
    proof: { by: 'cache', id: 'coach-inbox' } },
  { file: 'screens/coach/MessagesScreen.tsx', kind: 'list', what: 'the legacy coach list (messaging v2 off): client rows and unread',
    how: 'hides closed_client_ids (blocked either way) and my blocks from the block store at once', proof: { by: 'state', id: 'legacy-coach-list' } },
  { file: 'screens/client/MessagesInboxScreen.tsx', kind: 'list', what: 'the client inbox: the coach card, preview, unread',
    how: 'the coaching row\'s closed / blocked_by_me and my block store hide the card; a block reads the list again',
    proof: { by: 'suite', file: 'screens/client/__tests__/MessagesInboxScreen.test.tsx', titles: [
      'the coach blocked me (the inbox leaves the row out): the card is gone; when the row is back, so is the card',
      'I block my coach: the card leaves at once and the list reads again; my unblock reads again and it comes back',
      'a cold offline list with my saved block never shows the coach; my unblock brings back the offline card',
    ] } },
  { file: 'components/home/HomeHeaderActions.tsx', kind: 'list', what: 'the "Message {coach}" entry and its unread on Home',
    how: 'useCoachChatClosed + my block store; a block reads the count again',
    proof: { by: 'suite', file: 'components/home/__tests__/HomeHeaderActions.test.tsx', titles: ['a block hides the coach entry at once and an unblock brings it back, the count read again'] } },
  { file: 'hooks/useClientUnreadCount.ts', kind: 'list', what: 'the client notice count', how: 're-reads on a block or unblock (subscribes to the block store)',
    proof: { by: 'suite', file: 'hooks/__tests__/useClientUnreadCount.test.tsx', titles: ['a block and an unblock read the count again at once'] } },
  { file: 'hooks/useApi.ts', kind: 'list', what: 'the messages unread badge (useUnreadCount, [\'messages\', \'unread-count\'])',
    how: 'blockSync reads the badge again at once', proof: { by: 'cache', id: 'badge-messages' } },
  { file: 'navigation/ClientNavigator.tsx', kind: 'list', what: 'the Community tab badge (useCommunityBadge, communityKeys.me)',
    how: 'blockSync reads communityKeys.me again at once', proof: { by: 'cache', id: 'badge-community-me' } },
  { file: 'screens/community/CommunityTabScreen.tsx', kind: 'list', what: 'the Community tab badge (useCommunityBadge)',
    how: 'blockSync reads communityKeys.me again at once', proof: { by: 'cache', id: 'badge-community-me' } },
  { file: 'components/community/SpaceTree.tsx', kind: 'list', what: 'the coach row unread in the space tree',
    how: 'blockSync reads [\'community\', \'home\', \'coach-unread\'] again at once', proof: { by: 'cache', id: 'badge-coach-unread' } },
  { file: 'navigation/CoachNavigator.tsx', kind: 'list', what: 'the coach bell count',
    how: 'useCoachNotificationUnreadCount re-reads on a block or unblock (its effect depends on the block store)', proof: { by: 'state', id: 'coach-bell-source' } },
  { file: 'screens/community/CommunityDmThreadScreen.tsx', kind: 'list', what: 'the DM messages',
    how: 'closed draws none of the other person\'s words (closed branch replaces the list)', proof: { by: 'composers' } },
  { file: 'screens/community/CommunityComposerScreen.tsx', kind: 'list', what: 'reads posts or the coach DM only to decide open or closed (draws no member words)',
    how: 'same gate as its composer', proof: { by: 'composers' } },
  { file: 'screens/client/MessagesScreen.tsx', kind: 'list', what: 'the coaching thread messages', how: 'filterOutBlocked over the shown messages; closed draws no message text',
    proof: { by: 'suite', file: CLIENT_THREAD, titles: ['my coach blocked me: the inbox row says closed, so there is never a box and no message text'] } },
  { file: 'screens/coach/ClientMessagesScreen.tsx', kind: 'list', what: 'the coaching thread messages (coach side)', how: 'filterOutBlocked over the messages; closed draws the closed line',
    proof: { by: 'suite', file: COACH_THREAD, titles: ['I blocked this client: no message box, only the closed line; an unblock opens it again'] } },
  { file: 'screens/community/CommunitySpaceScreen.tsx', kind: 'list', what: 'the posts of a space (author, words, reactions)',
    how: 'the server leaves out blocked authors on the next read; a block from a post\'s SafetyMenu invalidates [\'community\']; nothing drops the rows already in the cache',
    proof: cacheGap('communityKeys.posts', 'space-posts', 'a space\'s cached posts keep the blocked author\'s rows until the next read (up to the 30 s staleTime when the block came from a profile or Settings)') },
  { file: 'screens/community/CommunityThreadScreen.tsx', kind: 'list', what: 'a post and its comments',
    how: 'closed (post gone, ban, departure) draws none of the post\'s words; a blocked commenter\'s cached comments are not dropped',
    proof: cacheGap('communityKeys.comments', 'post-comments', 'the cached comments keep a blocked commenter\'s rows until the next read; no block-store filter on comments') },
  { file: 'screens/community/CommunityTodayScreen.tsx', kind: 'list', what: 'today: the pinned post title and author', how: 'server read only',
    proof: cacheGap('communityKeys.today', 'today', 'a pinned post by a person I just blocked stays in the cached today read until the next read') },
  { file: 'screens/community/CommunityFindScreen.tsx', kind: 'list', what: 'community search rows', how: 'server read only; searches are kept in the cache to show again',
    proof: cacheGap('communitySearchKeys', 'search', 'a saved search keeps a blocked author\'s rows in the cache and shows them again') },
  { file: 'components/community/VoiceNotesSection.tsx', kind: 'list', what: 'the voice notes of a space',
    how: 'server read only; removed notes draw "Removed by Coach {name}" from the server\'s removed_by',
    proof: cacheGap('voiceKeys.feedRoot', 'voice-feed', 'the cached voice feed keeps a blocked author\'s notes until the next read') },
  { file: 'screens/community/CommunityVoiceNoteDetail.tsx', kind: 'list', what: 'one voice note page', how: 'server read only',
    proof: cacheGap('voiceKeys.note', 'voice-note', 'the cached note of a person I just blocked still opens and plays from the cache') },
  { file: 'screens/community/CommunityChallengeDetailScreen.tsx', kind: 'list', what: 'challenge notes and the leaderboard',
    how: 'closed (ban, departure, challenge gone) hides the notes; a blocked person\'s cached notes are not dropped',
    proof: cacheGap('[\'community\', \'challenge\', id, \'comments\']', 'challenge-notes', 'cached challenge notes keep a blocked author\'s rows until the next read') },
  { file: 'screens/community/CoachCommunityInboxScreen.tsx', kind: 'list', what: 'the coach community inbox rows',
    how: 'filters my blocks from the block store at render (blockedIds)', proof: { by: 'state', id: 'coach-community-inbox-source' } },
  { file: 'screens/community/CoachCommunityPostDetailScreen.tsx', kind: 'list', what: 'a post and its comments, coach side', how: 'server read only',
    proof: cacheGap('coachCommunityKeys.post', 'coach-post-detail', 'the cached post detail keeps a blocked member\'s words until the next read') },
  { file: 'screens/client/CommunityScreen.tsx', kind: 'list', what: 'the wins feed (other members\' wins)', how: 'kept in screen state; no block filter',
    proof: gap('screens/client/CommunityScreen.tsx:CommunityScreen', 'block (cache after a block), ban', 'the wins feed has no block-store filter, so a person I just blocked keeps their wins on screen until the next read', { lacks: /useBlockedUsersStore|blockedIds/ }) },
  { file: 'screens/notifications/NotificationCenterScreen.tsx', kind: 'list', what: 'notification rows (titles and bodies, which can quote a message)',
    how: 'kept in screen state; rows carry no person id the phone can match to a block',
    proof: gap('screens/notifications/NotificationCenterScreen.tsx:NotificationCenterScreen', 'block (cache after a block)', 'a notice from a person I just blocked stays until the next read; the phone cannot match it to the block', { lacks: /useBlockedUsersStore|blockedIds/ }) },
  { file: 'screens/coach/cross-pillar/CrossPillarMessagesScreen.tsx', kind: 'list', what: 'the coach\'s total unread messages', how: 'read once when opened',
    proof: gap('screens/coach/cross-pillar/CrossPillarMessagesScreen.tsx:load', 'block (count after a block)', 'the total is read once on open and not again on a block, so a just-blocked client\'s unread stays counted until a pull to refresh', { lacks: /useBlockedUsersStore|useFocusEffect|isFocused/ }) },
  { file: 'screens/coach/home-v11/useCoachHomeV11.ts', kind: 'list', what: 'coach home unread counts',
    how: 're-read on focus (a block is made on another screen, so coming back reads again); the server count leaves a closed chat out', proof: { by: 'state', id: 'focus-reread-coach-home' } },
  { file: 'screens/coach/lookup/ClientLookupScreen.tsx', kind: 'list', what: 'unread per client in the coach lookup',
    how: 're-read on focus; the server count leaves a closed chat out', proof: { by: 'state', id: 'focus-reread-lookup' } },
];

/** Files that match a sign but are not a surface: plumbing the registered surfaces call, or no member words. */
const EXEMPT: { file: string; kinds: Kind[]; why: string }[] = [
  { file: 'services/api.ts', kinds: ['composer', 'list'], why: 'wire wrappers; the registered screens call them' },
  { file: 'api/messagesApi.ts', kinds: ['composer'], why: 'wire wrapper (sendReply); block / unblock report to blockSync' },
  { file: 'api/messagingV2Api.ts', kinds: ['list'], why: 'wire wrapper and schema' },
  { file: 'api/coachCommunityApi.ts', kinds: ['list'], why: 'wire wrapper' },
  { file: 'services/messageOutbox.ts', kinds: ['composer'], why: 'sends what a registered chat queued; it draws nothing' },
  { file: 'services/notificationsApi.ts', kinds: ['list'], why: 'wire wrapper' },
  { file: 'hooks/useCommunity.ts', kinds: ['composer', 'list'], why: 'query and send hooks the registered community screens call' },
  { file: 'hooks/useMessageOutbox.ts', kinds: ['composer'], why: 'queue hook of the registered coaching chats' },
  { file: 'hooks/useThreadV2.ts', kinds: ['composer', 'list'], why: 'thread hook of the registered coaching chats' },
  { file: 'hooks/useVoiceOutbox.ts', kinds: ['composer'], why: 'voice queue hook of the registered voice composer' },
  { file: 'hooks/useVoiceUpload.ts', kinds: ['composer'], why: 'voice upload hook of the registered voice composer' },
  { file: 'hooks/useVoiceFeed.ts', kinds: ['list'], why: 'voice read hooks of the registered voice lists' },
  { file: 'hooks/useCommunitySearch.ts', kinds: ['list'], why: 'search hook of the registered search screen' },
  { file: 'hooks/useCoachCommunity.ts', kinds: ['list'], why: 'coach community read hooks of the registered coach screens' },
  { file: 'hooks/useInboxTriage.ts', kinds: ['list'], why: 'triage hook of the registered coach community inbox' },
  { file: 'hooks/useCoachChatClosed.ts', kinds: ['list'], why: 'the closed gate itself (reads only the closed header)' },
  { file: 'hooks/useNotifications.ts', kinds: ['list'], why: 'first payment notice only (money, no member words)' },
  { file: 'components/messaging/ConversationClosed.tsx', kinds: ['list'], why: 'the closed gate itself (reads the coaching row)' },
  { file: 'components/messaging/ReportMessageSheet.tsx', kinds: ['composer'], why: 'a report to the safety team, never to the person' },
  { file: 'components/community/SearchBar.tsx', kinds: ['composer'], why: 'a search field; sends nothing to anyone' },
  { file: 'components/community/SpaceDrawer.tsx', kinds: ['composer'], why: 'a "Jump to a space or person" field; sends nothing' },
  { file: 'screens/coach/CoachInboxV2.tsx', kinds: ['composer'], why: 'its only field searches conversations' },
  { file: 'screens/coach/MessagesScreen.tsx', kinds: ['composer'], why: 'its only field searches clients' },
  { file: 'screens/coach/CoachBookingInboxScreen.tsx', kinds: ['composer'], why: 'a call link for a booking, not a chat' },
  { file: 'screens/coach/broadcasts/BroadcastComposerScreen.tsx', kinds: ['composer'], why: 'one to many: the server picks who gets it (the backend half of KT-2); the coach never types into a member\'s conversation here' },
  { file: 'screens/community/CoachCommunityCohortsScreen.tsx', kinds: ['composer'], why: 'coach admin: a space name' },
  { file: 'screens/community/CoachCommunityCohortDetailScreen.tsx', kinds: ['composer'], why: 'coach admin: invites and members' },
  { file: 'screens/community/CoachCommunityEventsScreen.tsx', kinds: ['composer'], why: 'coach admin: event details' },
  { file: 'screens/settings/RomanChatsConfirmSheet.tsx', kinds: ['composer'], why: 'Roman (the assistant), not a member' },
  { file: 'screens/community/CoachCommunityModerationScreen.tsx', kinds: ['list'], why: 'moderation: the coach must see reported words to remove them (the removal path itself)' },
  { file: 'screens/coach/CommunityReportsEntry.tsx', kinds: ['list'], why: 'moderation: the count of reports waiting' },
];

// ─── The inventory scan ──────────────────────────────────────────────────────────────────────────────────────────

const COMPOSER_SIGNS: RegExp[] = [
  /<(ComposerInput|ReplyComposer|ReactionBar|VoiceNotesSection|VoiceRecordSheet|VoiceNoteComposer)\b/,
  /\b(useSendDm|useCreatePost|useAddComment|useReactToPost|useVoiceUpload|useVoiceOutbox|useMessageOutbox)\(/,
  /\bcommunityApi\.(createPost|addComment|reactToPost|sendDm|openDmThread|postWin)\(/,
  /\bmessagingV2Api\.(sendMessage|editMessage)\(/,
  /\bmessages(Moderation)?Api\.(sendReply|send)\(/,
  /\bcoachApi\.(sendClientMessage|sendNudge)\(/,
  /\bcommunityVoiceApi\.(create|issueUploadUrl|uploadBytes)\(/,
  /\bcommunityChallengesApi\.addComment\(/,
  /\bcommunityWinsApi\.postWin\(/,
  /\bbroadcastsApi\.create\(/,
  /\bapi\.post\(\s*[`'"]\/messages/,
];
/** A plain text box counts as a composer where member words live. */
const MEMBER_PLACE = /(^|\/)(community|messaging)\/|\/[^/]*(Messag|Inbox|Chat|Thread|Dm|Comment|Voice|Post|Reply|Broadcast)[^/]*$/;
const LIST_SIGNS: RegExp[] = [
  /\b(usePosts|usePostComments|useDmThreads|useDmMessages|useCommunityToday|useCommunityBadge|useVoiceFeed|useVoiceCatchUp|useCommunitySearch|useThreadV2|useCoachInbox|useCoachPostDetail|useCoachFlagged|useClientUnreadCount|useInboxTriage)\(/,
  /\bcommunityApi\.(listPosts|getPost|listComments|listDmThreads|listDmMessages|getToday|getFeed)\(/,
  /\bmessagingV2Api\.(getCoachInbox|getClientInbox|listPins)\(/,
  /\bcommunityVoiceApi\.(listFeed|getOne)\(/,
  /\bcommunityChallengesApi\.(listComments|getLeaderboard)\(/,
  /\bcommunitySearchApi\.search\(/,
  /\bcommunityWinsApi\.getFeed\(/,
  /\bcoachCommunityApi\.(getInbox|getCoachPostDetail|getFlagged)\(/,
  /\bmessagesApi\.(list|unreadCount)\(/,
  /\bcoachApi\.(getClientMessages|getUnreadCounts)\(/,
  /\b(fetchNotifications|fetchUnreadCount)\(/,
  /\bapi\.get[^(]*\(\s*[`'"]\/(coach\/)?messages/,
  /\bapi\.get[^(]*\(\s*`\/coach\/clients\/\$\{[^}]+\}\/messages/,
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.name === '__tests__' || e.name === '__mocks__' || e.name === 'node_modules' || /\.(test|spec)\./.test(e.name)) return [];
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [full] : [];
  });
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');

function scan(): { composer: string[]; list: string[] } {
  const out = { composer: [] as string[], list: [] as string[] };
  for (const f of sourceFiles(SRC)) {
    const file = rel(f);
    const text = fs.readFileSync(f, 'utf8');
    if (COMPOSER_SIGNS.some((r) => r.test(text)) || (MEMBER_PLACE.test(file) && /<TextInput\b/.test(text))) out.composer.push(file);
    if (LIST_SIGNS.some((r) => r.test(text))) out.list.push(file);
  }
  return out;
}

const registered = (file: string, kind: Kind) =>
  REGISTRY.some((s) => s.file === file && s.kind === kind) || EXEMPT.some((e) => e.file === file && e.kinds.includes(kind));

describe('KT-2 registry: every content list and composer on the phone is registered', () => {
  const found = scan();
  it.each(['composer', 'list'] as Kind[])('every %s in src/ is in the KT-2 registry', (kind) => {
    const missing = found[kind].filter((file) => !registered(file, kind));
    if (missing.length) {
      throw new Error(
        missing.map((f) => `src/${f} holds a ${kind} of member content and is not in the KT-2 registry ` +
          '(planning/KNOWN_TRAPS.md KT-2: a blocked, banned, removed or departed person leaks through a new read, list, ' +
          'count or composer). Make it apply the rules, then add a REGISTRY row in src/__tests__/memberContentAccess.test.tsx ' +
          'with a proof, or ask the operator for a KNOWN GAP row.').join('\n'),
      );
    }
  });

  it('no stale row: every registered file exists and still holds what it is registered for', () => {
    const stale = [
      ...REGISTRY.filter((s) => !fs.existsSync(path.join(SRC, s.file)) || !found[s.kind].includes(s.file)).map((s) => `${s.kind} ${s.file}`),
      ...EXEMPT.flatMap((e) => e.kinds.filter((k) => !found[k].includes(e.file)).map((k) => `exempt ${k} ${e.file}`)),
    ];
    expect(stale).toEqual([]);
  });

  it('every row has a proof that is still in the suite', () => {
    const composers = fs.readFileSync(COMPOSERS_TEST, 'utf8');
    const problems: string[] = [];
    for (const s of REGISTRY) {
      const p = s.proof;
      if (p.by === 'composers' && !composers.includes(`'${s.file}'`)) problems.push(`${s.file}: not drawn in memberContentAccess.composers.test.tsx`);
      if (p.by === 'cache' && !CACHE_CASES[p.id]) problems.push(`${s.file}: no cache case ${p.id}`);
      if (p.by === 'state' && !STATE_CASES.includes(p.id)) problems.push(`${s.file}: no state case ${p.id}`);
      if (p.by === 'host' && !REGISTRY.some((h) => h.file === p.host && h.kind === 'composer')) problems.push(`${s.file}: host ${p.host} not registered`);
      if (p.by === 'host' && !new RegExp(`\\b${path.basename(s.file).replace(/\.tsx?$/, '')}\\b`).test(read(p.host)) &&
        !REGISTRY.some((h) => h.proof.by === 'host' && (h.proof as { host: string }).host === p.host && read(h.file).includes(path.basename(s.file).replace(/\.tsx?$/, '')))) {
        problems.push(`${s.file}: its host ${p.host} does not draw it`);
      }
      if (p.by === 'suite') {
        const file = path.join(SRC, p.file);
        const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        for (const t of p.titles) if (!text.includes(t)) problems.push(`${s.file}: proof "${t}" is gone from src/${p.file}`);
      }
      if (p.by === 'gap' && 'cache' in p.gap.shows && !CACHE_CASES[p.gap.shows.cache]) problems.push(`${s.file}: no cache case ${p.gap.shows.cache}`);
    }
    expect(problems).toEqual([]);
  });
});

// ─── The cache after a block made on another screen ───────────────────────────────────────────────────────────────

const BLOCKED = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WORDS = 'words-of-the-blocked-person';
const WS = 'ws-1';
const row = (author: string, extra: Record<string, unknown> = {}) => ({ id: `${author}-row`, author_user_id: author, body: author === BLOCKED ? WORDS : 'hello', ...extra });
const pages = <T,>(items: T[], extra: Record<string, unknown> = {}): InfiniteData<unknown> => ({ pages: [{ items, ...extra }], pageParams: [null] });

type CacheCase = { key: readonly unknown[]; seed: unknown; check: 'dropped' | 'reread' };
/** Each list's own cache key (the key builders the screens use), seeded with a blocked person's rows. */
const CACHE_CASES: Record<string, CacheCase> = {
  'dm-list': { key: communityKeys.dmThreads(WS), seed: [{ other_user_id: BLOCKED, last_message_preview: WORDS, unread_count: 2 }, { other_user_id: OTHER, unread_count: 1 }], check: 'dropped' },
  'coach-inbox': { key: ['messaging', 'v2', 'coach-inbox', 'all'], seed: pages([{ client_id: BLOCKED, preview: WORDS, unread_count: 3 }, { client_id: OTHER, unread_count: 1 }], { total_unread: 4 }), check: 'dropped' },
  'badge-messages': { key: ['messages', 'unread-count'], seed: { count: 3 }, check: 'reread' },
  'badge-community-me': { key: communityKeys.me(), seed: { unread_dm_count: 2 }, check: 'reread' },
  'badge-coach-unread': { key: ['community', 'home', 'coach-unread', 'coach-1'], seed: 2, check: 'reread' },
  'space-posts': { key: communityKeys.posts(WS), seed: pages([row(BLOCKED), row(OTHER)]), check: 'dropped' },
  'post-comments': { key: communityKeys.comments('post-1'), seed: pages([row(BLOCKED), row(OTHER)]), check: 'dropped' },
  today: { key: communityKeys.today(), seed: { pinned_post: { id: 'p', title: WORDS, author_user_id: BLOCKED } }, check: 'dropped' },
  search: { key: communitySearchKeys.query(WS, 'run'), seed: pages([row(BLOCKED, { snippet: WORDS })]), check: 'dropped' },
  'voice-feed': { key: voiceKeys.feed(WS, { kind: 'all' }), seed: pages([row(BLOCKED), row(OTHER)]), check: 'dropped' },
  'voice-note': { key: voiceKeys.note('vn-1'), seed: row(BLOCKED), check: 'dropped' },
  'challenge-notes': { key: ['community', 'challenge', 'ch-1', 'comments'], seed: pages([row(BLOCKED), row(OTHER)]), check: 'dropped' },
  'coach-post-detail': { key: coachCommunityKeys.post('post-1'), seed: { post: row(BLOCKED), comments: [row(BLOCKED)] }, check: 'dropped' },
};

const holdsBlocked = (data: unknown) => [BLOCKED, WORDS].some((w) => JSON.stringify(data ?? null).includes(w));

async function blockFromAnotherScreen(qc: QueryClient, c: CacheCase) {
  qc.setQueryData(c.key, c.seed);
  registerBlockSyncClient(qc);
  // The coaching block route (a profile or Settings): POST /users/:id/block, then the one block cache (blockSync).
  await messagesModerationApi.block(BLOCKED);
}

const gapCaches = new Set(REGISTRY.flatMap((s) => (s.proof.by === 'gap' && 'cache' in s.proof.gap.shows ? [s.proof.gap.shows.cache] : [])));

describe('KT-2 lists: a blocked person already in the cache drops out after a block made on another screen', () => {
  beforeEach(() => {
    mockPost.mockResolvedValue({ data: {} });
    useBlockedUsersStore.setState({ blocked: [] });
  });

  for (const [id, c] of Object.entries(CACHE_CASES)) {
    const gap = gapCaches.has(id);
    const title = gap
      ? `KNOWN GAP ${id}: still holds a blocked author's rows after a block (when this fails, the gap is fixed: delete its KNOWN GAP row)`
      : `${id}: ${c.check === 'dropped' ? 'their rows, previews and unread leave the cache at once' : 'the count is read again at once'}`;
    (gap ? it.failing : it)(title, async () => {
      const qc = new QueryClient();
      await blockFromAnotherScreen(qc, c);
      if (c.check === 'reread') {
        expect(qc.getQueryState(c.key)?.isInvalidated).toBe(true);
        return;
      }
      const data = qc.getQueryData(c.key);
      expect(holdsBlocked(data)).toBe(false);
      if (id === 'coach-inbox') expect((data as InfiniteData<{ total_unread: number }>).pages[0].total_unread).toBe(1);
      qc.clear();
    });
  }
});

// ─── Lists kept outside the query cache ───────────────────────────────────────────────────────────────────────────

const STATE_CASES = ['legacy-coach-list', 'coach-bell-source', 'coach-community-inbox-source', 'focus-reread-coach-home', 'focus-reread-lookup'];

describe('KT-2 lists kept in screen state', () => {
  it('legacy-coach-list: a client I block from another screen leaves the legacy coach list at once', async () => {
    mockCounts.mockResolvedValue({ data: { total: 2, by_client: { 'client-blocked': 1, 'client-2': 1 } } });
    useBlockedUsersStore.setState({ blocked: [] });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const MessagesScreen = require('../screens/coach/MessagesScreen').default;
    const view = await render(<MessagesScreen />);
    expect(await view.findByLabelText(/Open messages with Ana Ruiz/)).toBeTruthy();
    mockPost.mockResolvedValue({ data: {} });
    await act(async () => {
      await messagesModerationApi.block('client-blocked');
    });
    await waitFor(() => expect(view.queryByLabelText(/Open messages with Ana Ruiz/)).toBeNull());
    expect(view.getByLabelText(/Open messages with Ben Ode/)).toBeTruthy();
  });

  // These read the block store in place; a full draw needs the whole navigator, so the rule is checked in the source.
  it('coach-bell-source: the coach bell count effect depends on the block store', () => {
    const src = read('navigation/CoachNavigator.tsx');
    const fn = src.slice(src.indexOf('function useCoachNotificationUnreadCount'));
    expect(fn).toMatch(/useBlockedUsersStore\(/);
    expect(fn.slice(0, fn.indexOf('return count;'))).toMatch(/\}, \[blocked\]\);/);
  });
  it('coach-community-inbox-source: the coach community inbox leaves out my blocks', () => {
    const src = read('screens/community/CoachCommunityInboxScreen.tsx');
    expect(src).toMatch(/useBlockedUsersStore\(/);
    expect(src).toMatch(/blockedIds\.has\(/);
  });
  it.each([
    ['focus-reread-coach-home', 'screens/coach/home-v11/useCoachHomeV11.ts'],
    ['focus-reread-lookup', 'screens/coach/lookup/ClientLookupScreen.tsx'],
  ])('%s: the count is read again when the screen comes back into focus', (_id, file) => {
    expect(read(file)).toMatch(/useFocusEffect|useIsFocused|isFocused/);
  });
});

describe('KT-2 known gaps shown in the source (when one fails, the gap is fixed: delete its KNOWN GAP row)', () => {
  const sourceGaps = REGISTRY.flatMap((s) => (s.proof.by === 'gap' && 'lacks' in s.proof.gap.shows ? [{ s, gap: s.proof.gap }] : []));
  it.each(sourceGaps.map(({ s, gap }) => [`${s.kind} ${gap.where}`, s.file, (gap.shows as { lacks: RegExp }).lacks] as const))(
    'KNOWN GAP %s still lacks the rule',
    (_label, file, lacks) => {
      expect(read(file)).not.toMatch(lacks);
    },
  );
});
