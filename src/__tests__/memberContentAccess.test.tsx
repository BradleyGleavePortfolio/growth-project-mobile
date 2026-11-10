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
 *   holds a kind all carry the kind to the file that uses them. Only the exports a row proves stop it (its `exports`,
 *   else the file's default export and the one named like the file) of a REGISTRY row that is neither a host nor a
 *   KNOWN GAP, or of an EXEMPT row without `passes`; a KNOWN GAP row stops nothing, so whoever draws a gap part is
 *   named and takes a `via` row. Fail closed: a relative import from a member place, or an import() / require() of a
 *   code module, that the scan cannot read is named; a services/api call whose path it cannot read counts by its verb.
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
 * Space chat (m#871, m#879, m#887, m#897): its data layer is the SPLIT-938C rows below (useSpaceChat, spaceChatOutbox,
 *   useSpaceVoiceOutbox, spaceChatApi); its screen (screens/community/CommunitySpaceChatScreen.tsx) comes in a later part,
 *   and the scan names it until it is a row.
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
  | { by: 'state'; id: string }
  /** FR-911R2 (LO-911R2 B1): draws registered parts whose own row is a KNOWN GAP (or another `via` row), so it shows
   * that gap and nothing of its own; the gap is fixed in the part. Checked: each part has such a row of this kind, and
   * this file imports it. */
  | { by: 'via'; parts: string[] };

/** where = file:function that misses the rule; shows = a CACHE_CASES id (asserted still holding the rows) or a source check. */
type KnownGap = { where: string; rule: string; why: string; shows: { cache: string } | { lacks: RegExp } };
/** file under src/; what it shows or sends; how it applies a block (mine / theirs), a ban, a removal, a departure, a
 * closed conversation and the cache after a block; the proof. */
/** exports: the exports the row proves (default: the file's default export and the one named like the file); only
 * those stop the scan, so any other export of the file carries its kinds on to its callers (a KNOWN GAP row stops none). */
type Surface = { file: string; kind: Kind; what: string; how: string; proof: Proof | { by: 'gap'; gap: KnownGap }; exports?: string[] };

const CLIENT_THREAD = 'screens/client/__tests__/MessagesScreenV2.test.tsx';
const SHARE = ['components/share/ShareSheet.tsx'];
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
  // KT2-940 (LO-940R2 C1, 6675884966): m#940 (NUDGE-GATE-M) gated Send Nudge on the client file and the risk screen
  // through useNudgeGate, so their KNOWN GAP rows were untrue; they are gated composers now, proved by their suites.
  { file: 'screens/coach/ClientDetailScreen.tsx', kind: 'composer', what: 'a typed nudge (title and body) pushed to a client (coachApi.sendNudge)',
    how: 'useNudgeGate(clientId): Send Nudge and the nudge form only while it says open; my block (block store), their block or a closed chat (closed_client_ids) and a refusal remembered this session close it and draw the closed line; unknown is closed; a refused send closes it (close(err)); a pull reads again',
    proof: { by: 'suite', file: 'screens/coach/__tests__/ClientFileNudgeGateNGM.test.tsx', titles: [
      '$name: Send Nudge $nudge, closed line $line',
      'a pull to refresh reads the pair again: an unblock on the server brings Send Nudge back',
    ] } },
  { file: 'screens/coach/ClientDetailScreen.tsx', kind: 'composer', what: 'the same nudge: the gate keeps a refusal while the pair is unknown, and a refused send closes it',
    how: 'useNudgeGate: an unknown pair (read out, offline, block list not read) stays closed and keeps the refusal; close(err) closes only on a blocked refusal',
    proof: { by: 'suite', file: 'screens/coach/__tests__/NudgeGateRefusalFIX940.test.tsx', titles: [
      '$name: still closed, no nudge, the refusal kept',
      'the server answers closed: still closed, the refusal kept',
      '$name: closes $closes',
    ] } },
  { file: 'screens/coach/ClientRiskDetailScreen.tsx', kind: 'composer', what: 'a fixed check-in nudge pushed to a client (coachApi.sendNudge)',
    how: 'useNudgeGate(userId): \'Send check-in nudge\' only while it says open; my block, their block or a closed chat and a refusal remembered this session close it and draw the closed line; unknown is closed; a refused send closes it (close(err))',
    proof: { by: 'suite', file: 'screens/coach/__tests__/ClientRiskNudgeGateNGM.test.tsx', titles: [
      '$name: nudge $nudge, closed line $line',
    ] } },
  // FIX-933R4 (LS-933R4 B1): m#933 gated the lookup nudge (LS-933R3 B1: the form opens only while the lookup's pair is
  // open; LS-933R4 B1: a pair that closes under it says why in its place), so its KNOWN GAP row was untrue; it is a
  // gated composer now, proved by its suites (ClientLookupScreen's via row for it went with the gap row).
  { file: 'screens/coach/lookup/useLookupNudge.tsx', kind: 'composer', what: 'a typed nudge from the coach lookup pushed to a client (coachApi.sendNudge)',
    how: 'the lookup\'s pair (my block from the block store, their block or a closed chat remembered from a refusal this session, unread is closed): the nudge form opens only while it is open; a send refused as closed goes through useConversationClosed\'s close(err) (remembered, announced) and takes the form\'s fields and Send away',
    proof: { by: 'suite', file: 'screens/coach/__tests__/ClientLookupNudgeGateFIX933R3.test.tsx', titles: [
      'opens no nudge form when the pair is %s',
      'an open pair opens the form; a 403 messaging.blocked takes it away, is remembered and the entry stays closed',
      'a plain network error keeps the form, its words and Send',
    ] } },
  { file: 'screens/coach/lookup/useLookupNudge.tsx', kind: 'composer', what: 'the same nudge: a pair that closes under the open form says why at once',
    how: 'a refusal or a block either way landing while the form is up draws ConversationClosedLine where the title, message and Send were (over the peek the form goes and the peek\'s line says it); the draft is kept; one send at a time, and its answer acts only on the form it was sent from',
    proof: { by: 'suite', file: 'screens/coach/__tests__/ClientLookupNudgeSaysWhyFIX933R4.test.tsx', titles: [
      '%s, %s: says why at once (no extra tap), announced, remembered; the draft is kept',
      'a block landing while the form is up, %s: says why at once and keeps the draft',
      'a second Send while one is in flight sends nothing more; the refusal then says why',
    ] } },

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
  { file: 'hooks/useApi.ts', kind: 'list', what: 'the messages unread badge (useUnreadMessagesCount, [\'messages\', \'unread-count\'])',
    how: 'blockSync reads the badge again at once', proof: { by: 'cache', id: 'badge-messages' }, exports: ['useUnreadMessagesCount'] },
  // FR-911R2 (LO-911R2 B2): my coach's nudges (typed title and body), named once nudgesApi is a sign.
  { file: 'hooks/useApi.ts', kind: 'list', what: 'my coach\'s nudges and their unread count (useNudges, useUnreadNudgeCount, [\'nudges\'])',
    how: 'server read only; nothing on the phone drops the cached nudges after a block',
    proof: cacheGap('[\'nudges\']', 'nudges', 'blockSync touches no [\'nudges\'] key, so a coach I just blocked keeps their nudges (title and body) on Notifications until the next read (G11, a runtime follow-up)'),
    exports: ['useNudges', 'useUnreadNudgeCount'] },
  { file: 'screens/client/NotificationsScreen.tsx', kind: 'list', what: 'my coach\'s nudges: title, body, unread (useNudges)',
    how: 'server read only; no block-store filter over the rows',
    proof: cacheGap('[\'nudges\']', 'nudges', 'a coach I just blocked keeps their cached nudges (title and body) on Notifications until the next read; blockSync has no [\'nudges\'] key (G11, a runtime follow-up)') },
  { file: 'navigation/ClientNavigator.tsx', kind: 'list', what: 'the Community tab badge (useCommunityBadge, communityKeys.me)',
    how: 'blockSync reads communityKeys.me again at once', proof: { by: 'cache', id: 'badge-community-me' } },
  { file: 'screens/community/CommunityTabScreen.tsx', kind: 'list', what: 'the Community tab badge (useCommunityBadge)',
    how: 'blockSync reads communityKeys.me again at once', proof: { by: 'cache', id: 'badge-community-me' } },
  { file: 'components/community/SpaceTree.tsx', kind: 'list', what: 'the coach row unread in the space tree (useSpaceTree, drawn by SpaceTree)',
    how: 'blockSync reads [\'community\', \'home\', \'coach-unread\'] again at once; useCoachChatClosed drops the coach row when the chat is closed', proof: { by: 'cache', id: 'badge-coach-unread' },
    exports: ['useSpaceTree', 'SpaceTree'] },
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
  // COACH-DM-M (m#962): the coach's community direct messages. The server (b#1243) lists and opens only the coach's
  // threads with their own current clients and leaves out a block either way, a ban and a departure; on the phone a
  // block drops the row at once (blockSync, the DM list key prefix) and a closed thread draws no words and no box.
  ...((): Surface[] => {
    const file = 'screens/community/coach-dm/__tests__/coachDm.test.tsx';
    const dir = 'screens/community/coach-dm/';
    const BLOCK = 'KT-2: my block made elsewhere drops that client from the list and the count at once';
    const OPEN_BLOCK = 'KT-2: my block made elsewhere closes the open thread at once: no box, no words';
    const NEW = 'KT-2: New message leaves out a client I blocked; one who blocked me opens only the closed thread';
    const CLOSED = ['404: BAM-1, no composer, no messages', '403 blocked_by_you: BAM-2a, and Settings opens Settings > Blocked users',
      '403 blocked_by_them: BAM-2b with the roster name'];
    return [
      { file: `${dir}CoachDmThreadScreen.tsx`, kind: 'composer', what: 'a DM to one client: typed text (ComposerInput -> useSendDm)',
        how: 'useConversationClosed(client, [thread read, send]) + ConversationClosedLine, as the client thread: my block from the block store, theirs, a ban or a departure from the read refusal; nothing editable before the read answers (useServerAnswered)',
        proof: { by: 'suite', file, titles: [...CLOSED, OPEN_BLOCK] } },
      { file: `${dir}CoachDmThreadScreen.tsx`, kind: 'list', what: 'one client\'s DM messages',
        how: 'closed (either block, a ban, a departure) draws none of the client\'s words', proof: { by: 'suite', file, titles: [CLOSED[0], OPEN_BLOCK] } },
      { file: `${dir}CoachDmListScreen.tsx`, kind: 'list', what: 'the coach\'s DM rows: roster name, last active',
        how: 'blockSync drops a blocked client\'s row from the cached list at once (communityKeys.dmThreads prefix); the server leaves out theirs, bans and departures',
        proof: { by: 'suite', file, titles: [BLOCK] } },
      { file: `${dir}CoachDmEntryRow.tsx`, kind: 'list', what: '"{n} conversations" on the coach Community home',
        how: 'counts the same cached list, so a block drops it at once', proof: { by: 'suite', file, titles: [BLOCK] } },
      { file: `${dir}coachDm.tsx`, kind: 'list', what: 'useCoachDms: the coach\'s DM list read (useDmThreads with ?limit=100)',
        how: 'the client\'s hook under the same key prefix, which blockSync filters; the row stops nothing (exports: []), so each caller is named on its own', proof: { by: 'suite', file, titles: [BLOCK] }, exports: [] },
      { file: `${dir}CoachDmNewScreen.tsx`, kind: 'composer', what: 'New message: opens a DM with one client (communityApi.openDmThread); sends no words',
        how: 'leaves out clients in my block store; a refusal either way opens only the closed thread, whose box is gated', proof: { by: 'suite', file, titles: [NEW] } },
    ];
  })(),
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
  // FIX-940 (m#940 NUDGE-GATE-M): the client file's and the risk screen's nudge gate reads the unread counts only for
  // closed_client_ids, to decide open or closed; it draws no member words and no count.
  { file: 'screens/coach/client-detail/useNudgeGate.ts', kind: 'list', what: 'reads the coach unread counts only for closed_client_ids, to gate the nudge (draws no member words or counts)',
    how: 'my block (block store), their block or a closed chat (closed_client_ids) and a refusal remembered this session all close it; unknown is closed; a pull reads again',
    proof: { by: 'suite', file: 'screens/coach/__tests__/ClientFileNudgeGateNGM.test.tsx', titles: [
      '$name: Send Nudge $nudge, closed line $line',
      'a pull to refresh reads the pair again: an unblock on the server brings Send Nudge back',
    ] } },
  // SPLIT-938C (m#938 space chat, part 1): the space chat's data layer. The hook and the text outbox apply the rules and
  // stop here; the wire (spaceChatApi) stops nothing, so every file that reads or sends through it is named.
  ...((): Surface[] => {
    const file = 'components/community/space-chat/__tests__/spaceChatKT2.test.tsx';
    const BLOCK = 'KT-2: a block drops the rows of the blocked author, and every quote of them, from the kept list at once';
    const READ = 'KT-2: a read refused with 403 (a ban, a departure, another workspace) closes the space and leaves nothing readable';
    const READ_HELD = 'KT-2: a read refused with $status mid-visit (a ban, a departure, another workspace) ends reply mode and the sheet and leaves the cached messages unreadable';
    const BLOCK_UNHELD = 'KT-2: a block also ends reply mode on, and empties a waiting reply to, a message of the blocked author the phone never held';
    const SEND = 'KT-2: a text refused with 403 fails as closed (never sent again) and closes the space';
    const WIRE = 'KT-2: 403 and 404 are no access; any other failure is not';
    return [
      { file: 'components/community/space-chat/useSpaceChat.ts', kind: 'list', what: 'one space\'s messages (text, voice, photo, quotes) and its read line',
        how: 'the server leaves out blocks (both ways), bans and departed authors; my block (dropAuthor) takes the author\'s rows and every quote of them (held this visit, or by who wrote it) from every kept list, reply mode and a waiting reply at once; a read or send refused with 403 / 404 closes the space, mid-visit too (noAccess: nothing readable, no sheet, no reply)',
        proof: { by: 'suite', file, titles: [BLOCK, BLOCK_UNHELD, READ, READ_HELD, SEND] } },
      // FIX-942 (LO-942 N2): the row claims only what SEND proves; the account binding is proven in
      // spaceChatOutbox.account.test.ts and LO938R2SameAccountLogin, the sign-out in LO942 / LS942SpaceSignOut.
      { file: 'components/community/space-chat/spaceChatOutbox.ts', kind: 'composer', what: 'the space chat text outbox (texts queued on the phone, sent one at a time)',
        how: 'a 403 / 404 fails the row as closed (never sent again) and tells the open space',
        proof: { by: 'suite', file, titles: [SEND] }, exports: ['spaceOutbox', 'startSpaceOutbox', 'setSpaceOutboxOnline'] },
      { file: 'components/community/space-chat/useSpaceVoiceOutbox.ts', kind: 'composer', what: 'the space chat\'s voice notes on the voice outbox (useVoiceOutbox)',
        how: 'holds only my own notes for this space and sends into this space only; the record entry is drawn only by the space chat while the space is open',
        proof: { by: 'suite', file, titles: ['KT-2: the space voice outbox holds only my notes for this space, and sends into this space only'] } },
      ...(['list', 'composer'] as const).map((kind): Surface => ({ file: 'components/community/space-chat/spaceChatApi.ts', kind,
        what: 'the space chat wire (messages read, send, delete)', how: 'the server leaves out blocks (both ways), bans and departed authors and refuses a send with 403 / 404 (isNoAccess), which the hook and the outbox turn into a closed space; the row stops nothing (exports: [], LS-942 N1), so every caller is named on its own',
        proof: { by: 'suite', file, titles: [WIRE] }, exports: [] })),
      // Part 2: the rows. A row is drawn only for a message useSpaceChat hands the screen (above).
      { file: 'components/community/space-chat/SpaceVoiceNote.tsx', kind: 'list', what: 'one space voice row\'s note (communityVoiceApi.getOne, for its playable copy)',
        how: 'read only for a row useSpaceChat still holds (a block, a ban or a departure takes the row there); a row the coach removed draws no player and reads nothing; a refused lookup (403 / 404), cold or after an earlier answer, draws Try again and hands the player no url, so a clip it had is let go (LS-943 B1), never the note',
        proof: { by: 'suite', file: 'components/community/space-chat/__tests__/spaceChatRowsKT2.test.tsx', titles: [
          'KT-2: a row the coach removed draws its one line only: no words, no player, no menu and no lookup of the note',
          'KT-2: a voice note whose lookup is refused (403 / 404) draws no New mark and nothing to play, only Try again',
        ] } },
    ];
  })(),
  // FR-911R2 (LO-911R2 B1): a KNOWN GAP row no longer stops the scan, so the files that draw a gap part are named; each
  // shows the part's gap (fixed in the part), and its row stops here so the navigators above it are not named for it.
  ...([
    ['screens/client/ProgressScreen.tsx', 'Share a progress card: ShareSheet ("Send to {coach}")', SHARE],
    ['screens/client/active-workout/WorkoutFinishSummary.tsx', 'Share a finished workout: ShareSheet ("Send to {coach}")', SHARE],
    ['screens/client/wearables/MetricDetailV2.tsx', 'Share a metric card: ShareSheet ("Send to {coach}")', SHARE],
    ['navigation/CommunityNavigator.tsx', 'the voice note composer route', ['screens/community/CommunityVoiceComposerScreen.tsx']],
    ['navigation/ClientNavigator.tsx', 'the wins route (CommunityScreen)', ['screens/client/CommunityScreen.tsx']],
  ] as const).map(([file, what, parts]): Surface => ({ file, kind: 'composer', what, how: 'the part\'s own (its KNOWN GAP row)', proof: { by: 'via', parts: [...parts] } })),
  // KT2-940: CoachNavigator's via row for the client detail and risk detail routes went with their KNOWN GAP rows: both
  // screens are gated composers now (rows above), so their own rows stop the scan and the navigator draws no gap part.
  // FIX-933R4: ClientLookupScreen's via row (useLookupNudge) went the same way: the part's own rows stop the scan now.
  ...([
    ['navigation/CommunityNavigator.tsx', 'the community routes (today, a space, a post, a challenge, search, a voice note)', [
      'screens/community/CommunityTodayScreen.tsx', 'screens/community/CommunitySpaceScreen.tsx', 'screens/community/CommunityThreadScreen.tsx',
      'screens/community/CommunityChallengeDetailScreen.tsx', 'screens/community/CommunityFindScreen.tsx', 'screens/community/CommunityVoiceNoteDetail.tsx']],
    ['navigation/CoachCommunityNavigator.tsx', 'the coach community routes (a post, a voice note)', ['screens/community/CoachCommunityPostDetailScreen.tsx', 'screens/community/CommunityVoiceNoteDetail.tsx']],
    ['screens/coach/command-center/CommandCenterScreen.tsx', 'the command center inbox tab (InboxScreen)', ['screens/coach/command-center/InboxScreen.tsx']],
    ['screens/coach/cross-pillar/CrossPillarNavigator.tsx', 'the cross-pillar messages route', ['screens/coach/cross-pillar/CrossPillarMessagesScreen.tsx']],
  ] as const).map(([file, what, parts]): Surface => ({ file, kind: 'list', what, how: 'the parts\' own (their KNOWN GAP rows)', proof: { by: 'via', parts: [...parts] } })),
];

