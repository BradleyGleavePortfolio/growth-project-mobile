/**
 * CommunityDmThreadScreen — a single 1:1 DM conversation (product plan §2.10).
 * Messages render newest-first in an inverted list with mine/theirs bubbles and
 * a "sending" treatment for optimistic messages. Sending is optimistic with
 * rollback (useSendDm). The wire posture holds: realtime carries only pings, so
 * the authoritative messages always come from REST.
 *
 * Empty conversation → Roman-voiced empty state with a primary action.
 * Standardized on semanticColors / tokens.ts.
 *
 * COMMUNITY-DM-FORMER-REACH-M (owner ALM-P1, ALM-D5; 203-D12, 203-D51): with her one former coach (GET /community/me
 * former_coach_dms[0]) the thread reads that coach's community, not hers, and is Style 3's Style C page (FormerCoach.tsx):
 * the masthead, the conversation on the sheet, the three dots' sheet, and the closed page. No new route param: the
 * community comes from /me. `inGate` is the locked Community page's way in (no coach: JoinCoachState.tsx).
 */
import React, { useRef, useState } from 'react';
import {
  Alert,
  View,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { colors, forestPop as fp, typography } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  useDmMessages,
  useSendDm,
  useCommunityMe,
  useMyCoachName,
} from '../../hooks/useCommunity';
import {
  CommunityEmptyState,
  ThreadHeader,
  MessageBubble,
  ComposerInput,
} from '../../components/community';
import SafetyMenu from '../../components/community/SafetyMenu';
import type { ComposerInputHandle } from '../../components/community/ComposerInput';
import { ForestStatusBar } from '../../components/StatusBarBand';
import { describeCommunityFailure } from '../../api/communityErrors';
import { useConversationClosed, useServerAnswered, useClosedBy, ConversationClosedLine } from '../../components/messaging/ConversationClosed';
import { FormerCoachClosed, FormerCoachMasthead, FormerCoachPaper, FormerCoachSheet, useFormerThread } from '../../components/community/FormerCoach';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';
import { NO_NAME, dayKey, dayLabel, initialsOf } from './coach-dm/coachDm';

const DM_MAX = 4000; // mirror backend SendDmDto (body 1..4000)

