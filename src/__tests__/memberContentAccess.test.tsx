/**
 * KT-2, the phone half (planning/KNOWN_TRAPS.md, trap KT-2: "a blocked, banned, removed or departed person leaks through
 * a new read, list, search, preview, count, push or composer"). One shared contract test: every phone screen or
 * component that shows member content (posts, comments, messages, voice notes, photos, inbox and search rows, previews,
 * unread counts) or holds a composer (typed text, voice, photo, reactions) is a row in REGISTRY below, with how it
 * applies a block (both ways), a ban, a removal, a departure and a closed conversation, and the test that proves it.
 *
 * What makes a file a surface (the inventory scan, src/ without tests, read as TypeScript, not as text):
 *   composer  a composer part drawn (COMPOSER_PARTS: ComposerInput, ReplyComposer, ReactionBar, VoiceNotesSection,
 *             VoiceRecordSheet, VoiceNoteComposer, ...), a member-content send called or taken (COMPOSER_CALLS, any
 *             non-read method of a member API in MEMBER_APIS or named like one), a raw POST / PUT / PATCH on
 *             services/api into a content collection (SEND_PATH), or a TextInput drawn in a MEMBER_PLACE file.
 *   list      a member-content read called or taken (LIST_CALLS, any read method of a member API, incl. removedRowsApi),
 *             a raw GET on services/api of a content collection (MEMBER_PATH), or a FlatList / SectionList / FlashList
 *             or useInfiniteQuery in a MEMBER_PLACE file.
 *   The scan follows bindings, not spellings: an import under another name, a namespace import, a destructured or
 *   re-assigned method, import() / require() / React.lazy, re-exports and export *, and a local helper or hook that
 *   holds a kind all carry the kind to the file that uses them (a REGISTRY row that is not a host and an EXEMPT row
 *   without `passes` stop it). A relative import from a member place that the scan cannot read is named (fail closed).
 * WHEN THIS GOES RED (say which one in your PR):
 *   - "not in the KT-2 registry": you added a composer or a content list. Make it apply the rules (a composer draws
 *     nothing typeable unless useConversationClosed says open, ConversationClosedLine in its place; a list drops a
 *     blocked person's rows, previews and counts at once through src/lib/blockSync.ts or a useBlockedUsersStore
 *     filter), then register it in REGISTRY with a proof. If it cannot apply a rule yet, ask the operator for a
 *     KNOWN GAP row. Never add a KNOWN GAP row or an EXEMPT row yourself to make this pass.
 *   - a behavior case failed: a registered surface stopped applying a rule. Apply the rule again; never loosen the case.
 *   - "KNOWN GAP ... still holds" / "still lacks": a known gap case asserts the leak as it is today. Red means you fixed
 *     the gap (delete its KNOWN GAP row so the rule is enforced from now on) or broke the harness (fix the harness).
 *   - "stale row": a registered file moved, or no longer reads or sends member content. Update or remove the row.
 * The composers are drawn in memberContentAccess.composers.test.tsx (the same registry rows, by file).
 * Space chat (m#871, m#879, m#887, m#897) is not on main: when it merges the scan names its screen and its hook
 *   (screens/community/CommunitySpaceChatScreen.tsx, components/community/space-chat/useSpaceChat.ts) until they are rows.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
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

/** where = file:function that misses the rule; shows = a CACHE_CASES id (asserted still holding the rows) or a source check. */
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
    how: 'm#898 (95e98a74): a change in the block store clears the loaded rows and reads the list again, so a notice from a person I just blocked leaves; the server read (backend #1171) leaves out their rows',
    proof: { by: 'suite', file: '__tests__/notificationCenter.blockReturn.test.tsx', titles: [
      'does not retain the blocked coach words when the existing centre regains focus; unrelated rows stay',
    ] } },
  // FR-911: named by the fail-closed scan (a send through services/messageOutbox, a coach inbox drawn in a FlatList).
  { file: 'components/share/ShareSheet.tsx', kind: 'composer', what: '"Send to {coach}": a share card sent into the coaching chat (sendCardViaOutbox)',
    how: 'none before the send: a refused card leaves the outbox and Send goes away (shareB156), but nothing asks whether the chat is closed first',
    proof: gap('components/share/ShareSheet.tsx:ShareSheet', 'block (both ways), closed conversation',
      'Send to {coach} is offered while my coach blocked me or I blocked my coach; nothing on the phone asks useConversationClosed or the coaching row before the card is sent (the server refuses it)',
      { lacks: /useConversationClosed|useCoachingRow|useCoachChatClosed|useBlockedUsersStore/ }) },
  { file: 'screens/coach/command-center/InboxScreen.tsx', kind: 'list', what: 'the command center inbox: client threads with the last message preview and unread (commandCenterApi.getInbox)',
    how: 'kept in screen state, read on open and on a pull; no block-store filter',
    proof: gap('screens/coach/command-center/InboxScreen.tsx:InboxScreen', 'block (rows and previews after a block)',
      'a client I just blocked keeps their row and last message preview until the next read; nothing filters my blocks or closed_client_ids',
      { lacks: /useBlockedUsersStore|blockedIds|closed_client_ids/ }) },
  { file: 'screens/coach/cross-pillar/CrossPillarMessagesScreen.tsx', kind: 'list', what: 'the coach\'s total unread messages', how: 'read once when opened',
    proof: gap('screens/coach/cross-pillar/CrossPillarMessagesScreen.tsx:load', 'block (count after a block)', 'the total is read once on open and not again on a block, so a just-blocked client\'s unread stays counted until a pull to refresh', { lacks: /useBlockedUsersStore|useFocusEffect|isFocused/ }) },
  { file: 'screens/coach/home-v11/useCoachHomeV11.ts', kind: 'list', what: 'coach home unread counts',
    how: 're-read on focus (a block is made on another screen, so coming back reads again); the server count leaves a closed chat out', proof: { by: 'state', id: 'focus-reread-coach-home' } },
  { file: 'screens/coach/lookup/ClientLookupScreen.tsx', kind: 'list', what: 'unread per client in the coach lookup',
    how: 're-read on focus; the server count leaves a closed chat out', proof: { by: 'state', id: 'focus-reread-lookup' } },
];

/** Files that match a sign but are not a surface: plumbing the registered surfaces call, or no member words. */
/** passes: plumbing whose exports carry member content on to their callers, so the files that use them are named. A
 * row without it (and any REGISTRY row but a `host` part) stops that: its users are not named for it. */