/** Files that match a sign but are not a surface: plumbing the registered surfaces call, or no member words. */
/** passes: plumbing whose exports carry member content on to their callers, so the files that use them are named. A
 * row without it (and any REGISTRY row but a `host` part) stops that: its users are not named for it. */
const EXEMPT: { file: string; kinds: Kind[]; why: string; passes?: true; exports?: string[] }[] = [
  { file: 'services/api.ts', kinds: ['composer', 'list'], why: 'wire wrappers; the registered screens call them', passes: true },
  { file: 'api/messagesApi.ts', kinds: ['composer'], why: 'wire wrapper (sendReply); block / unblock report to blockSync', passes: true },
  { file: 'api/messagingV2Api.ts', kinds: ['composer', 'list'], why: 'wire wrapper and schema (FR-911R2: the scan now reads its threadBase / msgUrl paths, so sendMessage is a send)', passes: true },
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
  { file: 'hooks/useNotifications.ts', kinds: ['list'], why: 'first payment notice only (money, no member words)', exports: ['useFirstPaymentNotification'] },
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
  // FR-911R2 (F1): a services/api call whose path the scan cannot read fails closed; the ones in src/ today, each with why.
  { file: 'services/health/ingestBatching.ts', kinds: ['composer'], exports: ['postIngestBatches'],
    why: 'my own health samples to WEARABLES_INGEST_PATH (/v1/wearables/samples/ingest), through a post seam whose path is a parameter; no member words' },
  // FR-911R3 (LO-911R3 B2): the wire modules of the routes MEMBER_PATH now names by what they reach; their callers are named.
  { file: 'services/commandCenterApi.ts', kinds: ['list'], why: 'wire wrapper (getInbox: GET /coach/command-center/inbox, each client\'s last_message_preview); InboxScreen calls it', passes: true },
  { file: 'services/notificationsApi.ts', kinds: ['list'], why: 'wire wrapper (GET /notifications, a row can quote a message); the registered notification screens call it', passes: true },
];

