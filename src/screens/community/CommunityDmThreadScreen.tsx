/**
 * CommunityDmThreadScreen — a single 1:1 DM conversation (product plan §2.10).
 * Messages render newest-first in an inverted list with mine/theirs bubbles and
 * a "sending" treatment for optimistic messages. Sending is optimistic with
 * rollback (useSendDm). The wire posture holds: realtime carries only pings, so
 * the authoritative messages always come from REST.
 *
 * Empty conversation → Roman-voiced empty state with a primary action.
 * Standardized on semanticColors / tokens.ts.
 */
import React, { useRef } from 'react';
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
import { forestPop as fp, typography } from '../../theme/tokens';
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
import type { CommunityNav, CommunityRoute } from './communityNavTypes';
import { NO_NAME, dayKey, dayLabel, initialsOf } from './coach-dm/coachDm';

const DM_MAX = 4000; // mirror backend SendDmDto (body 1..4000)

export default function CommunityDmThreadScreen(): React.ReactElement {
  const { semanticColors, colorScheme } = useTheme();
  const light = colorScheme !== 'dark';
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityDmThread'>>();
  const recipientId = route.params?.recipientId ?? '';
  const client = useCurrentUser();
  // COACH-DM-CLIENT-M: a given name wins; my own coach (client.coach_id) is named as the app knows them (useMyCoachName,
  // as the composer), "Coach" until then; anyone else, a former coach included, is NO_NAME, never "Coach".
  const given = route.params?.participantLabel;
  const myCoach = !!recipientId && recipientId === client?.coach_id;
  const coach = useMyCoachName(given === undefined && myCoach ? client?.coach_id : null);
  const participantLabel = given ?? (myCoach ? coach.name ?? 'Coach' : NO_NAME);
  // REFINE-985 (C6CHAT-S-V2 c08's bar): my own coach, once the phone knows the name, gets "Your coach" (SpaceTree.tsx:68)
  // under it and their initials in c08's tile; while the name is unknown, and for anyone else, no line and no tile.
  const coachLine = given === undefined && myCoach && coach.name ? coach.name : null;
  const composerRef = useRef<ComposerInputHandle>(null);
  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? '';

  const messages = useDmMessages(workspaceId, recipientId);
  const sendDm = useSendDm(workspaceId, recipientId, client?.id ?? '');
  // BLOCK-ALL-M: a block either way (or a ban) closes the DM: no composer, and the read refusal is not an empty thread.
  // FX-872: open only once the DM read came back. Signed in with no community membership (left, removed) is closed too.
  const noAccess = me.isSuccess && !me.data?.workspace_id;
  const { closed, open, close } = useConversationClosed(
    recipientId,
    [messages.error],
    useServerAnswered(messages) && workspaceId.length > 0,
    noAccess ? true : undefined,
  );
  // BLOCK-TELL #169-5: the read refusal's code (blocked_by_you / blocked_by_them) says who closed it.
  const by = useClosedBy(recipientId, closed, { errors: [messages.error] });
  // FR-877R2 (LO C2): BAM-2b names them only by a name this screen was given, or, for my own coach, the bar's name
  // (COACH-DM-CLIENT-M). A member reached with no name (a link) gets BAM-1, never NO_NAME or "Coach" as their name.
  const shownName = given ?? (myCoach ? participantLabel : null);

  // FR-880R2 (Sol B1, LO-872R4 C2): the DM read waits for /community/me (it is off until the space is known), so a slow,
  // failed or offline me read is this screen's read too: the same two lines, and Try again reads me again.
  const meFailed = !me.data && me.isError;
  const reading = messages.isLoading || (!me.data && !me.isError);
  const failed = meFailed || (messages.isError && !open);
  const data = messages.data ?? [];
  const isEmpty = !messages.isLoading && (messages.isError || data.length === 0);
  // Header-level Report / Block acts on the latest message from the other
  // person (a report needs concrete content to review).
  const latestFromOther = data.find((m) => m.sender_user_id === recipientId && !m.deleted);

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
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* FR-880R3 (Sol B2, #172-10): Voice B Studio frame 05b's deep-forest bar, open or closed; a 1:1 DM has no
            member count. REFINE-985: 05b's type and spacing (voiceB); Report / Block bare and light on the bar, as 05b's
            info button (no chip). */}
        <ThreadHeader
          tone="deep"
          voiceB
          title={participantLabel}
          subtitle={coachLine ? 'Your coach' : undefined}
          initials={coachLine ? initialsOf(coachLine) : null}
          onBack={() => navigation.goBack()}
          trailing={latestFromOther ? (
            <SafetyMenu
              targetType="message"
              targetId={latestFromOther.id}
              authorUserId={recipientId}
              authorName={participantLabel}
              viewerUserId={client?.id}
              viewerCoachId={client?.coach_id}
              onBlocked={() => navigation.goBack()}
              triggerColor={fp.onDeep}
              triggerSize={22}
              testID="community-dmthread-safety"
            />
          ) : null}
          testID="community-dmthread-header"
        />

        {closed ? (
          <View style={styles.flex} /> /* closed: no message text, no "Start the conversation" */
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
              <View>
                {/* REFINE-985: a day row above the day's first message (the list is newest first), the coach thread's
                    words (dayLabel) in 05b .day's type. */}
                {index === data.length - 1 || dayKey(data[index + 1].created_at) !== dayKey(item.created_at) ? (
                  <Text style={[styles.day, { color: light ? fp.n700 : semanticColors.textMuted }]} accessibilityRole="header"
                    testID={`dm-day-${item.id}`}>{dayLabel(item.created_at)}</Text>
                ) : null}
                <View style={styles.messageRow}>
                  <View style={styles.flex}>
                    <MessageBubble
                      message={item}
                      myUserId={client?.id ?? ''}
                      showTime
                      voiceB
                      testID={`dm-message-${item.id}`}
                    />
                  </View>
                  {item.sender_user_id !== client?.id && !item.deleted ? (
                    <SafetyMenu
                      targetType="message"
                      targetId={item.id}
                      authorUserId={item.sender_user_id}
                      authorName={participantLabel}
                      viewerUserId={client?.id}
                      viewerCoachId={client?.coach_id}
                      onBlocked={() => navigation.goBack()}
                      triggerColor={light ? fp.n700 : undefined}
                      triggerSize={22}
                      testID={`dm-message-safety-${item.id}`}
                    />
                  ) : null}
                </View>
              </View>
            )}
            contentContainerStyle={styles.list}
            style={styles.flex}
          />
        )}

        {closed ? (coach.settled ? ( // the line waits for my coach's name, as the composer's does, so it never changes
          <ConversationClosedLine by={by} name={shownName} testID="community-dmthread-closed" />
        ) : null) : !open ? null : <ComposerInput
          ref={composerRef}
          placeholder="Message"
          maxLength={DM_MAX}
          sending={sendDm.isPending}
          onSubmit={onSend}
          draftKey={recipientId && workspaceId ? `dm:${workspaceId}:${recipientId}` : undefined}
          voiceB
          testID="community-dmthread-composer"
        />}
      </KeyboardAvoidingView>
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
  // REFINE-985: 05b's "•••" sits at the top of its message (B-05b-feed-1000_ios.html:130); .day :46 600 .75rem/1.2,
  // padding 10px 0 4px.
  messageRow: { flexDirection: 'row', alignItems: 'flex-start' },
  day: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 14.4, fontWeight: '600', textAlign: 'center', paddingTop: 10, paddingBottom: 4 },
});