const EXEMPT: { file: string; kinds: Kind[]; why: string; passes?: true }[] = [
  { file: 'services/api.ts', kinds: ['composer', 'list'], why: 'wire wrappers; the registered screens call them', passes: true },
  { file: 'api/messagesApi.ts', kinds: ['composer'], why: 'wire wrapper (sendReply); block / unblock report to blockSync', passes: true },
  { file: 'api/messagingV2Api.ts', kinds: ['list'], why: 'wire wrapper and schema', passes: true },
  { file: 'api/coachCommunityApi.ts', kinds: ['list'], why: 'wire wrapper', passes: true },
  { file: 'services/messageOutbox.ts', kinds: ['composer'], why: 'sends what a registered chat queued; it draws nothing', passes: true },
  { file: 'hooks/useCommunity.ts', kinds: ['composer', 'list'], why: 'query and send hooks the registered community screens call', passes: true },
  { file: 'hooks/useMessageOutbox.ts', kinds: ['composer'], why: 'queue hook of the registered coaching chats', passes: true },
  { file: 'hooks/useThreadV2.ts', kinds: ['composer', 'list'], why: 'thread hook of the registered coaching chats', passes: true },
  { file: 'hooks/useVoiceOutbox.ts', kinds: ['composer'], why: 'voice queue hook of the registered voice composer', passes: true },
  { file: 'hooks/useVoiceUpload.ts', kinds: ['composer'], why: 'voice upload hook of the registered voice composer', passes: true },
  { file: 'hooks/useVoiceFeed.ts', kinds: ['list'], why: 'voice read hooks of the registered voice lists', passes: true },
  { file: 'hooks/useCommunitySearch.ts', kinds: ['list'], why: 'search hook of the registered search screen', passes: true },
  { file: 'hooks/useCoachCommunity.ts', kinds: ['list'], why: 'coach community read hooks of the registered coach screens', passes: true },
  { file: 'hooks/useInboxTriage.ts', kinds: ['list'], why: 'triage hook of the registered coach community inbox', passes: true },
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
  { file: 'screens/community/CoachCommunityCohortsScreen.tsx', kinds: ['composer', 'list'], why: 'coach admin: a space name; the list of the coach\'s own spaces' },
  { file: 'screens/community/CoachCommunityCohortDetailScreen.tsx', kinds: ['composer', 'list'], why: 'coach admin: invites and the roster the coach needs to remove a member' },
  { file: 'screens/community/CoachCommunityEventsScreen.tsx', kinds: ['composer', 'list'], why: 'coach admin: event details; the coach\'s own events' },
  { file: 'screens/settings/RomanChatsConfirmSheet.tsx', kinds: ['composer'], why: 'Roman (the assistant), not a member' },
  { file: 'screens/community/CoachCommunityModerationScreen.tsx', kinds: ['list'], why: 'moderation: the coach must see reported words to remove them (the removal path itself)' },
  { file: 'screens/coach/CommunityReportsEntry.tsx', kinds: ['list'], why: 'moderation: the count of reports waiting' },
  // FR-911: the wire modules the scan now reads (a raw /community or /messages call); their callers are named.
  ...([
    ['api/communityApi.ts', ['composer', 'list']], ['api/communityRemovedRows.ts', ['list']], ['api/communityChallengesApi.ts', ['composer', 'list']],
    ['api/communityVoiceApi.ts', ['composer', 'list']], ['api/communitySearchApi.ts', ['list']], ['api/communityWinsApi.ts', ['composer', 'list']],
    ['api/communityAiTriageApi.ts', ['list']], ['api/communityEventsApi.ts', ['list']], ['api/communityClassroomApi.ts', ['list']],
    ['api/communitySafetyApi.ts', ['list']], ['api/communityWearablePromptsApi.ts', ['list']],
  ] as [string, Kind[]][]).map(([file, kinds]) => ({ file, kinds, why: 'wire wrapper: the registered screens call it', passes: true as const })),
  { file: 'screens/coach/broadcasts/CoachBroadcastsScreen.tsx', kinds: ['list'], why: 'the coach\'s own broadcasts (one to many; the server picks who gets them)' },
  { file: 'screens/community/CommunityChallengesScreen.tsx', kinds: ['list'], why: 'coach-made challenges of a space; the notes are the registered challenge screen' },
  { file: 'screens/community/CommunityClassroomScreen.tsx', kinds: ['list'], why: 'coach-made lessons' },
  { file: 'screens/community/CommunityWearablePromptsScreen.tsx', kinds: ['list'], why: 'coach-only prompts the server drafts from a client\'s own opted-in wearable insights' },
  { file: 'screens/roman/RomanChatScreen.tsx', kinds: ['list'], why: 'Roman (the assistant), not a member' },
];

// ─── The inventory scan ──────────────────────────────────────────────────────────────────────────────────────────
//
// FR-911 (LO-911 B2, LS-911 B1): the scan reads each file's syntax (the TypeScript parser), not its spelling. A name is
// followed to where it was declared: through `as` aliases, default exports, re-exports (`export { A as B } from`,
// `export *`, barrels), namespace imports, destructuring (`const { sendDm } = communityApi`), import(), require() and
// lazy(). A file is named by what it uses there:
//   - a sign below, by its declared name (so `usePosts as useFeed` and `usePosts\n(` are usePosts);
//   - a raw call on services/api to a member path (/community, /messages, /coach/messages, a client's messages): a GET
//     is a list, any other verb a composer;
//   - any method of an API object whose own body makes such a call (spaceChatApi.list), unless NOT_CONTENT below says
//     why that one method carries no member words;
//   - any function, hook or component exported from another file whose own body (followed the same way) holds one of
//     these: a shared wrapper, a new hook in hooks/useCommunity.ts, useSpaceChat. A file with its own REGISTRY row
//     (proof other than `host`) stops this: its row proves it, so the screens that draw it need none;
//   - inside MEMBER_PLACE: a <TextInput (composer), a <FlatList, <SectionList, <FlashList or useInfiniteQuery( (list);
//   - fail closed: a name imported from a member place the scan cannot read, an import() or require() it cannot follow,
//     or an API object it cannot find but named for member content, counts as both (or by its verb).

const COMPOSER_PARTS = new Set(['ComposerInput', 'ReplyComposer', 'ReactionBar', 'VoiceNotesSection', 'VoiceRecordSheet', 'VoiceNoteComposer']);
const COMPOSER_CALLS = new Set([
  'useSendDm', 'useCreatePost', 'useAddComment', 'useReactToPost', 'useVoiceUpload', 'useVoiceOutbox', 'useMessageOutbox',
  ...['createPost', 'addComment', 'reactToPost', 'sendDm', 'openDmThread', 'postWin'].map((m) => `communityApi.${m}`),
  'messagingV2Api.sendMessage', 'messagingV2Api.editMessage',
  ...['messagesApi', 'messagesModerationApi'].flatMap((o) => [`${o}.sendReply`, `${o}.send`]),
  'coachApi.sendClientMessage', 'coachApi.sendNudge',
  'communityVoiceApi.create', 'communityVoiceApi.issueUploadUrl', 'communityVoiceApi.uploadBytes',
  'communityChallengesApi.addComment', 'communityWinsApi.postWin', 'broadcastsApi.create',
]);
const LIST_CALLS = new Set([
  'usePosts', 'usePostComments', 'useDmThreads', 'useDmMessages', 'useCommunityToday', 'useCommunityBadge', 'useVoiceFeed',
  'useVoiceCatchUp', 'useCommunitySearch', 'useThreadV2', 'useCoachInbox', 'useCoachPostDetail', 'useCoachFlagged',
  'useClientUnreadCount', 'useInboxTriage',
  ...['listPosts', 'getPost', 'listComments', 'listDmThreads', 'listDmMessages', 'getToday', 'getFeed'].map((m) => `communityApi.${m}`),
  ...['listPosts', 'getPost', 'listComments'].map((m) => `removedRowsApi.${m}`),
  'messagingV2Api.getCoachInbox', 'messagingV2Api.getClientInbox', 'messagingV2Api.listPins',
  'communityVoiceApi.listFeed', 'communityVoiceApi.getOne', 'communityChallengesApi.listComments',
  'communityChallengesApi.getLeaderboard', 'communitySearchApi.search', 'communityWinsApi.getFeed',
  'coachCommunityApi.getInbox', 'coachCommunityApi.getCoachPostDetail', 'coachCommunityApi.getFlagged',
  'messagesApi.list', 'messagesApi.unreadCount', 'coachApi.getClientMessages', 'coachApi.getUnreadCounts',
  'fetchNotifications', 'fetchUnreadCount',
]);
/** The API objects of the signs above: any method of these counts (by its verb) unless NOT_CONTENT names it. */
const MEMBER_APIS = new Set([...COMPOSER_CALLS, ...LIST_CALLS].filter((s) => s.includes('.')).map((s) => s.split('.')[0]));
/** An API object the scan cannot find (a file not read, a snippet) counts when its name speaks of member content. */
const MEMBER_API_NAME = /^\w*(community|space|chat|dm|message|voice|post|comment|inbox|thread|reply|removedRows|wins|broadcast)\w*Api$/i;
/** A read by its verb; anything else on a member API is a send. */
const READ_VERB = /^(get|list|fetch|search|load|read|peek|find|count|unread|poll)/i;
/** A raw member-content path on services/api: the first argument's text. */
const MEMBER_PATH = /^\/(community|messages|coach\/messages|coach\/clients\/\$\{[^}]+\}\/messages)(\/|\?|$|\$\{)/;
const WIRE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);
/** A send of member words: a POST, PUT or PATCH into a collection of them (not a mark, a block, a report or a delete). */
const SEND_PATH = /\/(posts|comments|messages|dms?|threads|voice-notes|voice|reactions|chat|wins|replies|notes)\/?(\?.*)?$/;
/** A plain text box counts as a composer, and a list part as a list, where member words live. */
const MEMBER_PLACE = /(^|\/)(community|messaging)\/|\/[^/]*(Messag|Inbox|Chat|Thread|Dm|Comment|Voice|Post|Reply|Broadcast)[^/]*$/;
const LIST_PARTS = new Set(['FlatList', 'SectionList', 'FlashList']);

