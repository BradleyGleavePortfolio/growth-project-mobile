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
import React from 'react';
import {
  Alert,
  View,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  useDmMessages,
  useSendDm,
  useCommunityMe,
} from '../../hooks/useCommunity';
import {
  CommunityEmptyState,
  ThreadHeader,
  MessageBubble,
  ComposerInput,
} from '../../components/community';
import SafetyMenu from '../../components/community/SafetyMenu';
import { describeCommunityFailure } from '../../api/communityErrors';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

const DM_MAX = 4000; // mirror backend SendDmDto (body 1..4000)

export default function CommunityDmThreadScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityDmThread'>>();
  const recipientId = route.params?.recipientId ?? '';
  const participantLabel = route.params?.participantLabel ?? 'Coach';
  const client = useCurrentUser();
  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? '';

  const messages = useDmMessages(workspaceId, recipientId);
  const sendDm = useSendDm(workspaceId, recipientId, client?.id ?? '');

  const data = messages.data ?? [];
  const isEmpty = !messages.isLoading && (messages.isError || data.length === 0);
  // Header-level Report / Block acts on the latest message from the other
  // person (a report needs concrete content to review).
  const latestFromOther = data.find((m) => m.sender_user_id === recipientId && !m.deleted);

  const onSend = (body: string) =>
    sendDm.mutateAsync(body).then(
      () => undefined,
      (err: unknown) => {
        // Content filter (draft kept), DM closed by a block, DMs turned off,
        // offline, rate limit: specific copy; anything else carries a
        // support reference and goes to Sentry.
        const failure = describeCommunityFailure(err, 'send_message');
        Alert.alert(failure.title, failure.message);
        throw err;
      },
    );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-dmthread-screen"
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <ThreadHeader title={participantLabel} testID="community-dmthread-header" />
          </View>
          {latestFromOther ? (
            <SafetyMenu
              targetType="message"
              targetId={latestFromOther.id}
              authorUserId={recipientId}
              authorName={participantLabel}
              viewerUserId={client?.id}
              viewerCoachId={client?.coach_id}
              onBlocked={() => navigation.goBack()}
              testID="community-dmthread-safety"
            />
          ) : null}
        </View>

        {isEmpty ? (
          <View style={styles.center}>
            <CommunityEmptyState
              stem="dmThreadEmpty"
              firstName={client?.firstName ?? client?.name ?? null}
              title="Say hello"
              actionLabel="Start the conversation"
              onAction={() => {
                /* The inline composer below is always present; this CTA simply
                   signals intent — there is no separate compose surface here. */
              }}
              testID="community-dmthread-empty"
            />
          </View>
        ) : (
          <FlatList
            inverted
            data={data}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <View style={styles.messageRow}>
                <View style={styles.flex}>
                  <MessageBubble
                    message={item}
                    myUserId={client?.id ?? ''}
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
                    testID={`dm-message-safety-${item.id}`}
                  />
                ) : null}
              </View>
            )}
            contentContainerStyle={styles.list}
            style={styles.flex}
          />
        )}

        <ComposerInput
          placeholder="Message"
          maxLength={DM_MAX}
          sending={sendDm.isPending}
          onSubmit={onSend}
          testID="community-dmthread-composer"
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingVertical: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  messageRow: { flexDirection: 'row', alignItems: 'center' },
});