export default function CommunityDmThreadScreen({ inGate }: {
  /** The locked page's thread (no coach, no stack): who, and Back to the page. */
  inGate?: { recipientId: string; onBack: () => void };
} = {}): React.ReactElement {
  const { semanticColors, colorScheme } = useTheme();
  const light = colorScheme !== 'dark';
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityDmThread'>>();
  const recipientId = inGate?.recipientId ?? route.params?.recipientId ?? '';
  const goBack = inGate ? inGate.onBack : () => navigation.goBack();
  const client = useCurrentUser();
  // COACH-DM-CLIENT-M: a given name wins; my own coach (client.coach_id) is named as the app knows them (useMyCoachName,
  // as the composer), "Coach" until then; anyone else, a former coach included, is NO_NAME, never "Coach".
  const given = route.params?.participantLabel;
  const myCoach = !!recipientId && recipientId === client?.coach_id;
  const coach = useMyCoachName(given === undefined && myCoach ? client?.coach_id : null);
  const participantLabel = given ?? (myCoach ? coach.name ?? 'Coach' : NO_NAME);
  // REFINE-985 (C6CHAT-S-V2 c08's bar): my own coach, once the phone knows the name, gets "Your coach" (SpaceTree.tsx:68)
  // under it and their initial in c08's tile; while the name is unknown, and for anyone else, no line and no tile.
  const coachLine = given === undefined && myCoach && coach.name ? coach.name : null;
  // REFINE-985R3 TILE-1: one letter, as c08 draws (the name's first character, whatever its script).
  const coachLetter = coachLine ? Array.from(initialsOf(coachLine) ?? '')[0] ?? null : null;
  const composerRef = useRef<ComposerInputHandle>(null);
  const me = useCommunityMe();
  const former = useFormerThread(me.data, client?.coach_id, recipientId);
  const workspaceId = former?.workspaceId ?? me.data?.workspace_id ?? '';
  // Her coach now, for the former page's closed state (the list's read: usually in memory already).
  const myCoachNow = useMyCoachName(former ? client?.coach_id : null);
  const [about, setAbout] = useState(false);

  const messages = useDmMessages(workspaceId, recipientId);
  // REFINE-985R3 (P-B; LS-985R2 N5): a refused read holds no saved answer, so its re-read (a ping, the return to the
  // front) starts with no error for a moment and the closed line would blink to "Loading messages…". This person's
  // refusal is held until that re-read answers.
  const [refusal, setRefusal] = useState<{ id: string; error: unknown } | null>(null);
  if (messages.error && (refusal?.id !== recipientId || refusal.error !== messages.error)) setRefusal({ id: recipientId, error: messages.error });
  const readError = messages.error ?? (messages.isFetching && messages.data === undefined && refusal?.id === recipientId ? refusal.error : null);
  const sendDm = useSendDm(workspaceId, recipientId, client?.id ?? '');
  // BLOCK-ALL-M: a block either way (or a ban) closes the DM: no composer, and the read refusal is not an empty thread.
  // FX-872: open only once the DM read came back. Signed in with no community membership (left, removed) is closed too.
  const noAccess = !former && me.isSuccess && !me.data?.workspace_id;
  const { closed, open, close } = useConversationClosed(
    recipientId,
    [readError],
    useServerAnswered(messages) && workspaceId.length > 0,
    noAccess ? true : undefined,
  );
  // BLOCK-TELL #169-5: the read refusal's code (blocked_by_you / blocked_by_them) says who closed it.
  const by = useClosedBy(recipientId, closed, { errors: [readError] });
  // FR-877R2 (LO C2): BAM-2b names them only by a name this screen was given, or, for my own coach, the bar's name
  // (COACH-DM-CLIENT-M). A member reached with no name (a link) gets BAM-1, never NO_NAME or "Coach" as their name.
  const shownName = given ?? (myCoach ? participantLabel : null);

  // FR-880R2 (Sol B1, LO-872R4 C2): the DM read waits for /community/me (it is off until the space is known), so a slow,
  // failed or offline me read is this screen's read too: the same two lines, and Try again reads me again.
  const meFailed = !me.data && me.isError;
  const reading = messages.isLoading || (!me.data && !me.isError);
  const failed = meFailed || (messages.isError && !open);
  const data = messages.data ?? [];
  // REFINE-985R3 EMPTY-1 (LO-985R2 C3 = LS-985R2 C2): empty is a read that answered with no messages (the coach
  // thread's rule). A re-read that fails keeps the saved answer, so a conversation stays a conversation and "Say hello"
  // is drawn only over a thread with none; a read that never answered is the failed page (`failed`, above).
  const isEmpty = !messages.isLoading && data.length === 0;
  // Header-level Report / Block acts on the latest message from the other
  // person (a report needs concrete content to review).
  const latestFromOther = data.find((m) => m.sender_user_id === recipientId && !m.deleted);
  // The former page names the coach only by the server's name; with none, the menus say "this member".
  const authorName = former ? former.name : participantLabel;
  const coachId = client?.coach_id ?? null;
  const openMyCoach = coachId && !inGate ? () => navigation.replace('CommunityDmThread', { recipientId: coachId }) : undefined;
  // Style 3 (S3_thread): the conversation and the box sit on the page's sheet, under the masthead.
  const Body = former ? FormerCoachPaper : React.Fragment;

  const onSend = (body: string, idempotencyKey: string) =>
    sendDm.mutateAsync({ body, idempotencyKey }).then(
      () => undefined,
      (err: unknown) => {
        // Content filter (draft kept), DM closed by a block, DMs turned off,
        // offline, rate limit: specific copy; anything else carries a
        // support reference and goes to Sentry.
        if (!close(err)) {
          const failure = describeCommunityFailure(err, 'send_message');
          Alert.alert(failure.title, failure.message);
        }
        throw err; // the composer keeps the draft on this phone
      },
    );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: fp.deep }]}
      edges={['top']}
      testID="community-dmthread-screen"
    >
      {/* FR-880R4 (Opus B2): the app's status band above takes the same deep forest, light icons, while this DM is in front. */}
      <ForestStatusBar />
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: former ? fp.deep : semanticColors.bgPrimary }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {former ? <FormerCoachMasthead name={former.name} onBack={goBack} onAbout={closed ? undefined : () => setAbout(true)} /> : null}
        {/* FR-880R3 (Sol B2, #172-10): Voice B Studio frame 05b's deep-forest bar, open or closed; a 1:1 DM has no
            member count. REFINE-985: 05b's type and spacing (voiceB); Report / Block bare and light on the bar, as 05b's
            info button (no chip). */}
        {former ? null : <ThreadHeader
          tone="deep"
          voiceB
          title={participantLabel}
          subtitle={coachLine ? 'Your coach' : undefined}
          initials={coachLetter}
          onBack={() => navigation.goBack()}
          trailing={latestFromOther ? (
            <SafetyMenu
              targetType="message"
              targetId={latestFromOther.id}
              authorUserId={recipientId}
              authorName={participantLabel}
              viewerUserId={client?.id}
              viewerCoachId={client?.coach_id}
              onBlocked={goBack}
              triggerColor={fp.onDeep}
              triggerSize={22}
              testID="community-dmthread-safety"
            />
          ) : null}
          testID="community-dmthread-header"
        />}

        <Body>
        {closed ? (former
          ? <FormerCoachClosed by={by} name={former.name} coachName={myCoachNow.name} onCoach={openMyCoach} />
          : <View style={styles.flex} /> /* closed: no message text, no "Start the conversation" */
        ) : reading || failed ? ( /* FR-872 (Opus C2): never blank, never stuck */
          <View style={styles.center} accessibilityState={{ busy: reading }} testID="community-dmthread-state">
            <Text style={[typography.bodySmall, styles.stateText, { color: semanticColors.textMuted }]}>
              {reading ? 'Loading messages…' : 'Messages did not load. Check your connection, then try again.'}
            </Text>
            {failed ? <HapticPressable onPress={() => void (meFailed ? me.refetch() : messages.refetch())} accessibilityRole="button"
              accessibilityLabel="Try again" testID="community-dmthread-retry" style={styles.retry}>
              <Text style={[typography.bodySmall, styles.stateText, { color: semanticColors.accentText }]}>Try again</Text>
            </HapticPressable> : null}
          </View>
        ) : isEmpty && !open ? (
          <View style={styles.flex} />
        ) : isEmpty ? (
          <View style={styles.center}>
            <CommunityEmptyState
              stem="dmThreadEmpty"
              firstName={client?.firstName ?? client?.name ?? null}
              title="Say hello"
              actionLabel="Start the conversation"
              onAction={() => composerRef.current?.focus()} // COACH-DM-CLIENT-M: the box below, drawn whenever this is
              voiceB
              testID="community-dmthread-empty"
            />
          </View>
        ) : (
          <FlatList
            inverted
            data={data}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => (
              <>
              {/* Style 3 (S3_thread .sep): the day over its first message, on the former page (the list is newest first). */}
              {former && (index === data.length - 1 || dayKey(data[index + 1].created_at) !== dayKey(item.created_at))
                ? <Text style={styles.day} testID={`dm-day-${item.id}`}>{dayLabel(item.created_at)}</Text> : null}
              <View style={styles.messageRow}>
                <View style={styles.flex}>
                  <MessageBubble
                    message={item}
                    myUserId={client?.id ?? ''}
                    voiceB
                    testID={`dm-message-${item.id}`}
                  />
                </View>
                {item.sender_user_id !== client?.id && !item.deleted ? (
                  <SafetyMenu
                    targetType="message"
                    targetId={item.id}
                    authorUserId={item.sender_user_id}
                    authorName={authorName}
                    viewerUserId={client?.id}
                    viewerCoachId={client?.coach_id}
                    onBlocked={goBack}
                    triggerColor={light ? fp.n700 : undefined}
                    triggerSize={22}
                    testID={`dm-message-safety-${item.id}`}
                  />
                ) : null}
              </View>
              </>
            )}
            contentContainerStyle={styles.list}
            style={styles.flex}
          />
        )}

        {closed ? (!former && coach.settled ? ( // the line waits for my coach's name, as the composer's does, so it never changes
          <ConversationClosedLine by={by} name={shownName} testID="community-dmthread-closed" />
        ) : null) : !open ? null : <ComposerInput
          ref={composerRef}
          placeholder="Type a message..." // REFINE-985R3 WORDS-1: 05b's words, as the coaching chat's box reads
          maxLength={DM_MAX}
          sending={sendDm.isPending}
          onSubmit={onSend}
          draftKey={recipientId && workspaceId ? `dm:${workspaceId}:${recipientId}` : undefined}
          voiceB
          testID="community-dmthread-composer"
        />}
        </Body>
      </KeyboardAvoidingView>
      {former ? (
        <FormerCoachSheet visible={about} name={former.name} coachId={former.coachId} reportMessageId={latestFromOther?.id ?? null}
          onClose={() => setAbout(false)} onBlocked={goBack} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  stateText: { textAlign: 'center', paddingHorizontal: 24 },
  retry: { minHeight: 44, justifyContent: 'center' },
  list: { paddingVertical: 8 },
  // REFINE-985: 05b's "•••" sits at the top of its message (B-05b-feed-1000_ios.html:130).
  messageRow: { flexDirection: 'row', alignItems: 'flex-start' },
  // S3_thread .sep: centred, 600 13, #3D3D3A, 6 above and 2 below.
  day: { textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 13, color: colors.charcoal, marginTop: 6, marginBottom: 2 },
});