// ─── The inventory scan ──────────────────────────────────────────────────────────────────────────────────────────
//
// FR-911 (LO-911 B2, LS-911 B1): the scan reads each file's syntax (the TypeScript parser), not its spelling. A name is
// followed to where it was declared: through `as` aliases, default exports, re-exports (`export { A as B } from`,
// `export *`, barrels), namespace imports, destructuring (`const { sendDm } = communityApi`), import(), require() and
// lazy(). A file is named by what it uses there:
//   - a sign below, by its declared name (so `usePosts as useFeed` and `usePosts\n(` are usePosts);
//   - a raw call on services/api to a member path (/community, /messages, /nudges, /coach/messages, a client's
//     messages): a GET is a list, a POST / PUT / PATCH into SEND_PATH a composer. FR-911R2: any form (api['get'],
//     api.request({ method, url }), api(config), an alias of api) and any path text it can read (a const here or
//     imported, an object of paths, a path function's return, a condition); a path whose start it cannot read counts
//     by its verb (fail closed);
//   - any method of an API object whose own body makes such a call (spaceChatApi.list), unless NOT_CONTENT below says
//     why that one method carries no member words;
//   - any function, hook or component exported from another file whose own body (followed the same way) holds one of
//     these: a shared wrapper, a new hook in hooks/useCommunity.ts, useSpaceChat. The exports a row proves stop this
//     (FR-911R2: per export, not per file; a KNOWN GAP row stops nothing), so the screens that draw them need none;
//   - inside MEMBER_PLACE: a <TextInput (composer), a <FlatList, <SectionList, <FlashList or useInfiniteQuery( (list);
//   - fail closed: a name imported from a member place the scan cannot read, an import() or require() it cannot follow
//     (or of a relative code module it cannot read), a whole namespace passed on, a method picked by a key it cannot
//     read, or an API object it cannot find but named for member content, counts as both (or by its verb).
// FR-911R3 (round 3):
//   - F1 (LS-911R3 B3, LO-911R3 B1): a via row proves only the parts it names. In its file a use of a part is read as
//     empty for the row's kind (muted()); whatever else the file holds is its own, so the file (registered() never
//     counts a via row) and its callers (declKinds never stops for a via row) are named for it.
//   - F2 (LS-911R3 B1, LO-911R3 B2): a services/api method under any name (const load = api.get, const { get: load } =
//     api, a held api.request, a method passed on as a value) is that method (wireVerb()); a quoted config key is a
//     key; a route parameter is any one segment; the command center inbox and the notification rows are member routes;
//     a nudge and an edit of one row are sends; a service object's method kept as a function of its file is followed.
//     Each sign's body and each registered place must be named by what it reaches alone (SIGN_BY_NAME says why not).
//   - F3 (LS-911R3 B2): anything bound from relative code the scan cannot read (a static import, require() destructured
//     or picked, import().then, await import(), lazy(), an `export *` or `export { X } from` through any number of
//     barrels) counts as both, in any folder; .js / .jsx and platform files are read, so that is left to what is not there.

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
  'nudgesApi.list', 'nudgesApi.unreadCount', 'useNudges', 'useUnreadNudgeCount',
  'fetchNotifications', 'fetchUnreadCount',
  // FR-911R3 (LO-911R3 B2): the read behind the InboxScreen KNOWN GAP row (each client's last_message_preview)
  'commandCenterApi.getInbox',
]);
/** The API objects of the signs above: any method of these counts (by its verb) unless NOT_CONTENT names it. */
const MEMBER_APIS = new Set([...COMPOSER_CALLS, ...LIST_CALLS].filter((s) => s.includes('.')).map((s) => s.split('.')[0]));
/** An API object the scan cannot find (a file not read, a snippet) counts when its name speaks of member content. */
const MEMBER_API_NAME = /^\w*(community|space|chat|dm|message|voice|post|comment|inbox|thread|reply|removedRows|wins|broadcast)\w*Api$/i;
/** A read by its verb; anything else on a member API is a send. */
const READ_VERB = /^(get|list|fetch|search|load|read|peek|find|count|unread|poll)/i;
/**
 * A raw member-content route on services/api: the first argument's text. FR-911R3 (LS-911R3 B1, LO-911R3 B2): a route
 * is named by what it reaches, so a parameter is any one segment (`/coach/clients/client-1/messages` and
 * `/coach/clients/${id}/messages` are one route), and the reads behind the KNOWN GAP and registered rows that have no
 * community or messages path are routes here too: the command center inbox (each client's last_message_preview) and the
 * notification rows (a row can quote a message). My own notification settings carry no member words.
 */
/** one path segment: literal text or a part the scan cannot read (`${?}`) */
const SEG = '(\\$\\{\\?\\}|[^/?$])+';
const MEMBER_ROUTES = [
  'community', 'messages', 'nudges', 'coach/messages', `coach/clients/${SEG}/(messages|nudges)`, 'coach/command-center/inbox',
  'notifications(?!/(preferences|timezone)(/|\\?|$))',
];
const MEMBER_PATH = new RegExp(`^/(${MEMBER_ROUTES.join('|')})(/|\\?|$|\\$\\{)`);
const WIRE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);
/** A send of member words: a POST, PUT or PATCH into a collection of them (not a mark, a block, a report or a delete).
 * FR-911R3 (LS-911R3 B1): a coach's nudge to a client (/coach/clients/:id/nudges) is a send, and a PATCH or PUT of one
 * row (/messages/:id, /community/posts/:id: an edit of member words) is a send unless its last segment is an action
 * that carries no words (SEND_ACTIONS). */
const SEND_PATH = /\/(posts|comments|messages|dms?|threads|voice-notes|voice|reactions|chat|wins|replies|notes|nudges)\/?(\?.*)?$/;
const EDIT_PATH = /\/(posts|comments|messages|dms?|threads|voice-notes|voice|chat|wins|replies|notes|nudges)\/([^/?]+)\/?(\?.*)?$/;
const SEND_ACTIONS = /^(read|mark-all-read|mark-read|seen|report|mute|unmute|pin|unpin|inbox-pin|block|unblock|archive|unarchive|hide|unhide|dismiss)$/;
const isSend = (verb: string | null, text: string) => {
  if (SEND_PATH.test(text)) return true;
  const m = EDIT_PATH.exec(text);
  return !!m && (verb === 'patch' || verb === 'put' || verb === null) && !SEND_ACTIONS.test(m[2]);
};
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
/** alias: `const wire = api`, `const Draft = Parts['IndependentDraft']` (a name bound to an imported thing, followed). */
type Binding = { from: string; name: string } | { ns: string } | { obj: string; prop: string } | { lazy: string } | { alias: ts.Expression };
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
  /** every `const` name in the file -> its initializers (a path held in a const is read through it) */
  consts: Map<string, ts.Expression[]>;
};

const parsed = new Map<string, { text: string; info: ModInfo }>();
function modInfo(file: string, text: string): ModInfo {
  const hit = parsed.get(file);
  if (hit && hit.text === text) return hit.info;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const info: ModInfo = { sf, bindings: new Map(), exports: new Map(), stars: [], decls: new Map(), declared: new Set(), consts: new Map() };
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
  /** `api`, `Parts.X`, `Parts['X']` where the first name is already bound to an import: an alias the scan follows */
  const aliasOfBound = (e: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    if (ts.isIdentifier(e)) return info.bindings.has(e.text);
    if (ts.isPropertyAccessExpression(e)) return aliasOfBound(e.expression);
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return aliasOfBound(e.expression);
    return false;
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
      // require('m').Feed and require('m')['Feed']
      const propName = init && ts.isPropertyAccessExpression(init) ? init.name.text
        : init && ts.isElementAccessExpression(init) && ts.isStringLiteralLike(init.argumentExpression) ? init.argumentExpression.text : null;
      const propSpec = propName !== null && init && (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init)) ? specOf(init.expression) : null;
      if (ts.isIdentifier(n.name) && init && ts.getCombinedNodeFlags(n) & ts.NodeFlags.Const) {
        info.consts.set(n.name.text, [...(info.consts.get(n.name.text) ?? []), init]);
      }
      if (propSpec && propName !== null && ts.isIdentifier(n.name)) info.bindings.set(n.name.text, { from: propSpec, name: propName });
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
      } else if (ts.isIdentifier(n.name) && init && !info.bindings.has(n.name.text) && aliasOfBound(init)) {
        info.bindings.set(n.name.text, { alias: init });
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

/** mute: false reads a via row's parts as they are (the stale check: does the via file still draw them?). */
/** byName: false drops the signs (COMPOSER_CALLS, LIST_CALLS, an API object's name) and byPlace: false the file-name
 * rule (MEMBER_PLACE), so a check can ask what the scan finds by the reads and sends alone (FR-911R3, LO-911R3 B2). */
/** scope (FIX-911R4, LO-911R4 B1): where the scan is now, for muted(): the file and the kinds whose via parts read as
 * empty here (a via file's own root, an export its via row stops, or a local those reach); anywhere else, none. */
type MuteScope = { file: string; kinds: Kind[] };
type ScanCtx = { files: Map<string, string>; memo: Map<string, Kinds>; busy: Set<string>; mute?: boolean; byName?: boolean; byPlace?: boolean; scope?: MuteScope };
const inPlace = (ctx: ScanCtx, mod: string) => ctx.byPlace !== false && MEMBER_PLACE.test(mod);
/** FR-911R3 (LS-911R3 B2): code the bundler resolves is read here too (a .js / .jsx module, a platform file), so the
 * fail-closed rule for a module the scan cannot read is left to what is really not there. */
const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx'];
const PLATFORMS = ['', '.native', '.ios', '.android'];
function resolveSpec(ctx: ScanCtx, from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return `pkg:${spec}`;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const tries = [base, ...[base, `${base}/index`].flatMap((b) => PLATFORMS.flatMap((p) => CODE_EXTS.map((x) => `${b}${p}${x}`)))];
  for (const c of tries) if (ctx.files.has(c)) return c;
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
  // FR-911R3 (LS-911R3 B2): a name no read export holds may come from an `export *` of code the scan cannot read
  const unread = info.stars.find((s) => !resolveSpec(ctx, mod, s) && isCodeSpec(s));
  if (unread && !info.decls.has(name)) return { mod: null, name, spec: unread };
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
  if (b && 'alias' in b) return (depth < 12 && originOf(ctx, mod, b.alias, depth + 1)) || { mod: null, name: local };
  if (info.decls.has(local)) return { mod, name: local };
  return { mod: null, name: local };
}

/** a namespace (import * as, await import(), require(), .then((m) => ...)) or import()/require() call: its spec */
function nsSpecOf(info: ModInfo, e: ts.Expression): string | null {
  while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) { const b = info.bindings.get(e.text); return b && 'ns' in b ? b.ns : null; }
  if (ts.isCallExpression(e) && e.arguments.length && ts.isStringLiteralLike(e.arguments[0]) &&
    (e.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e.expression) && e.expression.text === 'require'))) return e.arguments[0].text;
  return null;
}
/** Where the thing an expression names was declared: a name, X.m, X['m'] (a literal key), followed through bindings. */
function originOf(ctx: ScanCtx, mod: string, e: ts.Expression, depth = 0): Origin | null {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (depth > 12) return null;
  if (ts.isIdentifier(e)) return resolveLocal(ctx, mod, e.text, depth + 1);
  const prop = ts.isPropertyAccessExpression(e) ? e.name.text
    : ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression) ? e.argumentExpression.text : null;
  if (prop !== null && (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e))) {
    const spec = nsSpecOf(infoOf(ctx, mod), e.expression);
    if (spec) return resolveExport(ctx, resolveSpec(ctx, mod, spec), prop, spec, depth + 1);
    const o = originOf(ctx, mod, e.expression, depth + 1);
    return o ? { ...o, name: `${o.name}.${prop}` } : null;
  }
  return null;
}
/** A relative module of code (not an image, a font, a sound or JSON): one the scan cannot read is a member place unread. */
const isCodeSpec = (spec: string) => spec.startsWith('.') && !/\.(png|jpe?g|gif|webp|svg|json|ttf|otf|mp3|mp4|wav|m4a|aac|caf|lottie|html|css|txt|md)$/i.test(spec);
/** Everything a whole module holds (a namespace used as a value, an import() or require() whose use is not followed):
 * the kinds of all its exports; a relative module of code the scan cannot read counts as both (fail closed). */
