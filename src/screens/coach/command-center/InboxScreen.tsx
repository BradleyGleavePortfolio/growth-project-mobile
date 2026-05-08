// Coach Command Center — Inbox screen.
//
// Coach-specific message threading. Shows all client threads sorted by
// last_message_at desc. Unread threads are distinguished by a bold name
// and an unread count badge.
//
// SCOPE NOTE: This inbox is /coach/command-center/inbox — coach-scoped
// message threads only. The Phase 9 global notification center is a separate
// surface (system notifications) and lives at a different route. No conflict.
//
// State machine:
//   idle → loading → (data | error)
//   Pull-to-refresh transitions loading → data/error.
//
// Data source: commandCenterApi.getInbox()
// Status: MOCKED until Phase 8 backend ships.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { colors, spacing, typography, radius } from '../../../theme/tokens';
import {
  commandCenterApi,
  InboxThread,
} from '../../../services/commandCenterApi';
import MessagePreviewRow from '../../../components/command-center/MessagePreviewRow';
import CommandCenterMockDataBanner from '../../../components/command-center/MockDataBanner';

type LoadState = 'idle' | 'loading' | 'refreshing' | 'data' | 'error';

interface Props {
  /** Navigate to the full message thread with a client. */
  onOpenThread?: (clientId: string, clientName: string) => void;
}

export default function InboxScreen({ onOpenThread }: Props) {
  const [state, setState] = useState<LoadState>('idle');
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    setState(isRefresh ? 'refreshing' : 'loading');
    try {
      const res = await commandCenterApi.getInbox();
      setThreads(res.data.threads);
      setTotalUnread(res.data.total_unread);
      setState('data');
    } catch {
      setErrorMessage('Unable to load inbox. Check your connection and try again.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (state === 'loading') {
    return (
      <View style={styles.centred} testID="command-center-inbox">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  if (state === 'error' && threads.length === 0) {
    return (
      <View style={styles.centred} testID="command-center-inbox">
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity
          onPress={() => load(false)}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry loading inbox"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="command-center-inbox">
      <CommandCenterMockDataBanner />
      <FlatList
        data={threads}
        keyExtractor={(item) => item.thread_id}
        contentContainerStyle={
          threads.length === 0 ? styles.emptyContent : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={state === 'refreshing'}
            onRefresh={() => load(true)}
            tintColor={colors.forest}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.heading}>Inbox</Text>
            {totalUnread > 0 ? (
              <Text style={styles.subheading}>
                {totalUnread} unread {totalUnread === 1 ? 'message' : 'messages'}
              </Text>
            ) : (
              <Text style={styles.subheading}>All messages read</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrapper}>
            <Text style={styles.emptyTitle}>No messages</Text>
            <Text style={styles.emptyBody}>
              Client messages will appear here once your first client sends a
              message.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <MessagePreviewRow
            clientName={item.client_name}
            preview={item.last_message_preview}
            lastMessageAt={item.last_message_at}
            unreadCount={item.unread_count}
            isCoachTurn={item.is_coach_turn}
            onPress={() => onOpenThread?.(item.client_id, item.client_name)}
            testID="command-center-inbox-row"
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  centred: {
    flex: 1,
    backgroundColor: colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  listHeader: {
    paddingTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  heading: {
    ...typography.h1,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.body,
    color: colors.charcoal,
  },
  emptyWrapper: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  emptyBody: {
    ...typography.body,
    color: colors.stone,
    textAlign: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  retryButton: {
    backgroundColor: colors.forest,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  retryText: {
    ...typography.caption,
    color: colors.bone,
    textAlign: 'center',
  },
});