/**
 * Methods of a member API (or exports of a member module) that carry no member words, so using them names nothing.
 * Reviewed rows only, each with why: `${object}.${method}` (or `${module}:${export}`) -> why.
 */
const NOT_CONTENT: Record<string, string> = {
  'communityApi.getMe': 'my own workspace id and unread totals; the totals are the Community badge rows (useCommunityBadge, cache case badge-community-me)',
  'services/messageOutbox.ts:sendOutboxBeforeSignOut': 'sends at sign-out what a registered chat already queued; nothing is typed or drawn',
  'hooks/useMessageOutbox.ts:useMessageOutboxDrain': 'sends in the background what a registered chat already queued; nothing is typed or drawn where it runs',
  communityEventsApi: 'coach-made events and my own RSVP (v2-3 events): no member\'s words or rows',
  communityClassroomApi: 'coach-made lessons (v3-2 classroom): no member\'s words or rows',
  communityWearablePromptsApi: 'coach-only prompts the server drafts from a client\'s own opted-in wearable insights: no other member\'s words',
  communitySafetyApi: 'my own safety notices and the people I blocked (that list exists to unblock them); a report or block goes to the safety team, never to the person',
  'communityChallengesApi.listChallenges': 'coach-made challenges of a space (title, goal); the notes and leaderboard are the registered challenge screen',
  'coachCommunityApi.getDashboard': 'the coach\'s own spaces and totals, no row, name or words of a member; the rows behind them are the registered coach community inbox',
  'coachCommunityApi.getCohorts': 'coach admin: the coach\'s own spaces (names)',
  'coachCommunityApi.getCohortDetail': 'coach admin: a space and its roster, which the coach needs to invite or remove a member',
  'coachCommunityApi.getCoachEmptyStates': 'which empty states to draw (flags only)',
};

const notContent = (o: Origin) =>
  !!(NOT_CONTENT[o.name] || NOT_CONTENT[o.name.split('.')[0]] || (o.mod && (NOT_CONTENT[`${o.mod}:${o.name}`] || NOT_CONTENT[`${o.mod}:${o.name.split('.')[0]}`])));
type Kinds = { composer: boolean; list: boolean };
const NONE = (): Kinds => ({ composer: false, list: false });
const add = (a: Kinds, b: Kinds) => { a.composer ||= b.composer; a.list ||= b.list; return a; };
/** mod: the src file that declares it (null: not read; `pkg:` a package); name: its declared name (dotted for a method). */
type Origin = { mod: string | null; name: string; spec?: string };
type Binding = { from: string; name: string } | { ns: string } | { obj: string; prop: string } | { lazy: string };
type ModInfo = {
  sf: ts.SourceFile;
  bindings: Map<string, Binding>;
  /** exported name -> local name, or a re-export */
  exports: Map<string, { local: string } | { from: string; name: string }>;
  stars: string[];
  /** top-level declarations: local name -> node (an object literal's methods as `name.method`) */
  decls: Map<string, ts.Node>;
  /** every name declared anywhere in the file (parameters, locals): such a name is never an unread member API */
  declared: Set<string>;
};

const parsed = new Map<string, { text: string; info: ModInfo }>();
function modInfo(file: string, text: string): ModInfo {
  const hit = parsed.get(file);
  if (hit && hit.text === text) return hit.info;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const info: ModInfo = { sf, bindings: new Map(), exports: new Map(), stars: [], decls: new Map(), declared: new Set() };
  const specOf = (n: ts.Node | undefined): string | null => {
    let e = n;
    while (e && (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression;
    if (e && ts.isCallExpression(e) && e.arguments.length && ts.isStringLiteralLike(e.arguments[0]) &&
      (e.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e.expression) && e.expression.text === 'require'))) {
      return e.arguments[0].text;
    }
    return null;
  };
  const bindPattern = (p: ts.BindingName, target: (prop: string) => Binding) => {
    if (ts.isIdentifier(p)) return;
    if (ts.isObjectBindingPattern(p)) {
      for (const el of p.elements) {
        const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
        if (prop && ts.isIdentifier(el.name)) info.bindings.set(el.name.text, target(prop));
      }
    }
  };
  const visit = (n: ts.Node) => {
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name)) info.declared.add(n.name.text);
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause && !n.importClause.isTypeOnly) {
      const from = n.moduleSpecifier.text;
      const c = n.importClause;
      if (c.name) info.bindings.set(c.name.text, { from, name: 'default' });
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) info.bindings.set(c.namedBindings.name.text, { ns: from });
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const el of c.namedBindings.elements) info.bindings.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
      }
    }
    if (ts.isExportDeclaration(n) && !n.isTypeOnly) {
      const from = n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : null;
      if (!n.exportClause && from) info.stars.push(from);
      if (n.exportClause && ts.isNamedExports(n.exportClause)) {
        for (const el of n.exportClause.elements) {
          const inner = (el.propertyName ?? el.name).text;
          info.exports.set(el.name.text, from ? { from, name: inner } : { local: inner });
        }
      }
      if (n.exportClause && ts.isNamespaceExport(n.exportClause) && from) info.bindings.set(n.exportClause.name.text, { ns: from });
    }
    if (ts.isExportAssignment(n)) {
      if (ts.isIdentifier(n.expression)) info.exports.set('default', { local: n.expression.text });
      else { info.exports.set('default', { local: 'default' }); info.decls.set('default', n.expression); }
    }
    const exported = ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.parent === sf) {
      const local = n.name?.text ?? 'default';
      info.decls.set(local, n);
      if (exported) info.exports.set(isDefault ? 'default' : local, { local });
    }
    if (ts.isVariableDeclaration(n)) {
      const top = n.parent?.parent?.parent === sf;
      const spec = specOf(n.initializer);
      const init = n.initializer;
      const propSpec = init && ts.isPropertyAccessExpression(init) ? specOf(init.expression) : null;
      if (propSpec && init && ts.isPropertyAccessExpression(init) && ts.isIdentifier(n.name)) info.bindings.set(n.name.text, { from: propSpec, name: init.name.text });
      else if (spec && ts.isIdentifier(n.name)) info.bindings.set(n.name.text, { ns: spec });
      else if (spec) bindPattern(n.name, (prop) => ({ from: spec, name: prop }));
      else if (n.initializer && ts.isIdentifier(n.initializer) && !ts.isIdentifier(n.name)) {
        const obj = n.initializer.text;
        bindPattern(n.name, (prop) => ({ obj, prop }));
      } else if (n.initializer && ts.isCallExpression(n.initializer) && /^(React\.)?lazy$/.test(n.initializer.expression.getText(sf)) && ts.isIdentifier(n.name)) {
        const f = n.initializer.arguments[0];
        const body = f && (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) ? (ts.isBlock(f.body) ? undefined : f.body) : undefined;
        const lazySpec = specOf(body);
        if (lazySpec) info.bindings.set(n.name.text, { lazy: lazySpec });
      }
      if (top && ts.isIdentifier(n.name)) {
        const local = n.name.text;
        info.decls.set(local, n);
        let init = n.initializer;
        while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
        if (init && ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) info.decls.set(`${local}.${p.name.text}`, p);
        }
        const stmt = n.parent.parent;
        if (ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) info.exports.set(local, { local });
      }
    }
    // import('m').then(({ usePosts }) => ...) and .then((m) => m.usePosts)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'then') {
      const spec = specOf(n.expression.expression);
      const cb = n.arguments[0];
      if (spec && cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters[0]) {
        const p = cb.parameters[0].name;
        if (ts.isIdentifier(p)) info.bindings.set(p.text, { ns: spec });
        else bindPattern(p, (prop) => ({ from: spec, name: prop }));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  parsed.set(file, { text, info });
  return info;
}

