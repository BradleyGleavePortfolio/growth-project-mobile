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
import { ComposerInput, MessageBubble, ThreadHeader } from '../../../components/community';
import SafetyMenu from '../../../components/community/SafetyMenu';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import { ConversationClosedLine, useClosedBy, useConversationClosed, useServerAnswered } from '../../../components/messaging/ConversationClosed';
import { describeCommunityFailure } from '../../../api/communityErrors';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useCommunityMe, useDmMessages, useSendDm } from '../../../hooks/useCommunity';
import { useTheme } from '../../../theme/useTheme';
import { forestPop as fp } from '../../../theme/tokens';
import type { CoachCommunityNav, CoachCommunityRoute } from '../coachCommunityNavTypes';
import {
  DmState, NO_NAME, OFF_LINE, OFF_SEND_LINE, OFF_TITLE, dayKey, dayLabel, firstNameOf, initialsOf, isDmOff, useDmRoster,
} from './coachDm';

const DM_MAX = 4000; // backend SendDmDto (body 1..4000), as the client's thread

export default function CoachDmThreadScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const route = useRoute<CoachCommunityRoute<'CommunityDmThread'>>();
  const { semanticColors: c } = useTheme();
  const recipientId = route.params?.recipientId ?? '';
  const coach = useCurrentUser();
  const community = useCommunityMe();
  const workspaceId = community.data?.workspace_id ?? '';
  const roster = useDmRoster();
  const name = route.params?.name?.trim() || roster.data?.get(recipientId)?.name || null;
  const first = firstNameOf(name);

  const messages = useDmMessages(workspaceId, recipientId);
  const sendDm = useSendDm(workspaceId, recipientId, coach?.id ?? '');
  const { closed, open, close } = useConversationClosed(recipientId, [messages.error], useServerAnswered(messages) && workspaceId.length > 0);
  const by = useClosedBy(recipientId, closed, { errors: [messages.error] });
  const off = isDmOff(messages.error) || (community.isSuccess && (!workspaceId || community.data?.flags.community_dm === false));
  const meFailed = !community.data && community.isError;
  const reading = messages.isLoading || (!community.data && !community.isError);
  const failed = meFailed || (messages.isError && !open);
  const data = messages.data ?? [];

  const onSend = (body: string, idempotencyKey: string) =>
    sendDm.mutateAsync({ body, idempotencyKey }).then(
      () => undefined,
      (err: unknown) => {
        if (!close(err)) {
          const failure = describeCommunityFailure(err, 'send_message');
          Alert.alert(failure.title, isDmOff(err) ? OFF_SEND_LINE : failure.message); // not the client's "message your coach"
        }
        throw err; // the composer keeps the draft
      },
    );

  let body: React.ReactElement;
  if (off) body = <DmState icon="chatbubble-outline" title={OFF_TITLE} line={OFF_LINE} testID="coach-dm-thread-off" />;
  else if (closed) body = <View style={styles.flex} />; // closed: no messages, the line below says why
  else if (reading || failed) {
    body = reading
      ? <DmState busy line="Loading messages…" testID="coach-dm-thread-state" />
      : <DmState icon="alert-circle-outline" line="Messages did not load. Check your connection, then try again." action="Try again"
          outlined onAction={() => void (meFailed ? community.refetch() : messages.refetch())} testID="coach-dm-thread-state" actionTestID="coach-dm-thread-retry" />;
  } else if (data.length === 0) {
    body = (
      <DmState icon="chatbubble-outline" title="Say hello" testID="coach-dm-thread-new"
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
          const theirs = item.sender_user_id !== coach?.id && !item.deleted;
          return (
            <View>
              {!older || dayKey(older.created_at) !== dayKey(item.created_at) ? (
                <Text style={[styles.day, { color: c.textMuted }]} accessibilityRole="header">{dayLabel(item.created_at)}</Text>
              ) : null}
              <View style={styles.messageRow}>
                <View style={theirs ? styles.theirs : styles.flex}>
                  <MessageBubble message={item} myUserId={coach?.id ?? ''} showTime testID={`coach-dm-message-${item.id}`} />
                </View>
                {theirs ? (
                  <SafetyMenu targetType="message" targetId={item.id} authorUserId={item.sender_user_id} authorName={name}
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
        <ThreadHeader tone="deep" title={name ?? NO_NAME} subtitle={name ? NO_NAME : undefined} initials={initialsOf(name)}
          onBack={() => navigation.goBack()} testID="coach-dm-thread-header" />
        {body}
        {closed ? <ConversationClosedLine by={by} name={name} testID="coach-dm-thread-closed" /> : open && !off ? (
          <ComposerInput placeholder="Message" maxLength={DM_MAX} sending={sendDm.isPending} onSubmit={onSend}
            draftKey={recipientId && workspaceId ? `dm:${workspaceId}:${recipientId}` : undefined} testID="coach-dm-thread-composer" />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingVertical: 8 },
  messageRow: { flexDirection: 'row', alignItems: 'center' },
  theirs: { width: '84%' }, // Studio: Report and Block sit beside the client's bubble
  day: { fontFamily: 'Inter_600SemiBold', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingTop: 12, paddingBottom: 4 },
});