function moduleKinds(ctx: ScanCtx, mod: string, spec: string): Kinds {
  const k = NONE();
  const m = resolveSpec(ctx, mod, spec);
  if (m && !m.startsWith('pkg:')) for (const name of exportNames(ctx, m)) add(k, declKinds(ctx, resolveExport(ctx, m, name, spec)));
  // FR-911R3 (LS-911R3 B2): a barrel the scan reads that passes on (export *) code it cannot read holds anything
  if (m && !m.startsWith('pkg:') && unreadStar(ctx, m)) add(k, { composer: true, list: true });
  if (!m && isCodeSpec(spec)) add(k, { composer: true, list: true });
  return muted(ctx, mod, m, k);
}
/** Exported names of a module, with `export *` followed. */
function exportNames(ctx: ScanCtx, mod: string, seen = new Set<string>()): string[] {
  if (seen.has(mod)) return [];
  seen.add(mod);
  const info = infoOf(ctx, mod);
  const out = [...info.exports.keys()];
  for (const s of info.stars) { const m = resolveSpec(ctx, mod, s); if (m && !m.startsWith('pkg:')) out.push(...exportNames(ctx, m, seen).filter((n) => n !== 'default')); }
  return out;
}
/** An `export *` of code the scan cannot read, here or in a barrel this one passes on (any depth). */
function unreadStar(ctx: ScanCtx, mod: string, seen = new Set<string>()): boolean {
  if (seen.has(mod)) return false;
  seen.add(mod);
  return infoOf(ctx, mod).stars.some((s) => {
    const m = resolveSpec(ctx, mod, s);
    return m ? !m.startsWith('pkg:') && unreadStar(ctx, m, seen) : isCodeSpec(s);
  });
}

/** The kinds a declaration's own body holds (followed into what it calls), less the kinds its file's own row proves. */
function declKinds(ctx: ScanCtx, o: Origin): Kinds {
  // FR-911R3 (LS-911R3 B2): a name re-exported from code the scan cannot read (export { Feed } from './Unread') holds anything
  if (unreadCode(o)) return { composer: true, list: true };
  if (!o.mod || o.mod.startsWith('pkg:')) return NONE();
  if (notContent(o)) return NONE();
  // FR-911R2 (LO-911R2 B1): a row stops only the exports it proves, never a whole file; a KNOWN GAP row stops nothing
  const stops = (exports?: string[]) => stoppedLocals(ctx, o.mod as string, exports).has(o.name.split('.')[0]);
  // FIX-911R4 (LO-911R4 B1): a via row's parts read as empty only in the exports the row stops (and the locals they
  // reach, so a local reached from the via file's root or a stopped export keeps the scope it was reached from); any
  // other export of a via file carries its parts' kinds on to its callers
  const prev = ctx.scope;
  const scope: MuteScope = { file: o.mod, kinds: (['composer', 'list'] as Kind[]).filter((kind) => (prev?.file === o.mod && prev.kinds.includes(kind)) ||
    REGISTRY.some((s) => s.file === o.mod && s.kind === kind && s.proof.by === 'via' && stops(s.exports))) };
  const key = `${o.mod}:${o.name}${scope.kinds.length ? `|muted:${scope.kinds.join(',')}` : ''}`;
  const memo = ctx.memo.get(key);
  if (memo) return memo;
  if (ctx.busy.has(key)) return NONE();
  const node = infoOf(ctx, o.mod).decls.get(o.name);
  if (!node) return NONE();
  ctx.busy.add(key);
  ctx.scope = scope;
  let k: Kinds;
  try { k = nodeKinds(ctx, o.mod, node); } finally { ctx.scope = prev; ctx.busy.delete(key); }
  for (const kind of ['composer', 'list'] as Kind[]) {
    // FR-911R3: nor does a via row: what its file holds through its parts is read as empty there (muted), the rest goes on
    if (REGISTRY.some((s) => s.file === o.mod && s.kind === kind && !['host', 'gap', 'via'].includes(s.proof.by) && stops(s.exports))) k[kind] = false;
    if (EXEMPT.some((e) => e.file === o.mod && e.kinds.includes(kind) && !e.passes && stops(e.exports))) k[kind] = false;
  }
  ctx.memo.set(key, k);
  return k;
}

/** The declarations a row stops: the exports it names (`exports`), else the file's default export and the export named
 * like the file (CoachInboxV2.tsx: CoachInboxV2). Any other export of the file carries its kinds on to its callers. */
function stoppedLocals(ctx: ScanCtx, file: string, exports?: string[]): Set<string> {
  const out = new Set<string>();
  if (!ctx.files.has(file)) return out;
  const info = infoOf(ctx, file);
  for (const n of exports ?? ['default', path.posix.basename(file).replace(/\.tsx?$/, '')]) {
    const e = info.exports.get(n);
    if (e && 'local' in e) out.add(e.local);
  }
  return out;
}

/** The src files a file imports (import, export from, import(), require(), lazy()). */
function importsOf(ctx: ScanCtx, file: string): Set<string> {
  const out = new Set<string>();
  for (const b of infoOf(ctx, file).bindings.values()) {
    const spec = 'from' in b ? b.from : 'ns' in b ? b.ns : 'lazy' in b ? b.lazy : null;
    const m = spec ? resolveSpec(ctx, file, spec) : null;
    if (m) out.add(m);
  }
  return out;
}

/** What a use of `o` (called, drawn, or a method taken) names. */
/** how: 'value' is a name passed on (a component to createElement, a function to queryFn): it counts as drawn and called. */
function kindsOfUse(ctx: ScanCtx, mod: string, o: Origin, how: 'call' | 'jsx' | 'value', followLocal: boolean): Kinds {
  const k = NONE();
  const [obj, method] = o.name.includes('.') ? [o.name.slice(0, o.name.lastIndexOf('.')), o.name.slice(o.name.lastIndexOf('.') + 1)] : [null, null];
  if (notContent(o)) return k;
  const drawn = how !== 'call';
  if (drawn && COMPOSER_PARTS.has(o.name)) k.composer = true;
  const byName = ctx.byName !== false;
  if (byName && how !== 'jsx' && COMPOSER_CALLS.has(o.name)) k.composer = true;
  if (byName && how !== 'jsx' && LIST_CALLS.has(o.name)) k.list = true;
  if (drawn && LIST_PARTS.has(o.name) && inPlace(ctx, mod)) k.list = true;
  if (how === 'call' && o.name === 'useInfiniteQuery' && inPlace(ctx, mod)) k.list = true;
  // a method of a member API the scan cannot read (no file, or not a method it can find): by its verb (fail closed)
  const unread = (!o.mod && !infoOf(ctx, mod).declared.has(obj ?? '')) || (!!o.mod && !o.mod.startsWith('pkg:') && !infoOf(ctx, o.mod).decls.has(o.name));
  if (byName && obj && method && unread && (MEMBER_APIS.has(obj) || MEMBER_API_NAME.test(obj))) {
    if (READ_VERB.test(method)) k.list = true; else k.composer = true;
  }
  if (o.mod && (o.mod !== mod || followLocal)) add(k, declKinds(ctx, o));
  // FR-911R3 (LS-911R3 B2): fail closed: anything bound from a relative code module the scan cannot read (an import,
  // require() destructured or picked, import().then(({ X }) => ...), await import(), lazy()), in any folder
  if (unreadCode(o)) add(k, { composer: true, list: true });
  // FR-911R3 (LS-911R3 B1): a method of services/api passed on as a value (queryFn: load, fetcher(api.get)): by its verb
  if (how === 'value') add(k, byVerb(wireVerb(ctx, mod, o), false));
  return muted(ctx, mod, o.mod, k);
}
/** A use of a module that the scan cannot read, and that is code (not an image, a font, JSON): it may hold anything. */
const unreadCode = (o: Origin) => !o.mod && !!o.spec && isCodeSpec(o.spec);
/** What a wire verb sends or reads when its path is not read: GET / HEAD a list, POST / PUT / PATCH a composer, a verb
 * not read (request(config), api[verb]) both; DELETE and OPTIONS carry no words. `none`: not a wire method at all. */
function byVerb(verb: string | null, unreadVerb: boolean): Kinds {
  if (verb === null) return unreadVerb ? { composer: true, list: true } : NONE();
  if (verb === 'get' || verb === 'head') return { composer: false, list: true };
  if (verb === 'request') return { composer: true, list: true };
  if (verb === 'delete' || verb === 'options') return NONE();
  return { composer: true, list: false };
}
/**
 * FR-911R3 (LS-911R3 B3, LO-911R3 B1): a via row proves only the parts it names. In the via row's own file, what a use
 * of one of its parts holds (for the row's kind) is the part's, shown by the part's KNOWN GAP row, so it is read as
 * empty; everything else the file holds (a composer or list it draws, reads or sends itself) stays, so the file is named
 * for it (registered() never counts a via row) and the callers of the file are named for it too.
 */
function muted(ctx: ScanCtx, mod: string, target: string | null, k: Kinds): Kinds {
  if (ctx.mute === false || !target) return k;
  // FIX-911R4 (LO-911R4 B1): only where the scope mutes this kind (the via file's root, an export its row stops)
  const here = (kind: Kind) => ctx.scope?.file === mod && ctx.scope.kinds.includes(kind);
  for (const kind of ['composer', 'list'] as Kind[]) if (k[kind] && here(kind) && viaParts(mod, kind).includes(target)) k[kind] = false;
  return k;
}
const viaParts = (file: string, kind: Kind): string[] =>
  REGISTRY.flatMap((s) => (s.file === file && s.kind === kind && s.proof.by === 'via' ? s.proof.parts : []));

/** The kinds a node holds: everything in it that is called, drawn, sent on the wire, or a member API method taken. */
function nodeKinds(ctx: ScanCtx, mod: string, root: ts.Node): Kinds {
  const info = infoOf(ctx, mod);
  const k = NONE();
  const followLocal = root !== info.sf;
  const origin = (e: ts.Expression) => originOf(ctx, mod, e);
  const tagName = (t: ts.JsxTagNameExpression): Origin | null => (ts.isIdentifier(t) || ts.isPropertyAccessExpression(t) ? origin(t as ts.Expression) : null);
  /** an API object (or namespace) whose method is picked by a key the scan cannot read: every method it has, or by name */
  const anyMethod = (base: ts.Expression): Kinds => {
    const spec = nsSpecOf(info, base);
    if (spec) return moduleKinds(ctx, mod, spec);
    const o = origin(base);
    const out = NONE();
    if (!o) return out;
    const last = o.name.split('.').pop() as string;
    if (MEMBER_APIS.has(last) || MEMBER_API_NAME.test(last)) add(out, { composer: true, list: true });
    if (o.mod && !o.mod.startsWith('pkg:')) {
      for (const d of infoOf(ctx, o.mod).decls.keys()) if (d.startsWith(`${o.name}.`)) add(out, declKinds(ctx, { mod: o.mod, name: d }));
    }
    return out;
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')) {
        const a = n.arguments[0];
        if (!a || !ts.isStringLiteralLike(a)) add(k, { composer: true, list: true }); // fail closed: cannot follow
        // fail closed: an import() or require() whose use the scan does not follow counts as all its module holds, and
        // one of a relative code module the scan cannot read counts as both (FR-911R2, LS-911R2)
        else if (!usedAsBinding(n)) add(k, moduleKinds(ctx, mod, a.text));
      } else {
        const o = origin(n.expression);
        if (o) add(k, kindsOfUse(ctx, mod, o, 'call', followLocal));
        add(k, wireKinds(ctx, mod, n));
      }
    }
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
      // a member API method taken without a call (queryFn: communityApi.listPosts), or a part of a namespace passed on
      // (React.createElement(Parts.Draft), Parts['Draft'])
      const o = origin(n);
      if (o && (o.name.includes('.') || nsSpecOf(info, n.expression))) add(k, kindsOfUse(ctx, mod, o, 'value', followLocal));
    }
    if (ts.isElementAccessExpression(n) && !ts.isStringLiteralLike(n.argumentExpression)) {
      // fail closed: a method picked by a key the scan cannot read (communityApi[name], Parts[name])
      add(k, anyMethod(n.expression));
    }
    if (ts.isIdentifier(n) && isReference(n) && info.bindings.has(n.text)) {
      const b = info.bindings.get(n.text) as Binding;
      if ('ns' in b) {
        // a whole namespace passed on (return parts; register(Parts)): it holds all its module holds
        add(k, moduleKinds(ctx, mod, b.ns));
      } else {
        // an imported function or component passed on, not called or drawn here (queryFn: fetchInboxTriage): it counts
        const o = resolveLocal(ctx, mod, n.text);
        if (o.mod !== mod) add(k, kindsOfUse(ctx, mod, o, 'value', followLocal));
      }
    } else if (ts.isIdentifier(n) && isReference(n) && followLocal && info.decls.has(n.text)) {
      // FR-911R3 (F2): a function of this file passed on from inside a declaration ({ latest }, { list: listImpl },
      // queryFn: load): a service object's method is what its function's body reaches
      add(k, kindsOfUse(ctx, mod, { mod, name: n.text }, 'value', true));
    }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const o = tagName(n.tagName);
      if (o) add(k, kindsOfUse(ctx, mod, o, 'jsx', followLocal));
      if (o?.name === 'TextInput' && inPlace(ctx, mod)) k.composer = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return k;
}