type ScanCtx = { files: Map<string, string>; memo: Map<string, Kinds>; busy: Set<string> };
function resolveSpec(ctx: ScanCtx, from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return `pkg:${spec}`;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (ctx.files.has(c)) return c;
  return null;
}
const infoOf = (ctx: ScanCtx, mod: string) => modInfo(mod, ctx.files.get(mod) as string);

/** Where an exported name of `mod` was declared. */
function resolveExport(ctx: ScanCtx, mod: string | null, name: string, spec: string, depth = 0): Origin {
  if (!mod) return { mod: null, name, spec };
  if (mod.startsWith('pkg:') || depth > 12) return { mod, name };
  const info = infoOf(ctx, mod);
  const e = info.exports.get(name);
  if (e && 'from' in e) return resolveExport(ctx, resolveSpec(ctx, mod, e.from), e.name, e.from, depth + 1);
  if (e) return resolveLocal(ctx, mod, e.local, depth + 1);
  for (const s of info.stars) {
    const m = resolveSpec(ctx, mod, s);
    if (m && !m.startsWith('pkg:') && (infoOf(ctx, m).exports.has(name) || infoOf(ctx, m).stars.length)) {
      const o = resolveExport(ctx, m, name, s, depth + 1);
      if (o.mod !== m || infoOf(ctx, m).decls.has(o.name)) return o;
    }
  }
  return { mod, name };
}
/** Where a name used in `mod` was declared (an import followed to its declaration, or this file, or not found). */
function resolveLocal(ctx: ScanCtx, mod: string, local: string, depth = 0): Origin {
  const info = infoOf(ctx, mod);
  const b = info.bindings.get(local);
  if (b && 'from' in b) return resolveExport(ctx, resolveSpec(ctx, mod, b.from), b.name, b.from, depth + 1);
  if (b && 'lazy' in b) return resolveExport(ctx, resolveSpec(ctx, mod, b.lazy), 'default', b.lazy, depth + 1);
  if (b && 'obj' in b) {
    const o = resolveLocal(ctx, mod, b.obj, depth + 1);
    return { ...o, name: `${o.name}.${b.prop}` };
  }
  if (b && 'ns' in b) return { mod, name: local, spec: b.ns };
  if (info.decls.has(local)) return { mod, name: local };
  return { mod: null, name: local };
}

/** The kinds a declaration's own body holds (followed into what it calls), less the kinds its file's own row proves. */
function declKinds(ctx: ScanCtx, o: Origin): Kinds {
  if (!o.mod || o.mod.startsWith('pkg:')) return NONE();
  const key = `${o.mod}:${o.name}`;
  if (notContent(o)) return NONE();
  const memo = ctx.memo.get(key);
  if (memo) return memo;
  if (ctx.busy.has(key)) return NONE();
  const node = infoOf(ctx, o.mod).decls.get(o.name);
  if (!node) return NONE();
  ctx.busy.add(key);
  const k = nodeKinds(ctx, o.mod, node);
  ctx.busy.delete(key);
  for (const kind of ['composer', 'list'] as Kind[]) {
    if (REGISTRY.some((s) => s.file === o.mod && s.kind === kind && s.proof.by !== 'host')) k[kind] = false;
    if (EXEMPT.some((e) => e.file === o.mod && e.kinds.includes(kind) && !e.passes)) k[kind] = false;
  }
  ctx.memo.set(key, k);
  return k;
}

/** What a use of `o` (called, drawn, or a method taken) names. */
function kindsOfUse(ctx: ScanCtx, mod: string, o: Origin, how: 'call' | 'jsx' | 'method', followLocal: boolean): Kinds {
  const k = NONE();
  const [obj, method] = o.name.includes('.') ? [o.name.slice(0, o.name.lastIndexOf('.')), o.name.slice(o.name.lastIndexOf('.') + 1)] : [null, null];
  if (notContent(o)) return k;
  if (how === 'jsx' && COMPOSER_PARTS.has(o.name)) k.composer = true;
  if (how !== 'jsx' && COMPOSER_CALLS.has(o.name)) k.composer = true;
  if (how !== 'jsx' && LIST_CALLS.has(o.name)) k.list = true;
  if (how === 'jsx' && LIST_PARTS.has(o.name) && MEMBER_PLACE.test(mod)) k.list = true;
  if (how === 'call' && o.name === 'useInfiniteQuery' && MEMBER_PLACE.test(mod)) k.list = true;
  // a method of a member API the scan cannot read (no file, or not a method it can find): by its verb (fail closed)
  const unread = (!o.mod && !infoOf(ctx, mod).declared.has(obj ?? '')) || (!!o.mod && !o.mod.startsWith('pkg:') && !infoOf(ctx, o.mod).decls.has(o.name));
  if (obj && method && unread && (MEMBER_APIS.has(obj) || MEMBER_API_NAME.test(obj))) {
    if (READ_VERB.test(method)) k.list = true; else k.composer = true;
  }
  if (o.mod && (o.mod !== mod || followLocal)) add(k, declKinds(ctx, o));
  if (!o.mod && o.spec && o.spec.startsWith('.') && MEMBER_PLACE.test(path.posix.join(path.posix.dirname(mod), o.spec))) {
    // fail closed: imported from a member place the scan cannot read
    if (how === 'call' && /^use[A-Z]/.test(o.name)) k.list = true;
    else add(k, { composer: true, list: true });
  }
  return k;
}

