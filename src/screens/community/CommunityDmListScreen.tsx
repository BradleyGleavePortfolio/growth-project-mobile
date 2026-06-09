/**
 * CommunityDmListScreen — the DM inbox (product plan §2.10: 1:1 messaging,
 * gated by the per-workspace dm_enabled policy on the backend). Lists the
 * caller's conversation threads (REST, never realtime payloads), each opening a
 * single conversation. Coach threads carry the Roman monogram accent.
 *
 * Empty inbox → Roman-voiced empty state with a primary action ("Send your
 * coach a message"). Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useDmThreads } from '../../hooks/useCommunity';
import { CommunityEmptyState, DmRow } from '../../components/community';
import type { CommunityDmThread } from '../../api/communityApi';
import type { CommunityNav } from './communityNavTypes';

interface Props {
  embedded?: boolean;
  /** Workspace id — DMs are workspace-scoped on the backend. */
  workspaceId?: string | null;
}

export default function CommunityDmListScreen({
  embedded,
  workspaceId,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const client = useCurrentUser();
  const threads = useDmThreads(workspaceId);

  const openThread = (thread: CommunityDmThread) =>
    navigation.navigate('CommunityDmThread', {
      recipientId: thread.other_user_id,
    });

  const startWithCoach = () =>
    navigation.navigate('CommunityComposer', {
      mode: 'dm',
      recipientId: '',
    });

  const data = threads.data ?? [];
  const isEmpty = !threads.isLoading && (threads.isError || data.length === 0);

  const Container: React.ComponentType<{ children: React.ReactNode }> = embedded
    ? ({ children }) => <View style={styles.flex}>{children}</View>
    : ({ children }) => (
        <SafeAreaView
          style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
          edges={['top']}
        >
          {children}
        </SafeAreaView>
      );

  return (
    <Container>
      {isEmpty ? (
        <View style={styles.center} testID="community-dmlist-screen">
          <CommunityEmptyState
            stem="dmInboxEmpty"
            firstName={client?.firstName ?? client?.name ?? null}
            title="No conversations yet"
            actionLabel="Send your coach a message"
            onAction={startWithCoach}
            testID="community-dmlist-empty"
          />
        </View>
      ) : (
        <FlatList
          testID="community-dmlist-screen"
          data={data}
          keyExtractor={(t) => t.thread_id}
          renderItem={({ item }) => (
            <DmRow
              thread={item}
              participantLabel="Coach"
              isCoach
              onPress={openThread}
              testID={`dm-row-${item.thread_id}`}
            />
          )}
          contentContainerStyle={styles.list}
          style={{ backgroundColor: semanticColors.bgPrimary }}
        />
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingVertical: 8 },
});