const AXIOS_VERBS = new Set(['get', 'head', 'options', 'delete', 'post', 'put', 'patch']);
/** What a name or X.m stands for: its const initializer, object property or function (here, a local const, or imported). */
function defsOf(ctx: ScanCtx, mod: string, e: ts.Expression): { mod: string; node: ts.Node }[] {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  const info = infoOf(ctx, mod);
  if (ts.isIdentifier(e) && !info.bindings.has(e.text) && !info.decls.has(e.text)) return (info.consts.get(e.text) ?? []).map((node) => ({ mod, node }));
  const o = originOf(ctx, mod, e);
  if (!o || !o.mod || o.mod.startsWith('pkg:')) return [];
  const d = infoOf(ctx, o.mod).decls.get(o.name);
  if (!d) return [];
  if (ts.isVariableDeclaration(d)) return d.initializer && ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const ? [{ mod: o.mod, node: d.initializer }] : [];
  if (ts.isPropertyAssignment(d)) return [{ mod: o.mod, node: d.initializer }];
  return [{ mod: o.mod, node: d }];
}
/** The expressions a function returns (an arrow's body, or each `return` not inside a nested function). */
function returnsOf(f: ts.Node): ts.Expression[] {
  if (ts.isArrowFunction(f) && !ts.isBlock(f.body)) return [f.body];
  if (!(ts.isArrowFunction(f) || ts.isFunctionExpression(f) || ts.isFunctionDeclaration(f) || ts.isMethodDeclaration(f)) || !f.body) return [];
  const out: ts.Expression[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    if (!ts.isFunctionLike(n)) ts.forEachChild(n, walk);
  };
  ts.forEachChild(f.body, walk);
  return out;
}
const UNREAD = '${?}';
/**
 * Every text a path can have, as far as the scan can read it: literals, templates, `+` joins, `a ? b : c` and `a ?? b`,
 * a const (here or imported), an object's property (COPILOT_PATHS.recent) and what a path function returns
 * (threadBase(scope), draftUrl(id)); a part it cannot read is `${?}`.
 */
function pathAlts(ctx: ScanCtx, mod: string, e: ts.Expression, depth = 0): string[] {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  if (depth > 10) return [UNREAD];
  const cross = (parts: string[][]) => {
    const out = parts.reduce((acc, ps) => acc.flatMap((x) => ps.map((y) => x + y)), ['']);
    return out.length > 32 ? [UNREAD] : [...new Set(out)];
  };
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) return cross([[e.head.text], ...e.templateSpans.flatMap((sp) => [pathAlts(ctx, mod, sp.expression, depth + 1), [sp.literal.text]])]);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return cross([pathAlts(ctx, mod, e.left, depth + 1), pathAlts(ctx, mod, e.right, depth + 1)]);
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) {
    return [...new Set([...pathAlts(ctx, mod, e.left, depth + 1), ...pathAlts(ctx, mod, e.right, depth + 1)])];
  }
  if (ts.isConditionalExpression(e)) return [...new Set([...pathAlts(ctx, mod, e.whenTrue, depth + 1), ...pathAlts(ctx, mod, e.whenFalse, depth + 1)])];
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
    const defs = defsOf(ctx, mod, e);
    return defs.length ? [...new Set(defs.flatMap((d) => (ts.isExpression(d.node) && !ts.isFunctionLike(d.node) ? pathAlts(ctx, d.mod, d.node, depth + 1) : [UNREAD])))] : [UNREAD];
  }
  if (ts.isCallExpression(e)) {
    const fns = defsOf(ctx, mod, e.expression).map((d) => ({ mod: d.mod, rets: returnsOf(d.node) })).filter((f) => f.rets.length);
    return fns.length ? [...new Set(fns.flatMap((f) => f.rets.flatMap((r) => pathAlts(ctx, f.mod, r, depth + 1))))] : [UNREAD];
  }
  return [UNREAD];
}
/** services/api, its default export, or (a file not read, a snippet) a free name like one. */
function isWireClient(ctx: ScanCtx, mod: string, o: Origin | null): boolean {
  if (!o) return false;
  if (o.mod === 'services/api.ts') return /^(default|api)$/.test(o.name);
  return !o.mod && /^(api|apiClient|http|client)$/.test(o.name) && !infoOf(ctx, mod).declared.has(o.name);
}
/** FR-911R3 (LS-911R3 B1): the verb of a services/api method kept under another name (`const load = api.get`,
 * `const { get: load } = api`, `api.request` held) or passed on as a value (`queryFn: load`): its origin is the
 * client's method (`default.get`), not a name of its own. null: not a method of the client. */
function wireVerb(ctx: ScanCtx, mod: string, o: Origin | null): string | null {
  if (!o || !o.name.includes('.')) return null;
  const i = o.name.lastIndexOf('.');
  const verb = o.name.slice(i + 1);
  if (!AXIOS_VERBS.has(verb) && verb !== 'request') return null;
  return isWireClient(ctx, mod, { ...o, name: o.name.slice(0, i) }) ? verb : null;
}
/**
 * A raw call on services/api: api.get(path), api['get'](path), api[verb](path), api.request({ method, url }), api(config),
 * through any alias. A readable member path counts by its verb (a GET is a list; a POST / PUT / PATCH into SEND_PATH a
 * composer). FR-911R2 (LO-911R2 B3, LS-911R2): a path the scan cannot read fails closed, by its verb: GET / HEAD a list,
 * POST / PUT / PATCH a composer, an unread verb both; DELETE and OPTIONS carry no words either way.
 */
function wireKinds(ctx: ScanCtx, mod: string, n: ts.CallExpression): Kinds {
  const k = NONE();
  let c: ts.Expression = n.expression;
  while (ts.isParenthesizedExpression(c) || ts.isNonNullExpression(c)) c = c.expression;
  let client: ts.Expression = c;
  let verb: string | null = 'request';
  // FR-911R3: the callee's own origin first, so a method of the client under any name (load(url)) is that method
  const held = wireVerb(ctx, mod, originOf(ctx, mod, c));
  if (held) verb = held;
  else {
    if (ts.isPropertyAccessExpression(c)) { client = c.expression; verb = c.name.text; }
    else if (ts.isElementAccessExpression(c)) { client = c.expression; verb = ts.isStringLiteralLike(c.argumentExpression) ? c.argumentExpression.text : null; }
    if (!isWireClient(ctx, mod, originOf(ctx, mod, client))) return k;
  }
  let url: ts.Expression | undefined = n.arguments[0];
  if (verb === 'request') {
    const cfg = n.arguments[0];
    url = undefined;
    verb = null;
    if (cfg && ts.isObjectLiteralExpression(cfg)) {
      // FR-911R3 (LS-911R3 B1): a quoted key ({ 'method': 'post', 'url': ... }) is the same key
      const prop = (name: string) => cfg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && !!p.name &&
        (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === name)?.initializer;
      const m = prop('method');
      // a key the scan cannot read ([key]: value) may be the method or the url: as a spread, unread
      const spread = cfg.properties.some((p) => !ts.isPropertyAssignment(p) || ts.isComputedPropertyName(p.name));
      verb = m ? (ts.isStringLiteralLike(m) ? m.text.toLowerCase() : null) : spread ? null : 'get';
      url = prop('url');
    }
  } else if (verb !== null && !AXIOS_VERBS.has(verb)) return k;
  for (const text of url ? pathAlts(ctx, mod, url) : [UNREAD]) {
    if (!text.startsWith(UNREAD)) {
      // a path the scan can read
      if (!MEMBER_PATH.test(text)) continue;
      if (verb === 'get' || verb === 'head') k.list = true;
      else if (verb === null) { k.list = true; if (isSend(verb, text)) k.composer = true; }
      else if (verb !== 'delete' && verb !== 'options' && isSend(verb, text)) k.composer = true;
      continue;
    }
    // fail closed: its start cannot be read
    if (verb === 'get' || verb === 'head') k.list = true;
    else if (verb === null) add(k, { composer: true, list: true });
    else if (verb !== 'delete' && verb !== 'options') k.composer = true;
  }
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
  if (ts.isElementAccessExpression(p) && ts.isStringLiteralLike(p.argumentExpression)) return true; // require(m)['Feed']
  if (ts.isArrowFunction(p) && ts.isCallExpression(p.parent) && /^(React\.)?lazy$/.test(p.parent.expression.getText())) return true;
  return false;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.name === '__tests__' || e.name === '__mocks__' || e.name === 'node_modules' || /\.(test|spec)\./.test(e.name)) return [];
    if (e.isDirectory()) return sourceFiles(full);
    return /\.[jt]sx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [full] : [];
  });
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');

function scanCtx(extra: Record<string, string> = {}, opts: { mute?: boolean; byName?: boolean; byPlace?: boolean } = {}): ScanCtx {
  const files = new Map(sourceFiles(SRC).map((f) => [rel(f), fs.readFileSync(f, 'utf8')] as const));
  for (const [f, t] of Object.entries(extra)) files.set(f, t);
  return { files, memo: new Map(), busy: new Set(), ...opts };
}
/** What one file holds, read against src/ as it is (`text` stands in for the file, which need not exist). */
function classify(file: string, text: string, ctx: ScanCtx = scanCtx({ [file]: text })): Kinds {
  if (ctx.files.get(file) !== text) ctx.files.set(file, text);
  // FIX-911R4 (LO-911R4 B1): the file's own root is where its via rows' parts read as empty
  const prev = ctx.scope;
  ctx.scope = { file, kinds: ['composer', 'list'] };
  try { return nodeKinds(ctx, file, infoOf(ctx, file).sf); } finally { ctx.scope = prev; }
}
function scan(ctx: ScanCtx = scanCtx()): { composer: string[]; list: string[] } {
  const out = { composer: [] as string[], list: [] as string[] };
  for (const [file, text] of ctx.files) {
    const k = classify(file, text, ctx);
    if (k.composer) out.composer.push(file);
    if (k.list) out.list.push(file);
  }
  return out;
}

