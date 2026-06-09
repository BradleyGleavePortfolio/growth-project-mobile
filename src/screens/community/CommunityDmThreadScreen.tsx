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
  View,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
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
import type { CommunityRoute } from './communityNavTypes';

const DM_MAX = 4000; // mirror backend SendDmDto (body 1..4000)

export default function CommunityDmThreadScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
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
        <ThreadHeader
          title={participantLabel}
          testID="community-dmthread-header"
        />

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
              <MessageBubble
                message={item}
                myUserId={client?.id ?? ''}
                testID={`dm-message-${item.id}`}
              />
            )}
            contentContainerStyle={styles.list}
            style={styles.flex}
          />
        )}

        <ComposerInput
          placeholder="Message"
          maxLength={DM_MAX}
          sending={sendDm.isPending}
          onSubmit={(body) => sendDm.mutate(body)}
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
});
