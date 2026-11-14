/**
 * COACH-DM-M: one client's community DM thread for their coach (Studio frame "thread"). Its own screen built on the
 * client thread's pieces (PLAN question 2): the same reads and send (useDmMessages, useSendDm and the composer's
 * send-once key and kept draft), the same closed rule and lines (BLOCK-ALL-M, #169-5) and the same Report and Block
 * sheet. Studio adds the client's initials and "Direct message" under the name, times inside the bubbles and day rows.
 * The name is the roster's (passed by the list or New message, else read here); with none the bar reads "Direct
 * message" and BAM-2b falls back to BAM-1, as the client's screen does.
 */
import React from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { ComposerInput, MessageBubble, ThreadHeader } from '../../../components/community';
import SafetyMenu from '../../../components/community/SafetyMenu';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import { ConversationClosedLine, useClosedBy, useConversationClosed, useServerAnswered } from '../../../components/messaging/ConversationClosed';
import { describeCommunityFailure } from '../../../api/communityErrors';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { communityKeys, useCommunityMe, useDmMessages, useSendDm } from '../../../hooks/useCommunity';
import { useTheme } from '../../../theme/useTheme';
import { forestPop as fp } from '../../../theme/tokens';
import type { CoachCommunityNav, CoachCommunityRoute } from '../coachCommunityNavTypes';
import {
  DmState, NO_NAME, OFF_LINE, OFF_SEND_LINE, OFF_TITLE, dayKey, dayLabel, dmOn, firstNameOf, initialsOf, isDmOff, rosterOf,
  useDmRoster, useStudioInk,
} from './coachDm';

const DM_MAX = 4000; // backend SendDmDto (body 1..4000), as the client's thread

export default function CoachDmThreadScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const route = useRoute<CoachCommunityRoute<'CommunityDmThread'>>();
  const { semanticColors: c } = useTheme();
  const ink = useStudioInk();
  const qc = useQueryClient();
  const recipientId = route.params?.recipientId ?? '';
  const coach = useCurrentUser();
  const community = useCommunityMe();
  const workspaceId = community.data?.workspace_id ?? '';
  const roster = useDmRoster();
  const name = route.params?.name?.trim() || rosterOf(roster.data).get(recipientId)?.name || null;
  const first = firstNameOf(name);

  const messages = useDmMessages(workspaceId, recipientId);
  const sendDm = useSendDm(workspaceId, recipientId, coach?.id ?? '');
  const { closed, open, close } = useConversationClosed(recipientId, [messages.error], useServerAnswered(messages) && workspaceId.length > 0);
  const by = useClosedBy(recipientId, closed, { errors: [messages.error] });
  const off = isDmOff(messages.error) || (!!community.data && !dmOn(community.data)); // LO-962R1 N2: the list's rule
  const meFailed = !community.data && community.isError;
  const reading = messages.isLoading || (!community.data && !community.isError);
  const failed = meFailed || (messages.isError && !open);
  const data = messages.data ?? [];

  const onSend = (body: string, idempotencyKey: string) =>
    sendDm.mutateAsync({ body, idempotencyKey }).then(
      () => {
        // LS-962R1 B2: a send is what lists a thread (the server's POST /dms writes nothing), so the list and the home
        // row read the server's new answer now, not after they go stale. The dms prefix covers the ?limit=100 key.
        void qc.invalidateQueries({ queryKey: communityKeys.dmThreads(workspaceId) });
      },
      (err: unknown) => {
        if (!close(err)) {
          const failure = describeCommunityFailure(err, 'send_message');
          Alert.alert(failure.title, isDmOff(err) ? OFF_SEND_LINE : failure.message); // not the client's "message your coach"
        }
        throw err; // the composer keeps the draft
      },
    );

  let body: React.ReactElement;
  if (off) body = <DmState icon="chatbox-outline" title={OFF_TITLE} line={OFF_LINE} testID="coach-dm-thread-off" />;
  else if (closed) body = <View style={styles.flex} />; // closed: no messages, the line below says why
  else if (reading || failed) {
    body = reading
      ? <DmState busy line="Loading messages…" testID="coach-dm-thread-state" />
      : <DmState icon="alert-circle-outline" line="Messages did not load. Check your connection, then try again." action="Try again"
          outlined onAction={() => void (meFailed ? community.refetch() : messages.refetch())} testID="coach-dm-thread-state" actionTestID="coach-dm-thread-retry" />;
  } else if (data.length === 0) {
    body = (
      <DmState icon="chatbox-outline" title="Say hello" testID="coach-dm-thread-new"
        line={`Nothing here yet. Only ${first ?? 'they'} ${first ? 'sees' : 'see'} what you write here.`} />
    );
  } else {
    body = (
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const older = data[index + 1];
          const mine = !!coach?.id && item.sender_user_id === coach.id;
          const theirs = !mine && !item.deleted;
          return (
            <View>
              {!older || dayKey(older.created_at) !== dayKey(item.created_at) ? (
                <Text style={[styles.day, { color: ink.body }]} accessibilityRole="header">{dayLabel(item.created_at)}</Text>
              ) : null}
              <View style={[styles.messageRow, mine ? styles.mineRow : null]}>
                {/* Studio .bub max-width 74%: the box takes the bubble's width, so Report and Block sits at its edge. */}
                <View style={styles.bubbleBox} testID={`coach-dm-bubble-box-${item.id}`}>
                  <MessageBubble message={item} myUserId={coach?.id ?? ''} showTime studio testID={`coach-dm-message-${item.id}`} />
                </View>
                {theirs ? (
                  // Studio's "Block Jordan": the first name; the bar above keeps the full roster name.
                  <SafetyMenu targetType="message" targetId={item.id} authorUserId={item.sender_user_id} authorName={first}
                    viewerUserId={coach?.id} viewerCoachId={coach?.coach_id} onBlocked={() => navigation.goBack()}
                    testID={`coach-dm-message-safety-${item.id}`} />
                ) : null}
              </View>
            </View>
          );
        }}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: fp.deep }]} edges={['top']} testID="coach-dm-thread">
      <ForestStatusBar />
      <KeyboardAvoidingView style={[styles.flex, { backgroundColor: c.bgPrimary }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThreadHeader tone="deep" studio title={name ?? NO_NAME} subtitle={name ? NO_NAME : undefined} initials={initialsOf(name)}
          onBack={() => navigation.goBack()} testID="coach-dm-thread-header" />
        {body}
        {closed ? <ConversationClosedLine studio by={by} name={name} testID="coach-dm-thread-closed" /> : open && !off ? (
          <ComposerInput studio placeholder="Message" maxLength={DM_MAX} sending={sendDm.isPending} onSubmit={onSend}
            draftKey={recipientId && workspaceId ? `dm:${workspaceId}:${recipientId}` : undefined} testID="coach-dm-thread-composer" />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Studio .msgs padding 6px 16px 8px, gap 6px; .mrow2; .sep margin 10px 0 6px (S_thread_ios.html:69-:73)
  list: { paddingTop: 6, paddingBottom: 8 },
  messageRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 3 },
  mineRow: { justifyContent: 'flex-end' },
  bubbleBox: { maxWidth: '74%', flexShrink: 1 },
  day: { fontFamily: 'Inter_600SemiBold', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingTop: 10, paddingBottom: 6 },
});