/** FR-911R3 (LO-911R3 B1): a via row registers nothing of its file's own (the scan reads its parts as empty there), so a
 * via file that holds a composer or list of its own beside its parts is named until that has its own row. */
const registered = (file: string, kind: Kind) =>
  REGISTRY.some((s) => s.file === file && s.kind === kind && s.proof.by !== 'via') || EXEMPT.some((e) => e.file === file && e.kinds.includes(kind));

it('LS-911 B2: NotificationCenter must use live proof, not the obsolete pre-898 gap', () => {
  const row = REGISTRY.find((s) => s.file === 'screens/notifications/NotificationCenterScreen.tsx' && s.kind === 'list');
  expect(row).toBeDefined();
  expect(row?.proof.by).not.toBe('gap');
});

describe('LS-911 B1: source discovery must recognize member content independent of call spelling', () => {
  // FIX-911R4 (LO-911R4 C2): the fixtures are a scanCtx overlay, never files written under src/ (other suites walk src/
  // in parallel workers and can list a file this case has already removed)
  function checkSource(kind: Kind, source: string, shared = false) {
    const dir = 'screens/LS911Inventory-fixture';
    const file = `${dir}/Fixture.tsx`;
    const overlay: Record<string, string> = { [file]: source };
    if (shared) overlay[`${dir}/SharedReply.tsx`] = "export { ComposerInput as MemberReply } from '../../components/community';";
    expect(fs.existsSync(path.join(SRC, file))).toBe(false);
    expect(registered(file, kind)).toBe(false);
    expect(scan(scanCtx(overlay))[kind]).toContain(file);
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
    // FR-911R3: a via file holds its kind through its parts, which the inventory reads as empty there: read them as they are
    const whole = scan(scanCtx({}, { mute: false }));
    const holds = (s: Surface) => (s.proof.by === 'via' ? whole : found)[s.kind].includes(s.file);
    const stale = [
      ...REGISTRY.filter((s) => !fs.existsSync(path.join(SRC, s.file)) || !holds(s)).map((s) => `${s.kind} ${s.file}`),
      ...EXEMPT.flatMap((e) => e.kinds.filter((k) => !found[k].includes(e.file)).map((k) => `exempt ${k} ${e.file}`)),
    ];
    expect(stale).toEqual([]);
  });

  it('every row has a proof that is still in the suite', () => {
    const ctx = scanCtx();
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
      if (p.by === 'via') {
        for (const part of p.parts) {
          if (!REGISTRY.some((h) => h.file === part && h.kind === s.kind && (h.proof.by === 'gap' || h.proof.by === 'via'))) problems.push(`${s.file}: part ${part} has no KNOWN GAP or via row (${s.kind})`);
          if (!importsOf(ctx, s.file).has(part)) problems.push(`${s.file}: does not import its part ${part}`);
        }
        // FR-911R3 (LO-911R3 B1): with its parts read as empty, a via file holds nothing of this kind of its own (or has
        // its own row for it)
        if (classify(s.file, read(s.file), ctx)[s.kind] && !registered(s.file, s.kind)) problems.push(`${s.file}: holds a ${s.kind} of its own beside its parts (give it its own row)`);
      }
    }
    // FR-911R2: a row stops only the exports it names, so each must be an export of its file
    for (const r of [...REGISTRY, ...EXEMPT]) for (const e of r.exports ?? []) if (!infoOf(ctx, r.file).exports.has(e)) problems.push(`${r.file}: no export ${e}`);
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
  // FR-911R2 (LO-911R2 B2): useNudges(100) on Notifications; a nudge is my coach's typed title and body
  nudges: { key: ['nudges', 'list', 100], seed: [{ id: 'n-1', coach_id: BLOCKED, client_id: 'client-1', title: WORDS, body: WORDS, created_at: '2026-11-01T10:00:00.000Z', read_at: null }], check: 'dropped' },
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
    // FIX-933R4: useLookupNudge's row is a proof now (it stops its callers), so the second gap part is the wins screen.
    ['CommunityScreen (its row is a KNOWN GAP)', "import CommunityScreen from './CommunityScreen';", 'return <CommunityScreen />;'],
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

describe('LS-911R3 B1: raw wire origins and member URLs cannot disappear', () => {
  const host = 'screens/client/SolAccessProbe.tsx';
  const head = "import api from '../../services/api';\n";
  it.each([
    ['extracted raw GET', `${head}const load = api.get; export const read = (url: string) => load(url);`, 'list'],
    ['destructured raw GET', `${head}const { get: load } = api; export const read = (url: string) => load(url);`, 'list'],
    ['extracted raw POST', `${head}const send = api.post; export const write = (url: string, body: unknown) => send(url, body);`, 'composer'],
    ['literal coaching member URL', `${head}export const read = () => api.get('/coach/clients/client-1/messages');`, 'list'],
    ['quoted request config', `${head}export const send = () => api.request({ 'method': 'post', 'url': '/community/posts', data: { body: 'hello' } });`, 'composer'],
  ] as const)('%s cannot silently disappear', (_label, text, kind) => {
    expect(classify(host, text)[kind]).toBe(true);
  });
  it.each([
    ['literal wire read', `${head}export const read = () => api.get('/community/posts');`, 'list'],
    ['HEAD with unread URL', `${head}export const read = (url: string) => api.head(url);`, 'list'],
  ] as const)('positive control %s', (_label, text, kind) => {
    expect(classify(host, text)[kind]).toBe(true);
  });
  it.each(['delete', 'options'])('%s with unread URL is not a content read', (verb) => {
    const kinds = classify(host, `${head}export const call = (url: string) => api.${verb}(url);`);
    expect(kinds).toEqual({ composer: false, list: false });
  });
});

describe('LS-911R3 B2: unread code modules fail closed in every binding form', () => {
  const host = 'screens/client/SolModuleProbe.tsx';
  it.each([
    ['require destructuring', "const { Feed } = require('../settings/SolUnreadModule'); export const draw = () => Feed();"],
    ['import then destructuring', "export const load = () => import('../settings/SolUnreadModule').then(({ Feed }) => Feed());"],
    ['lazy default', "import React from 'react'; const Feed = React.lazy(() => import('../settings/SolUnreadModule')); export const Host = () => <Feed />;"],
    ['require property', "const Feed = require('../settings/SolUnreadModule').Feed; export const draw = () => Feed();"],
    ['require literal element', "const Feed = require('../settings/SolUnreadModule')['Feed']; export const draw = () => Feed();"],
    ['await import named property', "export const load = async () => { const { Feed } = await import('../settings/SolUnreadModule'); return Feed(); };"],
    ['computed template control', "export const load = (name: string) => import(`../settings/${name}`);"],
    ['namespace returned control', "export const load = () => { const mod = require('../settings/SolUnreadModule'); return mod; };"],
    ['plain import control', "export const load = () => import('../settings/SolUnreadModule');"],
  ])('%s cannot silently disappear', (_label, text) => {
    expect(classify(host, text)).toEqual({ composer: true, list: true });
  });
  it.each([
    ['star', "export * from '../SolUnreadModule';"],
    ['named', "export { Feed } from '../SolUnreadModule';"],
  ])('unread %s re-export through a readable index cannot disappear', (_label, barrel) => {
    const text = "import * as Parts from '../settings/SolProbeBarrel'; export const load = () => Parts;";
    const ctx = scanCtx({ [host]: text, 'screens/settings/SolProbeBarrel/index.ts': barrel });
    expect(classify(host, text, ctx)).toEqual({ composer: true, list: true });
  });
  it('non-code asset control is still skipped', () => {
    expect(classify(host, "export const image = require('../settings/missing.png');")).toEqual({ composer: false, list: false });
  });
});

describe('LS-911R3 B3: a via row cannot prove newly added independent content', () => {
  it('an independent composer added beside the named gap part still names its new caller', () => {
    const file = 'screens/client/ProgressScreen.tsx';
    const host = 'screens/client/SolProgressHost.tsx';
    const original = read(file).replace('export default function ProgressScreen(', 'function ExistingProgressScreen(');
    const changed = `import api from '../../services/api';
import { ComposerInput } from '../../components/community';
${original}
export default function ProgressScreen(props: ProgressProps) {
  return <><ExistingProgressScreen {...props} /><ComposerInput
    placeholder="Reply" maxLength={2000}
    onSubmit={async (body) => { await api.post('/community/workspaces/ws/posts', { body }); }}
  /></>;
}`;
    const caller = "import React from 'react'; import ProgressScreen from './ProgressScreen'; export default function SolProgressHost() { return <ProgressScreen />; }";
    const ctx = scanCtx({ [file]: changed, [host]: caller });
    const via = REGISTRY.find((s) => s.file === file && s.kind === 'composer');
    expect(via?.proof.by).toBe('via');
    if (!via || via.proof.by !== 'via') throw new Error('expected the reviewed via row');
    for (const part of via.proof.parts) {
      expect(REGISTRY.some((s) => s.file === part && s.kind === 'composer' && (s.proof.by === 'gap' || s.proof.by === 'via'))).toBe(true);
      expect(importsOf(ctx, file).has(part)).toBe(true);
    }
    expect(classify(file, changed, ctx).composer).toBe(true);
    expect(classify(host, caller, ctx).composer).toBe(true);
  });
});

// ─── LO-911R3 B1 (B-TEST, review only): a via row must not register the file's own composer or list ─────────────
// FR-911R2 gave the files that draw a gap part a via row (:277-293). `registered()` is per file and kind, so that row
// registers the whole file: a composer or list the file draws itself (not through the part) passes the inventory
// unnamed. At 06d2faeb these files had no row, so the same edit was named; this round made it silent. Smallest fix: a
// via row registers only what the file holds through its parts (classify the file with its parts read as empty: any
// kind still held is the file's own and needs its own row), and the via proof check asserts that on src as it is.
describe('LO-911R3 B1: a via row does not hide what the file draws itself', () => {
  const unnamedWith = (overlay: Record<string, string>) => {
    const ctx = scanCtx(overlay);
    const out: string[] = [];
    for (const [file, text] of ctx.files) {
      const k = classify(file, text, ctx);
      (['composer', 'list'] as Kind[]).forEach((x) => { if (k[x] && !registered(file, x)) out.push(`${x} ${file}`); });
    }
    return out;
  };
  it('ProgressScreen with its own coach note box (a ComposerInput) is named a composer', () => {
    const f = 'screens/client/ProgressScreen.tsx';
    const text = `${read(f)}\nimport { ComposerInput as CoachNoteInput } from '../../components/community';\n` +
      'export function CoachNoteBox() { return <CoachNoteInput placeholder="Note" maxLength={500} onSubmit={async () => undefined} />; }\n';
    expect(classify(f, text).composer).toBe(true);
    expect(unnamedWith({ [f]: text })).toContain(`composer ${f}`);
  });
  it('CommandCenterScreen with its own space feed (usePosts) is named a list', () => {
    const f = 'screens/coach/command-center/CommandCenterScreen.tsx';
    const text = `${read(f)}\nimport { usePosts as useSpacePosts } from '../../../hooks/useCommunity';\n` +
      "export function SpacePeek() { const q = useSpacePosts('ws-1'); return null; }\n";
    expect(classify(f, text).list).toBe(true);
    expect(unnamedWith({ [f]: text })).toContain(`list ${f}`);
  });
});

// ─── LO-911R3 B2 (B-TEST, review only): member reads named only by a file's name, never by the read ──────────────
// commandCenterApi.getInbox (services/commandCenterApi.ts:351, GET /coach/command-center/inbox) returns each client's
// last_message_preview, the read behind the InboxScreen KNOWN GAP row. It is no LIST_CALLS sign, commandCenterApi does
// not match MEMBER_API_NAME, and the path is not in MEMBER_PATH (:400), so InboxScreen is named only because its file
// name holds "Inbox" (MEMBER_PLACE). The same holds for a raw read of /notifications, whose rows the REGISTRY says can
// quote a message (NotificationCenterScreen row): fetchNotifications is a sign by name, its path is not. LO-911R2 B2 was
// this class (a member read with no sign); the fix added the nudges sign only. Smallest fix: commandCenterApi.getInbox
// as a LIST_CALLS sign, /coach/command-center/inbox and /notifications in MEMBER_PATH, and a check that the wire path of
// every LIST_CALLS / COMPOSER_CALLS sign matches MEMBER_PATH (so a sign and its path cannot drift apart again).
describe('LO-911R3 B2: a member read is named by what it reads, not by the file name', () => {
  it('a coach Home card drawing commandCenterApi.getInbox previews is named a list', () => {
    const text = "import React from 'react';\nimport { Text } from 'react-native';\nimport { useQuery } from '@tanstack/react-query';\n" +
      "import { commandCenterApi } from '../../../services/commandCenterApi';\nexport default function LatestFromClients() {\n" +
      "  const q = useQuery({ queryKey: ['cc', 'inbox'], queryFn: () => commandCenterApi.getInbox() });\n" +
      '  return <>{q.data?.data.threads.map((t) => <Text key={t.client_id}>{t.last_message_preview}</Text>)}</>;\n}\n';
    expect(classify('screens/coach/home-v11/LatestFromClients.tsx', text).list).toBe(true);
  });
  it('a raw read of the command center inbox is named a list', () => {
    const text = "import api from '../../../services/api';\nexport const readLatest = () => api.get('/coach/command-center/inbox');\n";
    expect(classify('screens/coach/home-v11/latestRead.ts', text).list).toBe(true);
  });
  it('a raw read of the notification rows is named a list', () => {
    const text = "import api from '../../../services/api';\nexport const readBell = () => api.get('/notifications?limit=20');\n";
    expect(classify('screens/coach/home-v11/bellRead.ts', text).list).toBe(true);
  });
});


// ─── FR-911R3: the other forms of each round-3 class (red at 5006d41e, green at the fix) ─────────────────────────
// F1 (LS-911R3 B3, LO-911R3 B1): a via row proves only the parts it names; anything else its file holds is named.
describe('FR-911R3 F1: a via row proves only its parts', () => {
  const unnamed = (overlay: Record<string, string>) => {
    const ctx = scanCtx(overlay);
    return [...ctx.files].flatMap(([file, text]) => {
      const k = classify(file, text, ctx);
      return (['composer', 'list'] as Kind[]).filter((x) => k[x] && !registered(file, x)).map((x) => `${x} ${file}`);
    });
  };
  it('a via row beside a second composer in the same file (WorkoutFinishSummary: ShareSheet and a note box) is named', () => {
    const f = 'screens/client/active-workout/WorkoutFinishSummary.tsx';
    const text = `${read(f)}\nimport { ReplyComposer as FinishNote } from '../../../components/community';\n` +
      'export function FinishNoteBox() { return <FinishNote onSend={async () => undefined} />; }\n';
    expect(unnamed({ [f]: text })).toContain(`composer ${f}`);
  });
  it('a via list file (CrossPillarNavigator) that reads member messages itself is named a list', () => {
    const f = 'screens/coach/cross-pillar/CrossPillarNavigator.tsx';
    const text = `${read(f)}\nimport fr911r3Api from '../../../services/api';\nexport const peekMessages = () => fr911r3Api.get('/messages?limit=1');\n`;
    expect(unnamed({ [f]: text })).toContain(`list ${f}`);
  });
  it('a via file as it is holds nothing of its own, and still holds its kind through its parts', () => {
    const f = 'screens/client/ProgressScreen.tsx';
    expect(classify(f, read(f)).composer).toBe(false);
    expect(classify(f, read(f), scanCtx({}, { mute: false })).composer).toBe(true);
  });
  it('control: a new caller of a via file as it is is not named for its parts', () => {
    const host = "import React from 'react'; import ProgressScreen from './ProgressScreen'; export default function FR911R3Host() { return <ProgressScreen />; }";
    expect(classify('screens/client/FR911R3Host.tsx', host).composer).toBe(false);
  });
});

// F2 (LS-911R3 B1, LO-911R3 B2): a member read or send is named by what it reaches, under any name.
describe('FR-911R3 F2: member reads and sends with no sign are named by what they reach', () => {
  const head = "import api from '../../services/api';\nimport { useQuery } from '@tanstack/react-query';\n";
  const host = 'screens/client/FR911R3Reads.tsx';
  it.each([
    ['a function of the service object, shorthand', "import api from './api';\nasync function latest() { return api.get('/coach/command-center/inbox'); }\nexport const fr911r3PeekApi = { latest };\n"],
    ['a function of the service object, renamed', "import api from './api';\nconst latestImpl = (id: string) => api.get(`/coach/clients/${encodeURIComponent(id)}/messages?limit=1`);\nexport const fr911r3PeekApi = { latest: latestImpl };\n"],
    ['a method that reads a client\'s thread by a literal id', "import api from './api';\nexport const fr911r3PeekApi = { latest: () => api.get('/coach/clients/c-9/messages') };\n"],
  ])('a list read through a service object the scan has not met (%s) is named', (_label, svc) => {
    const text = "import { useQuery } from '@tanstack/react-query';\nimport { fr911r3PeekApi } from '../../services/fr911r3PeekApi';\n" +
      "export const useLatest = () => useQuery({ queryKey: ['fr911r3'], queryFn: () => fr911r3PeekApi.latest('c-9') });\n";
    const ctx = scanCtx({ 'services/fr911r3PeekApi.ts': svc, [host]: text });
    expect(classify(host, text, ctx).list).toBe(true);
  });
  it.each([
    ['a held GET passed as the queryFn', `${head}const load = api.get;\nexport const useRows = () => useQuery({ queryKey: ['r'], queryFn: () => load('/community/posts') });`, 'list'],
    ['a destructured GET passed on bare', `${head}const { get } = api;\nexport const useRows = (key: string) => useQuery({ queryKey: [key], queryFn: get as never });`, 'list'],
    ['the client\'s GET passed on bare', `${head}export const useRows = (url: string) => useQuery({ queryKey: [url], queryFn: () => run(url, api.get) });\ndeclare function run(u: string, f: unknown): Promise<unknown>;`, 'list'],
    ['a held POST passed to a sender', `${head}const send = api.post;\nexport const sendWith = (go: (f: typeof send) => void) => go(send);`, 'composer'],
  ] as const)('a bound method passed as a callback (%s) is named', (_label, text, kind) => {
    expect(classify(host, text)[kind]).toBe(true);
  });
  it.each([
    ['an edit of my message', "export const edit = (id: string, body: string) => api.patch(`/messages/${id}`, { body });"],
    ['an edit of a post', "export const edit = (id: string, body: string) => api.patch(`/community/posts/${id}`, { body });"],
    ['a coach\'s nudge to a client', "export const nudge = (id: string, body: string) => api.post(`/coach/clients/${id}/nudges`, { title: 'Hi', body });"],
  ])('%s is a send', (_label, text) => {
    expect(classify(host, `${head}${text}`).composer).toBe(true);
  });
  it.each([
    ['a mark as read', "export const mark = () => api.post('/messages/read');"],
    ['a mute', "export const mute = (on: boolean) => api.put('/messages/mute', { on });"],
    ['a pin of a coach thread', "export const pin = (id: string) => api.put(`/coach/clients/${id}/messages/inbox-pin`);"],
    ['my notification settings', "export const prefs = () => api.get('/notifications/preferences');"],
    ['a held client setting that is no request', "const base = api.defaults;\nexport const where = () => base.baseURL;"],
  ])('control, not named: %s', (_label, text) => {
    const k = classify(host, `${head}${text}`);
    expect(k.composer || k.list).toBe(false);
  });
});

// F3 (LS-911R3 B2): code the scan cannot read counts as both, whatever its folder and however it is bound or passed on.
describe('FR-911R3 F3: unread code fails closed through any barrel and any binding', () => {
  const host = 'screens/client/FR911R3Mods.tsx';
  it.each([
    ['star', "export * from '../FR911R3Inner';", "export * from '../FR911R3Unread';"],
    ['named', "export { Feed } from '../FR911R3Inner';", "export { Feed } from '../FR911R3Unread';"],
  ])('a re-export two barrels deep (%s) is named', (_label, outer, inner) => {
    const text = "import React from 'react'; import { Feed } from '../settings/FR911R3Outer'; export const Host = () => <Feed />;";
    const ctx = scanCtx({ [host]: text, 'screens/settings/FR911R3Outer/index.ts': outer, 'screens/settings/FR911R3Inner/index.ts': inner });
    expect(classify(host, text, ctx)).toEqual({ composer: true, list: true });
    const ns = "import * as P from '../settings/FR911R3Outer'; export const all = () => P;";
    expect(classify(host, ns, scanCtx({ [host]: ns, 'screens/settings/FR911R3Outer/index.ts': outer, 'screens/settings/FR911R3Inner/index.ts': inner }))).toEqual({ composer: true, list: true });
  });
  it.each([
    ['a static named import', "import { Feed } from '../settings/FR911R3Unread'; export const draw = () => Feed();"],
    ['a service object from code not read', "import { fr911r3Api } from '../../services/fr911r3Missing'; export const read = () => fr911r3Api.latest();"],
  ])('%s of code the scan cannot read is named', (_label, text) => {
    expect(classify(host, text)).toEqual({ composer: true, list: true });
  });
  it.each([
    ['a readable two-deep barrel of nothing', { 'screens/settings/FR911R3Outer/index.ts': "export * from '../FR911R3Inner';", 'screens/settings/FR911R3Inner/index.ts': 'export const Feed = () => null;' }],
    ['a .js module the bundler reads', { 'screens/settings/FR911R3Outer/index.ts': "export * from '../FR911R3Inner';", 'screens/settings/FR911R3Inner/index.js': 'export function Feed() { return null; }' }],
  ])('control, not named: %s', (_label, files) => {
    const text = "import { Feed } from '../settings/FR911R3Outer'; export const draw = () => Feed();";
    expect(classify(host, text, scanCtx({ [host]: text, ...files }))).toEqual({ composer: false, list: false });
  });
});

/**
 * FR-911R3 (LO-911R3 B2, the class): a sign and the route it reads cannot drift apart. Each COMPOSER_CALLS / LIST_CALLS
 * sign whose declaration is in src/ must be named by its own body alone (signs and file names off), and each
 * registered place (not a host part or a via file) by its own reads and sends alone; a sign that is a sign by its name
 * only says why here.
 */
const SIGN_BY_NAME: Record<string, string> = {
  useMessageOutbox: 'the queue a registered coaching chat sends through; the send is services/messageOutbox (its path is the queued thread\'s)',
  'messagesApi.sendReply': 'no such method today (services/api messagesApi has send); kept so a new one of that name is named',
  'messagesModerationApi.send': 'no such method today (api/messagesApi has sendReply); kept so a new one of that name is named',
  'communityVoiceApi.issueUploadUrl': 'the first hop of a voice note send (a signed upload target); the note itself is communityVoiceApi.create',
  'communityVoiceApi.uploadBytes': 'the bytes go to signed storage by a bare axios PUT, no route; the note itself is communityVoiceApi.create',
  'broadcastsApi.create': 'one to many (/coach/broadcasts is no member route; the server picks who gets it); a sign so a broadcast composer is named and reviewed',
  useCommunityBadge: 'my own unread totals (communityApi.getMe, NOT_CONTENT); a count sign so a new badge reader is named',
  useVoiceCatchUp: 'refetches the voice feed query it is handed; the read is useVoiceFeed',
};
describe('FR-911R3 F2: every sign and every registered place is named by what it reaches', () => {
  it('each sign\'s own body reaches a member route (or SIGN_BY_NAME says why it is a sign by name)', () => {
    const ctx = scanCtx({}, { byName: false });
    const problems: string[] = [];
    for (const sign of [...COMPOSER_CALLS, ...LIST_CALLS]) {
      const kind: Kind = COMPOSER_CALLS.has(sign) ? 'composer' : 'list';
      const decls = [...ctx.files.keys()].filter((f) => infoOf(ctx, f).decls.has(sign));
      const reached = decls.some((f) => nodeKinds(ctx, f, infoOf(ctx, f).decls.get(sign) as ts.Node)[kind]);
      if (!reached && !SIGN_BY_NAME[sign]) problems.push(`${kind} ${sign}: ${decls.length ? `its body (${decls.join(', ')}) reaches no member route` : 'no declaration in src/'}`);
      if (reached && SIGN_BY_NAME[sign]) problems.push(`${sign}: reaches a member route, so its SIGN_BY_NAME row is stale`);
    }
    for (const sign of Object.keys(SIGN_BY_NAME)) if (!COMPOSER_CALLS.has(sign) && !LIST_CALLS.has(sign)) problems.push(`${sign}: SIGN_BY_NAME row of no sign`);
    expect(problems).toEqual([]);
  });
  it('each registered place is named by its own reads and sends, not by a sign or its file name', () => {
    const ctx = scanCtx({}, { byName: false, byPlace: false });
    const missed = REGISTRY.filter((s) => s.proof.by !== 'host' && s.proof.by !== 'via' && !classify(s.file, read(s.file), ctx)[s.kind]);
    expect(missed.map((s) => `${s.kind} ${s.file}`)).toEqual([]);
  });
  it('control: with signs and file names off, a plain screen and a settings read are not named', () => {
    const ctx = scanCtx({}, { byName: false, byPlace: false });
    const text = "import api from '../../services/api';\nexport const read = () => api.get('/notifications/preferences');\n";
    expect(classify('screens/client/FR911R3Plain.tsx', text, ctx)).toEqual({ composer: false, list: false });
  });
});

// ─── LO-911R4 B1 (B-TEST, review only): a via row's muting must not hide a new drawer of its gap part ─────────────
// FR-911R3 F1 replaced the via row's per-export stop with muted() (:810): in a via file, every use of a part is read as
// empty for the row's kind, in every declaration of the file, so the muting rides out on any export of the via file. A
// new export of a via file that wraps the gap part (ProgressScreen's ShareSheet, CommandCenterScreen's InboxScreen),
// drawn on a new screen, leaves that screen unnamed. At 095906fa (round-3 head) both new screens below were named:
// a via row stopped only its default and file-named exports (stoppedLocals), so this round reopened LO-911R2 B1's
// class. Smallest fix: mute a part only at the via file's own root and inside the exports its row stops
// (stoppedLocals); any other export of a via file carries its parts' kinds to its callers.
describe('LO-911R4 B1: a via file\'s other export does not carry its part\'s muting to a new screen', () => {
  const unnamedWith = (overlay: Record<string, string>) => {
    const ctx = scanCtx(overlay);
    const out: string[] = [];
    for (const [file, text] of ctx.files) {
      const k = classify(file, text, ctx);
      (['composer', 'list'] as Kind[]).forEach((x) => { if (k[x] && !registered(file, x)) out.push(`${x} ${file}`); });
    }
    return out;
  };
  it('a new Home card drawing ProgressScreen\'s new ShareToCoach (ShareSheet, a KNOWN GAP part) is named a composer', () => {
    const f = 'screens/client/ProgressScreen.tsx';
    const t = `${read(f)}\nexport function ShareToCoach() { return <ShareSheet card={null} onClose={() => undefined} />; }\n`;
    const s = 'screens/client/HomeShareCard.tsx';
    const st = "import React from 'react';\nimport { ShareToCoach } from './ProgressScreen';\nexport default function HomeShareCard() { return <ShareToCoach />; }\n";
    expect(unnamedWith({ [f]: t, [s]: st })).toContain(`composer ${s}`);
  });
  it('a new coach Home peek drawing CommandCenterScreen\'s new InboxPeek (InboxScreen, a KNOWN GAP part) is named a list', () => {
    const f = 'screens/coach/command-center/CommandCenterScreen.tsx';
    const t = `${read(f)}\nexport function InboxPeek() { return <InboxScreen onOpenThread={() => undefined} />; }\n`;
    const s = 'screens/coach/HomeInboxPeek.tsx';
    const st = "import React from 'react';\nimport { InboxPeek } from './command-center/CommandCenterScreen';\nexport default function HomeInboxPeek() { return <InboxPeek />; }\n";
    expect(unnamedWith({ [f]: t, [s]: st })).toContain(`list ${s}`);
  });
});

// ─── LO-911R4 outside the fix (failing test, review only): the LS-911 B1 cases write real files into src/ ────────
// checkSource (:1081, from 4710da51) makes src/screens/LS911Inventory-*/Fixture.tsx on disk and removes it after the
// scan. Other suites walk src/ in parallel workers; run 41686966257 failed declaredDependencies.test.ts with ENOENT on
// src/screens/LS911Inventory-gTo4Lg/Fixture.tsx. Smallest fix: pass the fixtures as a scanCtx overlay, as the later
// cases do, so nothing is written under src/.
it('LO-911R4 outside: no case in this file writes a fixture under src/', () => {
  const self = fs.readFileSync(__filename, 'utf8');
  expect(self.includes(['mkdtemp', 'Sync(path.join(SRC'].join(''))).toBe(false);
});

// ─── FIX-911R4 (LO-911R4 B1, class-first): every via row, every part ──────────────────────────────────────────────
// A via row's parts read as empty only at its file's own root and in the exports the row stops (default and file-named,
// or the row's exports), and in a local those reach. Any other export of a via file carries its parts' kinds on, so a
// new screen that draws a gap part through it is named. One case per via row and part (all 9 rows, 15 parts;
// KT2-940: CoachNavigator's via row went when its two parts were gated; FIX-933R4: ClientLookupScreen's went when
// useLookupNudge was).
describe('FIX-911R4: a via row mutes its parts only at its root and in the exports it stops', () => {
  const ctx0 = scanCtx();
  const cases = REGISTRY.flatMap((s) => (s.proof.by === 'via' ? s.proof.parts.map((part) => [s.kind, s.file, part] as [Kind, string, string]) : []));
  /** the name the via file draws a part by (an import of the part) */
  const localOf = (file: string, part: string) =>
    [...infoOf(ctx0, file).bindings].find(([, b]) => 'from' in b && resolveSpec(ctx0, file, b.from) === part)?.[0];
  const card = (file: string) => {
    const s = `${path.posix.dirname(file)}/FIX911R4Card.tsx`;
    const base = path.posix.basename(file).replace(/\.tsx?$/, '');
    return [s, `import React from 'react';\nimport { FIX911R4Wrap } from './${base}';\nexport default function FIX911R4Card() { return <FIX911R4Wrap />; }\n`] as const;
  };
  it('every via part is imported by a name the cases below draw', () => {
    expect(cases.length).toBe(15);
    expect(cases.filter(([, f, p]) => !localOf(f, p)).map(([k, f, p]) => `${k} ${f} ${p}`)).toEqual([]);
  });
  it.each(cases)('%s via %s: a new export drawing %s, drawn on a new screen, names that screen (the via file stays muted)', (kind, file, part) => {
    const t = `${read(file)}\nexport function FIX911R4Wrap() { return <${localOf(file, part)} />; }\n`;
    const [s, st] = card(file);
    const ctx = scanCtx({ [file]: t, [s]: st });
    expect(classify(s, st, ctx)[kind]).toBe(true);
    expect(classify(file, t, ctx)[kind] && !registered(file, kind)).toBe(false);
  });
  it.each(cases)('control: %s via %s: a new screen drawing the file\'s stopped export is not named for %s', (kind, file) => {
    const base = path.posix.basename(file).replace(/\.tsx?$/, '');
    const s = `${path.posix.dirname(file)}/FIX911R4Host.tsx`;
    const st = `import React from 'react';\nimport ${base} from './${base}';\nexport default function FIX911R4Host() { return <${base} />; }\n`;
    expect(classify(s, st, scanCtx({ [s]: st }))[kind]).toBe(false);
  });
  // the scope rides from a stopped export into the local it reaches, and no further: a synthetic ProgressScreen whose
  // default export draws ShareSheet through a local, and that also exports the local
  const f = 'screens/client/ProgressScreen.tsx';
  const synth = "import React from 'react';\nimport ShareSheet from '../../components/share/ShareSheet';\n" +
    'export function FIX911R4Inner() { return <ShareSheet card={null} onClose={() => undefined} />; }\n' +
    'export default function ProgressScreen() { return <FIX911R4Inner />; }\n';
  it('control: a stopped export that draws its part through a local is still muted for its callers', () => {
    const s = 'screens/client/FIX911R4Host.tsx';
    const st = "import React from 'react';\nimport ProgressScreen from './ProgressScreen';\nexport default function FIX911R4Host() { return <ProgressScreen />; }\n";
    const ctx = scanCtx({ [f]: synth, [s]: st });
    expect(classify(s, st, ctx).composer).toBe(false);
    expect(classify(f, synth, ctx).composer).toBe(false);
  });
  it('the same local, exported and drawn on a new screen, names that screen (whichever is read first)', () => {
    const s = 'screens/client/FIX911R4Inner.tsx';
    const st = "import React from 'react';\nimport { FIX911R4Inner } from './ProgressScreen';\nexport default function FIX911R4InnerCard() { return <FIX911R4Inner />; }\n";
    const h = 'screens/client/FIX911R4Host.tsx';
    const ht = "import React from 'react';\nimport ProgressScreen from './ProgressScreen';\nexport default function FIX911R4Host() { return <ProgressScreen />; }\n";
    const ctx = scanCtx({ [f]: synth, [s]: st, [h]: ht });
    expect(classify(h, ht, ctx).composer).toBe(false);
    expect(classify(s, st, ctx).composer).toBe(true);
    const ctx2 = scanCtx({ [f]: synth, [s]: st, [h]: ht });
    expect(classify(s, st, ctx2).composer).toBe(true);
    expect(classify(h, ht, ctx2).composer).toBe(false);
  });
});
