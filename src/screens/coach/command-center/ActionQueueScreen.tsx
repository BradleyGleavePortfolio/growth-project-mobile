// Coach Command Center — Action Queue screen.
//
// Lists all pending coach alerts requiring action (missed check-ins,
// high churn risk, no message exchange, Build Week gates, bloodwork review).
// Sorted by created_at desc. Dismissed alerts are hidden.
//
// State machine:
//   idle → loading → (data | error)
//   Dismissing an alert: optimistic removal, rolled back on error.
//   Pull-to-refresh transitions loading → data/error.
//
// Data source: commandCenterApi.getActionQueue() + commandCenterApi.dismissAlert()
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
  Alert,
} from 'react-native';
import { colors, spacing, typography, radius } from '../../../theme/tokens';
import {
  commandCenterApi,
  ActionQueueItem,
} from '../../../services/commandCenterApi';
import AlertRow from '../../../components/command-center/AlertRow';
import CommandCenterMockDataBanner from '../../../components/command-center/MockDataBanner';

type LoadState = 'idle' | 'loading' | 'refreshing' | 'data' | 'error';

interface Props {
  onSelectClient?: (userId: string, displayName: string) => void;
}

export default function ActionQueueScreen({ onSelectClient }: Props) {
  const [state, setState] = useState<LoadState>('idle');
  const [items, setItems] = useState<ActionQueueItem[]>([]);
  const [totalPending, setTotalPending] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    setState(isRefresh ? 'refreshing' : 'loading');
    try {
      const res = await commandCenterApi.getActionQueue();
      setItems(res.data.items.filter((i) => i.dismissed_at === null));
      setTotalPending(res.data.total_pending);
      setState('data');
    } catch {
      setErrorMessage('Unable to load action queue. Check your connection and try again.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const handleDismiss = useCallback(
    async (alertId: string, clientName: string) => {
      // Optimistic removal
      setItems((prev) => prev.filter((i) => i.alert_id !== alertId));
      setTotalPending((prev) => Math.max(0, prev - 1));
      try {
        await commandCenterApi.dismissAlert(alertId);
      } catch {
        // Roll back optimistic removal and show error
        load(false);
        Alert.alert(
          'Could not dismiss alert',
          `The alert for ${clientName} could not be dismissed. Please try again.`,
          [{ text: 'OK' }],
        );
      }
    },
    [load],
  );

  if (state === 'loading') {
    return (
      <View style={styles.centred} testID="command-center-action-queue">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  if (state === 'error' && items.length === 0) {
    return (
      <View style={styles.centred} testID="command-center-action-queue">
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity
          onPress={() => load(false)}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry loading action queue"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="command-center-action-queue">
      <CommandCenterMockDataBanner />
      <FlatList
        data={items}
        keyExtractor={(item) => item.alert_id}
        contentContainerStyle={
          items.length === 0 ? styles.emptyContent : styles.listContent
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
            <Text style={styles.heading}>Action Queue</Text>
            {totalPending > 0 ? (
              <Text style={styles.subheading}>
                {totalPending} {totalPending === 1 ? 'action' : 'actions'} waiting
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrapper}>
            <Text style={styles.emptyTitle}>No pending actions</Text>
            <Text style={styles.emptyBody}>
              Alerts for missed check-ins, high churn risk, and Build Week gates
              will appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <AlertRow
            clientName={item.client_name}
            message={item.message}
            onPress={() => onSelectClient?.(item.client_id, item.client_name)}
            onDismiss={() => handleDismiss(item.alert_id, item.client_name)}
            testID="command-center-action-queue-row"
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