/** The kinds a node holds: everything in it that is called, drawn, sent on the wire, or a member API method taken. */
function nodeKinds(ctx: ScanCtx, mod: string, root: ts.Node): Kinds {
  const info = infoOf(ctx, mod);
  const sf = info.sf;
  const k = NONE();
  const followLocal = root !== sf;
  /** a namespace (import * as, await import(), require(), .then((m) => ...)) or import()/require() call: its spec */
  const nsSpec = (e: ts.Expression): string | null => {
    while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    if (ts.isIdentifier(e)) { const b = info.bindings.get(e.text); return b && 'ns' in b ? b.ns : null; }
    if (ts.isCallExpression(e) && e.arguments.length && ts.isStringLiteralLike(e.arguments[0]) &&
      (e.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e.expression) && e.expression.text === 'require'))) return e.arguments[0].text;
    return null;
  };
  const origin = (e: ts.Expression): Origin | null => {
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
    if (ts.isIdentifier(e)) return resolveLocal(ctx, mod, e.text);
    if (ts.isPropertyAccessExpression(e)) {
      const spec = nsSpec(e.expression);
      if (spec) return resolveExport(ctx, resolveSpec(ctx, mod, spec), e.name.text, spec);
      const o = origin(e.expression);
      return o ? { ...o, name: `${o.name}.${e.name.text}` } : null;
    }
    return null;
  };
  const tagName = (t: ts.JsxTagNameExpression): Origin | null => (ts.isIdentifier(t) || ts.isPropertyAccessExpression(t) ? origin(t as ts.Expression) : null);
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')) {
        const a = n.arguments[0];
        if (!a || !ts.isStringLiteralLike(a)) add(k, { composer: true, list: true }); // fail closed: cannot follow
        else if (!usedAsBinding(n)) {
          // fail closed: an import() or require() whose use the scan does not follow counts as all its module holds
          const m = resolveSpec(ctx, mod, a.text);
          if (m && !m.startsWith('pkg:')) for (const name of infoOf(ctx, m).exports.keys()) add(k, declKinds(ctx, resolveExport(ctx, m, name, a.text)));
        }
      } else {
        const o = origin(n.expression);
        if (o) add(k, kindsOfUse(ctx, mod, o, 'call', followLocal));
        // a raw call on services/api to a member path
        if (ts.isPropertyAccessExpression(n.expression) && WIRE_VERBS.has(n.expression.name.text) && n.arguments[0]) {
          const api = origin(n.expression.expression);
          const isApi = api && ((api.mod === 'services/api.ts' && /^(default|api)$/.test(api.name)) || (!api.mod && /^(api|apiClient|http|client)$/.test(api.name)));
          const a0 = n.arguments[0];
          const text = ts.isStringLiteralLike(a0) ? a0.text : ts.isTemplateExpression(a0) ? a0.getText(sf).slice(1, -1) : null;
          if (isApi && text !== null && MEMBER_PATH.test(text)) {
            const verb = n.expression.name.text;
            if (verb === 'get') k.list = true;
            else if (verb !== 'delete' && SEND_PATH.test(text)) k.composer = true;
          }
        }
      }
    } else if (ts.isPropertyAccessExpression(n) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
      // a member API method taken without a call (queryFn: communityApi.listPosts)
      const o = origin(n);
      if (o && o.name.includes('.')) add(k, kindsOfUse(ctx, mod, o, 'method', followLocal));
    }
    if (ts.isIdentifier(n) && isReference(n) && info.bindings.has(n.text)) {
      // an imported function passed on, not called here (queryFn: fetchInboxTriage): it runs, so it counts
      const o = resolveLocal(ctx, mod, n.text);
      if (o.mod !== mod) add(k, kindsOfUse(ctx, mod, o, 'call', followLocal));
    }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const o = tagName(n.tagName);
      if (o) add(k, kindsOfUse(ctx, mod, o, 'jsx', followLocal));
      if (o?.name === 'TextInput' && MEMBER_PLACE.test(mod)) k.composer = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return k;
}
/** An identifier read as a value, not called or drawn here (those count on their own), not a name being declared. */
function isReference(n: ts.Identifier): boolean {
  const p = n.parent;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === n) return false;
  if (ts.isPropertyAccessExpression(p)) return false; // X.m counts as the method; obj.X is a property name
  if (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p) || ts.isExportAssignment(p)) return false;
  if ((ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isPropertyAssignment(p) ||
    ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isJsxAttribute(p)) && (p as { name?: ts.Node }).name === n) {
    return ts.isShorthandPropertyAssignment(p); // { fetchInboxTriage } passes the value on
  }
  if (ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isQualifiedName(p)) return false;
  return true;
}
/** import()/require() read as a binding (const x = ..., .then(cb), require(...).x, lazy(() => import(...))). */
function usedAsBinding(call: ts.CallExpression): boolean {
  let p: ts.Node = call.parent;
  while (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p)) p = p.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAccessExpression(p)) return true;
  if (ts.isArrowFunction(p) && ts.isCallExpression(p.parent) && /^(React\.)?lazy$/.test(p.parent.expression.getText())) return true;
  return false;
}

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

function scanCtx(extra: Record<string, string> = {}): ScanCtx {
  const files = new Map(sourceFiles(SRC).map((f) => [rel(f), fs.readFileSync(f, 'utf8')] as const));
  for (const [f, t] of Object.entries(extra)) files.set(f, t);
  return { files, memo: new Map(), busy: new Set() };
}
/** What one file holds, read against src/ as it is (`text` stands in for the file, which need not exist). */
function classify(file: string, text: string, ctx: ScanCtx = scanCtx({ [file]: text })): Kinds {
  if (ctx.files.get(file) !== text) ctx.files.set(file, text);
  return nodeKinds(ctx, file, infoOf(ctx, file).sf);
}
function scan(): { composer: string[]; list: string[] } {
  const ctx = scanCtx();
  const out = { composer: [] as string[], list: [] as string[] };
  for (const [file, text] of ctx.files) {
    const k = classify(file, text, ctx);
    if (k.composer) out.composer.push(file);
    if (k.list) out.list.push(file);
  }
  return out;
}

const registered = (file: string, kind: Kind) =>
  REGISTRY.some((s) => s.file === file && s.kind === kind) || EXEMPT.some((e) => e.file === file && e.kinds.includes(kind));

it('LS-911 B2: NotificationCenter must use live proof, not the obsolete pre-898 gap', () => {
  const row = REGISTRY.find((s) => s.file === 'screens/notifications/NotificationCenterScreen.tsx' && s.kind === 'list');
  expect(row).toBeDefined();
  expect(row?.proof.by).not.toBe('gap');
});

describe('LS-911 B1: source discovery must recognize member content independent of call spelling', () => {
  function checkSource(kind: Kind, source: string, shared = false) {
    const dir = fs.mkdtempSync(path.join(SRC, 'screens', 'LS911Inventory-'));
    const file = path.join(dir, 'Fixture.tsx');
    try {
      fs.writeFileSync(file, source);
      if (shared) {
        fs.writeFileSync(path.join(dir, 'SharedReply.tsx'), "export { ComposerInput as MemberReply } from '../../components/community';");
      }
      expect(registered(rel(file), kind)).toBe(false);
      expect(scan()[kind]).toContain(rel(file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ['composer', "import React from 'react'; import { ComposerInput as MemberDraft } from '../../components/community'; export default () => <MemberDraft placeholder=\"Reply\" maxLength={2000} onSubmit={async () => undefined} />;", false],
    ['list', "import React from 'react'; import { Text } from 'react-native'; import { usePosts as useMemberPosts } from '../../hooks/useCommunity'; export default function Feed() { const feed = useMemberPosts('ws'); return <Text>{feed.data?.[0]?.body}</Text>; }", false],
    ['list', "import React from 'react'; import { Text } from 'react-native'; import { usePosts } from '../../hooks/useCommunity'; export default function Feed() { const feed = usePosts\n('ws'); return <Text>{feed.data?.[0]?.body}</Text>; }", false],
    ['list', "import React from 'react'; import { Text } from 'react-native'; import { useQuery } from '@tanstack/react-query'; import { removedRowsApi } from '../../api/communityRemovedRows'; export default function Peek() { const post = useQuery({ queryKey: ['community', 'post', 'p'], queryFn: () => removedRowsApi.getPost('p') }); return <Text>{post.data?.body}</Text>; }", false],
    ['composer', "import React from 'react'; import { MemberReply } from './SharedReply'; export default () => <MemberReply placeholder=\"Reply\" maxLength={2000} onSubmit={async () => undefined} />;", true],
  ] as const)('recognizes unregistered %s fixture %#', (kind, source, shared) => {
    checkSource(kind, source, shared);
  });

  it.each([
    ['composer', "import React from 'react'; import { ComposerInput } from '../../components/community'; export default () => <ComposerInput placeholder=\"Reply\" maxLength={2000} onSubmit={async () => undefined} />;"],
    ['list', "import React from 'react'; import { Text } from 'react-native'; import { usePosts } from '../../hooks/useCommunity'; export default function Feed() { const feed = usePosts('ws'); return <Text>{feed.data?.[0]?.body}</Text>; }"],
  ] as const)('recognizes the canonical %s spelling as a positive control', (kind, source) => {
    checkSource(kind, source);
  });
});

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
    mockPost.mockClear();
    mockPost.mockResolvedValue({ data: {} });
    useBlockedUsersStore.setState({ blocked: [] });
  });

  for (const [id, c] of Object.entries(CACHE_CASES)) {
    const gap = gapCaches.has(id);
    const title = gap
      ? `KNOWN GAP ${id}: still holds a blocked author's rows after a block (red = the gap is fixed, delete its KNOWN GAP row; or the harness broke)`
      : `${id}: ${c.check === 'dropped' ? 'their rows, previews and unread leave the cache at once' : 'the count is read again at once'}`;
    it(title, async () => {
      const qc = new QueryClient();
      await blockFromAnotherScreen(qc, c);
      // the block reached the server and the one block cache: a gap case that holds rows is the gap, not a harness slip
      expect(mockPost.mock.calls.map((a) => a[0])).toContainEqual(expect.stringContaining(`/users/${BLOCKED}/block`));
      if (gap) {
        expect(holdsBlocked(qc.getQueryData(c.key))).toBe(true);
        qc.clear();
        return;
      }
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

describe('KT-2 known gaps shown in the source (red = the gap is fixed, delete its KNOWN GAP row)', () => {
  const sourceGaps = REGISTRY.flatMap((s) => (s.proof.by === 'gap' && 'lacks' in s.proof.gap.shows ? [{ s, gap: s.proof.gap }] : []));
  it.each(sourceGaps.map(({ s, gap }) => [`${s.kind} ${gap.where}`, s.file, (gap.shows as { lacks: RegExp }).lacks] as const))(
    'KNOWN GAP %s still lacks the rule',
    (_label, file, lacks) => {
      expect(read(file)).not.toMatch(lacks);
    },
  );
});

// ─── LO-911 B2 (B-TEST, review only): forms the inventory scan must read ─────────────────────────────────────────
// Each form is real code a builder can write today. At 05a79ab4 the scan named a file only by exact names, so every
// form below went through unnamed. FR-911: the scan reads bindings, so each is named. The first two are the space
// chat unit (m#871 to m#897 head 718aa171) as written.
describe('LO-911 B2: the inventory scan names every form a member list or composer can take', () => {
  const FORMS: { file: string; kind: Kind; text: string }[] = [
    { file: 'screens/community/CommunitySpaceChatScreen.tsx', kind: 'list',
      text: "import { useSpaceChat } from '../../components/community/space-chat/useSpaceChat';\nconst chat = useSpaceChat(cohortId, client?.id ?? null, isOnline, focused);\n<FlatList data={items} renderItem={renderItem} />" },
    { file: 'components/community/space-chat/useSpaceChat.ts', kind: 'list',
      text: 'queryFn: ({ pageParam }) => spaceChatApi.list(cohortId, pageParam),' },
    { file: 'components/home/AliasFeed.tsx', kind: 'list',
      text: "import { usePosts as useFeed } from '../../hooks/useCommunity';\nconst q = useFeed(id);\n<FlatList data={q.data?.items} />" },
    { file: 'components/home/RawWireStream.tsx', kind: 'list',
      text: 'queryFn: () => api.get(`/community/workspaces/${id}/chat`)\n<SectionList sections={sections} />' },
    { file: 'hooks/usePostsWithRemoved.ts', kind: 'list',
      text: 'queryFn: () => removedRowsApi.listPosts(workspaceId)' },
    { file: 'components/home/AliasComposer.tsx', kind: 'composer',
      text: "import { useSendDm as useSend } from '../../hooks/useCommunity';\nconst send = useSend(ws, thread);\n<TextInput onSubmitEditing={() => send.mutate(t)} />" },
    { file: 'components/home/DestructuredSend.tsx', kind: 'composer',
      text: 'const { sendDm } = communityApi;\n<CopilotComposer onSend={(text) => sendDm(ws, thread, text)} />' },
  ];
  // FR-911: the scan is a function now (classify), so the seven texts run through it as the file they stand for.
  const named = (f: { file: string; kind: Kind; text: string }) => classify(f.file, f.text)[f.kind];
  it('every form is named by the scan', () => {
    expect(FORMS.filter((f) => !named(f)).map((f) => `${f.kind} ${f.file}`)).toEqual([]);
  });
});

// ─── LO-911R2 B1 (B-TEST, review only): the stop rule is keyed by file, not by what the row proves ───────────────
// hooks/useApi.ts is a REGISTRY list row for one badge (useUnreadMessagesCount, cache case badge-messages). declKinds
// stops a kind for every export of a file with such a row, so a new member read added to that file (here a coaching
// thread hook on messagesApi.list, a LIST_CALLS sign) passes the file's old row, and the new screen that draws it is
// never named. Smallest fix: a non-host row stops only the exports it proves (an `exports` list on the row, or the
// stop keyed by `${file}:${export}`), so any other export carries its kinds on to its callers.
describe('LO-911R2 B1: the stop rule must not hide a new caller of a registered shared file', () => {
  it('a new screen calling a new member read added to registered hooks/useApi.ts is named', () => {
    const useApi = `${read('hooks/useApi.ts')}\nexport function useCoachThread() {\n  return useQuery({ queryKey: ['messages', 'thread'], queryFn: async () => (await messagesApi.list()).data });\n}\n`;
    const screen = "import React from 'react';\nimport { Text } from 'react-native';\nimport { useCoachThread } from '../../hooks/useApi';\n" +
      'export default function CoachThreadPeek() {\n  const q = useCoachThread();\n  return <Text>{q.data?.[0]?.body}</Text>;\n}\n';
    const ctx = scanCtx({ 'hooks/useApi.ts': useApi, 'screens/client/CoachThreadPeek.tsx': screen });
    expect(classify('screens/client/CoachThreadPeek.tsx', screen, ctx).list).toBe(true);
  });
});

// ─── LO-911R2 B2 (B-TEST, review only): my coach's nudges are a list of another person's words, never named ──────
// screens/client/NotificationsScreen.tsx draws my coach's typed nudges (title and body, useNudges in hooks/useApi.ts,
// nudgesApi.list). The REGISTRY counts the same nudge as a composer on the coach side ("a typed nudge (title and body)"),
// and the server leaves out a nudge across a block either way (backend nudges.service.ts listForClient, FX-1141), but
// nudgesApi is no sign of the scan, blockSync touches no ['nudges'] key, and even with the sign the hooks/useApi.ts
// badge row stops useNudges (B1). So a client who blocks their coach keeps the coach's nudges on Notifications, and
// nothing here says so. Smallest fix: nudgesApi.list and nudgesApi.unreadCount as LIST_CALLS signs (with B1's per-export
// stop), and a NotificationsScreen row with its proof (a cache case for ['nudges'], or an operator-approved gap row).
describe('LO-911R2 B2: the client nudge list (my coach\'s words) is a registered list', () => {
  it('the scan names screens/client/NotificationsScreen.tsx a list', () => {
    expect(scan().list).toContain('screens/client/NotificationsScreen.tsx');
  });
});

// ─── LO-911R2 B3 (B-TEST, review only): a raw services/api read of a member path the scan cannot read passes ─────
// nodeKinds names a raw wire read only when the first argument is a literal or a template that starts with the path,
// the verb is get/post/put/patch/delete, and the object is services/api by name. A path held in a const, a path behind
// a base constant, api.request and a local alias of api all go through unnamed, though the header says the scan fails
// closed on a form it cannot read. Smallest fix: a services/api call (any verb, request included, or an alias of the
// default export) whose path text the scan cannot read counts by its verb (fail closed), with resolving a local const
// initializer for the path; the few files that build paths today take EXEMPT rows with a why.
describe('LO-911R2 B3: every raw services/api read of a member path is named, whatever form the path or client takes', () => {
  const RAW: { file: string; text: string }[] = [
    { file: 'screens/client/ChatByVariable.tsx', text: "import api from '../../services/api';\nexport default function V({ id }: { id: string }) {\n  const url = `/community/cohorts/${id}/chat`;\n  const q = useQuery({ queryKey: ['chat', id], queryFn: () => api.get(url) });\n  return <Text>{q.data?.data?.[0]?.body}</Text>;\n}\n" },
    { file: 'screens/client/ChatByBase.tsx', text: "import api from '../../services/api';\nconst BASE = '/community';\nexport default function V({ id }: { id: string }) {\n  const q = useQuery({ queryKey: ['chat', id], queryFn: () => api.get(`${BASE}/cohorts/${id}/chat`) });\n  return <Text>{q.data?.data?.[0]?.body}</Text>;\n}\n" },
    { file: 'screens/client/ChatByRequest.tsx', text: "import api from '../../services/api';\nexport default function V() {\n  const q = useQuery({ queryKey: ['posts'], queryFn: () => api.request({ method: 'get', url: '/community/posts' }) });\n  return <Text>{q.data?.data?.[0]?.body}</Text>;\n}\n" },
    { file: 'screens/client/ChatByAlias.tsx', text: "import api from '../../services/api';\nconst wire = api;\nexport default function V() {\n  const q = useQuery({ queryKey: ['posts'], queryFn: () => wire.get('/community/posts') });\n  return <Text>{q.data?.data?.[0]?.body}</Text>;\n}\n" },
  ];
  it('each raw read is named a list', () => {
    expect(RAW.filter((f) => !classify(f.file, f.text).list).map((f) => f.file)).toEqual([]);
  });
});

describe('LS-911R2 independent scanner probes', () => {
  const file = 'screens/community/IndependentMemberHost.tsx';
  it.each([
    ['static API URL constant', "import api from '../../services/api'; const url = '/community/workspaces/ws/posts'; export const read = () => api.get(url);"],
    ['computed raw API method', "import api from '../../services/api'; export const read = () => api['get']('/community/workspaces/ws/posts');"],
    ['side-effect dynamic import of unread member module', "export const load = () => import('../../components/community/UnreadMemberPart');"],
    ['namespace dynamic import of unread member module', "export const load = async () => { const parts = await import('../../components/community/UnreadMemberPart'); return parts; };"],
    ['side-effect require of unread member module', "export const load = () => require('../../components/community/UnreadMemberPart');"],
    ['namespace require of unread member module', "export const load = () => { const parts = require('../../components/community/UnreadMemberPart'); return parts; };"],
    ['computed require export that is drawn', "import React from 'react'; const Feed = require('../../components/community/UnreadMemberPart')['Feed']; export const Host = () => <Feed />;"],
    ['raw literal API read control', "import api from '../../services/api'; export const read = () => api.get('/community/workspaces/ws/posts');"],
    ['unread named member import control', "import { Feed } from '../../components/community/UnreadMemberPart'; export const load = () => Feed();"],
    ['nonliteral dynamic import control', "export const load = (specifier: string) => import(specifier);"],
  ])('%s cannot disappear', (_label, text) => {
    const kinds = classify(file, text);
    expect(kinds.composer || kinds.list).toBe(true);
  });

  it.each([
    ['shared hook', 'hooks/IndependentMemberRows.ts', "import { usePosts } from './useCommunity'; export const useIndependentRows = () => usePosts('ws');",
      "import { useIndependentRows } from '../../hooks/IndependentMemberRows'; export const Feed = () => useIndependentRows();", 'list'],
    ['shared wrapper', 'components/community/IndependentDraft.tsx', "import React from 'react'; import { ComposerInput } from './ComposerInput'; export const IndependentDraft = () => <ComposerInput placeholder=\"Reply\" maxLength={2000} onSubmit={async () => undefined} />;",
      "import React from 'react'; import { IndependentDraft } from '../../components/community/IndependentDraft'; export const Feed = () => <IndependentDraft />;", 'composer'],
    ['default re-export', 'components/community/IndependentDraft.tsx', "export { ComposerInput as default } from './ComposerInput';",
      "import React from 'react'; import Draft from '../../components/community/IndependentDraft'; export const Feed = () => <Draft placeholder=\"Reply\" maxLength={2000} onSubmit={async () => undefined} />;", 'composer'],
  ] as const)('new caller of %s remains visible', (_label, shared, sharedText, text, kind) => {
    const ctx = scanCtx({ [file]: text, [shared]: sharedText });
    expect(classify(file, text, ctx)[kind]).toBe(true);
  });

  it.each([
    ['namespace imported component passed to createElement', "import React from 'react'; import * as Parts from '../../components/community/IndependentDraft'; export const Feed = () => React.createElement(Parts.IndependentDraft);"],
    ['computed namespace component', "import React from 'react'; import * as Parts from '../../components/community/IndependentDraft'; const Draft = Parts['IndependentDraft']; export const Feed = () => <Draft />;"],
  ])('%s remains visible', (_label, text) => {
    const ctx = scanCtx({
      [file]: text,
      'components/community/IndependentDraft.tsx': "import React from 'react'; import { ComposerInput } from './ComposerInput'; export const IndependentDraft = () => <ComposerInput placeholder=\"Reply\" maxLength={2000} onSubmit={async () => undefined} />;",
    });
    const kinds = classify(file, text, ctx);
    expect(kinds.composer || kinds.list).toBe(true);
  });
});

// ─── FR-911R2: the other forms of each class (red at 06d2faeb, green at the fix) ─────────────────────────────────
// F1: a services/api path or a module the scan cannot read fails closed (by its verb); what it can read it follows.
describe('FR-911R2 F1: the other raw services/api forms are named by their verb, readable or not', () => {
  const host = 'screens/client/FR911R2WireHost.tsx';
  const head = "import api from '../../services/api';\n";
  it.each([
    ['request without a method (a GET)', `${head}export const read = () => api.request({ url: '/community/posts' });`, 'list'],
    ['callable client with a config', `${head}export const read = () => api({ method: 'get', url: '/messages' });`, 'list'],
    ['a verb picked by a key the scan cannot read', `${head}export const call = (verb: 'get' | 'post') => api[verb]('/community/posts');`, 'list'],
    ['a path a local function builds', `${head}const chatPath = (id: string) => \`/community/cohorts/\${id}/chat\`;\nexport const read = (id: string) => api.get(chatPath(id));`, 'list'],
    ['a path held in an object of paths', `${head}const PATHS = { chat: '/community/chat' } as const;\nexport const read = () => api.get(PATHS.chat);`, 'list'],
    ['a path picked by a condition', `${head}export const read = (mine: boolean) => api.get(mine ? '/v1/clients/me/coach' : '/messages/coach-review');`, 'list'],
    ['a path the scan cannot read (a parameter) read', `${head}export const read = (path: string) => api.get(path);`, 'list'],
    ['a path the scan cannot read (a parameter) sent', `${head}export const send = (path: string, body: unknown) => api.post(path, body);`, 'composer'],
    ['a client kept under another name in a function', `${head}export const read = () => { const w = api; return w.get('/community/posts'); };`, 'list'],
  ] as const)('%s', (_label, text, kind) => {
    expect(classify(host, text)[kind]).toBe(true);
  });
  it('a path built from a base imported from another file is read through it', () => {
    const ctx = scanCtx({ 'screens/client/fr911r2Paths.ts': "export const CHAT_BASE = '/community/cohorts';\n" });
    const text = `${head}import { CHAT_BASE } from './fr911r2Paths';\nexport const read = (id: string) => api.get(\`\${CHAT_BASE}/\${id}/chat\`);`;
    expect(classify(host, text, ctx).list).toBe(true);
  });
  it.each([
    ['a readable path that is not member content', `${head}export const read = () => api.get('/v1/clients/me/coach');`],
    ['a readable path behind a const that is not member content', `${head}const url = '/me/ai-consent/roman';\nexport const read = () => api.get(url);`],
    ['a delete the scan cannot read', `${head}export const drop = (path: string) => api.delete(path);`],
    ['an image required by a relative path', "export const img = require('../../assets/fr911r2-missing.png');"],
    ['a client method that is no request', `${head}api.interceptors.request.use((c) => c);`],
  ])('control, not named: %s', (_label, text) => {
    const k = classify(host, text);
    expect(k.composer || k.list).toBe(false);
  });
  it.each([
    ['a whole namespace passed on', "import * as Parts from '../../components/community/FR911R2Draft';\nexport const parts = () => register(Parts);"],
    ['a namespace part kept under a name, then drawn', "import React from 'react';\nimport * as Parts from '../../components/community/FR911R2Draft';\nconst Draft = Parts.FR911R2Draft;\nexport const Feed = () => <Draft />;"],
    ['a namespace part picked by a key the scan cannot read', "import * as Parts from '../../components/community/FR911R2Draft';\nexport const pick = (name: 'FR911R2Draft') => Parts[name];"],
    ['an import() of a code module the scan cannot read, outside a member place', "export const load = () => import('../settings/FR911R2Missing');"],
  ])('%s is named', (_label, text) => {
    const ctx = scanCtx({ 'components/community/FR911R2Draft.tsx': "import React from 'react'; import { ComposerInput } from './ComposerInput'; export const FR911R2Draft = () => <ComposerInput placeholder=\"Reply\" maxLength={2000} onSubmit={async () => undefined} />;" });
    const k = classify('screens/client/FR911R2NsHost.tsx', text, ctx);
    expect(k.composer || k.list).toBe(true);
  });
});

// F2: a row stops only the exports it proves; a KNOWN GAP row stops nothing.
describe('FR-911R2 F2: a row stops only what it proves', () => {
  const screen = (imp: string, use: string) => `import React from 'react';\nimport { Text } from 'react-native';\n${imp}\nexport default function FR911R2Peek() {\n  ${use}\n}\n`;
  it('a new export of an EXEMPT file (hooks/useNotifications.ts) that reads member words names its caller', () => {
    const hook = `${read('hooks/useNotifications.ts')}\nexport function useCoachWords() {\n  return useQuery({ queryKey: ['messages', 'words'], queryFn: async () => (await messagesApi.list()).data });\n}\n`;
    const text = screen("import { useCoachWords } from '../../hooks/useNotifications';", 'const q = useCoachWords();\n  return <Text>{String(q.data)}</Text>;');
    const ctx = scanCtx({ 'hooks/useNotifications.ts': `import { messagesApi } from '../services/api';\nimport { useQuery } from '@tanstack/react-query';\n${hook}`, 'screens/client/FR911R2Peek.tsx': text });
    expect(classify('screens/client/FR911R2Peek.tsx', text, ctx).list).toBe(true);
  });
  it('a new export of a registered list part (components/community/SpaceTree.tsx) that reads posts names its caller', () => {
    const part = `${read('components/community/SpaceTree.tsx')}\nexport function useSpacePeek(ws: string) {\n  return usePosts(ws);\n}\nimport { usePosts } from '../../hooks/useCommunity';\n`;
    const text = screen("import { useSpacePeek } from '../../components/community/SpaceTree';", "const q = useSpacePeek('ws');\n  return <Text>{String(q.data)}</Text>;");
    const ctx = scanCtx({ 'components/community/SpaceTree.tsx': part, 'screens/client/FR911R2Peek.tsx': text });
    expect(classify('screens/client/FR911R2Peek.tsx', text, ctx).list).toBe(true);
  });
  it.each([
    ['ShareSheet (its row is a KNOWN GAP)', "import ShareSheet from '../../components/share/ShareSheet';", 'return <ShareSheet card={null} onClose={() => undefined} />;'],
    ['useLookupNudge (its row is a KNOWN GAP)', "import { useLookupNudge } from '../coach/lookup/useLookupNudge';", 'const n = useLookupNudge({} as never);\n  return <Text>{String(n)}</Text>;'],
  ])('a new caller of %s is named a composer', (_label, imp, use) => {
    const text = screen(imp, use);
    expect(classify('screens/client/FR911R2Peek.tsx', text).composer).toBe(true);
  });
});

// F3: my coach's nudges are signs of the scan, through the API object or a raw read.
describe('FR-911R2 F3: a new read of my coach\'s nudges is named a list', () => {
  it.each([
    ['nudgesApi.list', "import { nudgesApi } from '../../services/api';\nexport const read = () => nudgesApi.list({ limit: 5 });"],
    ['nudgesApi.unreadCount taken as a queryFn', "import { useQuery } from '@tanstack/react-query';\nimport { nudgesApi } from '../../services/api';\nexport const useCount = () => useQuery({ queryKey: ['nudges', 'n'], queryFn: nudgesApi.unreadCount });"],
    ['a raw read of /nudges', "import api from '../../services/api';\nexport const read = () => api.get('/nudges?limit=5');"],
    ['useNudges from hooks/useApi.ts', "import { useNudges } from '../../hooks/useApi';\nexport const useMine = () => useNudges(5);"],
  ])('%s', (_label, text) => {
    expect(classify('screens/client/FR911R2Nudges.tsx', text).list).toBe(true);
  });
});
