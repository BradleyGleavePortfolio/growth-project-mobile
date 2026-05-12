// Coach Command Center — At-Risk screen.
//
// Lists clients with PTM risk bucket amber or red.
// Sorted by severity (red first), then by days_since_checkin desc.
//
// State machine:
//   idle → loading → (data | error)
//   Pull-to-refresh transitions loading → data/error.
//
// Data source: commandCenterApi.getAtRisk()
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
  AtRiskEntry,
} from '../../../services/commandCenterApi';
import AlertRow from '../../../components/command-center/AlertRow';
import CommandCenterMockDataBanner from '../../../components/command-center/MockDataBanner';

type LoadState = 'idle' | 'loading' | 'refreshing' | 'data' | 'error';

interface Props {
  /** Navigate to a client's detail screen. */
  onSelectClient?: (userId: string, displayName: string) => void;
}

export default function AtRiskScreen({ onSelectClient }: Props) {
  const [state, setState] = useState<LoadState>('idle');
  const [items, setItems] = useState<AtRiskEntry[]>([]);
  const [totalAtRisk, setTotalAtRisk] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    setState(isRefresh ? 'refreshing' : 'loading');
    try {
      const res = await commandCenterApi.getAtRisk();
      setItems(res.data.items);
      setTotalAtRisk(res.data.total_at_risk);
      setState('data');
    } catch {
      setErrorMessage('Unable to load at-risk clients. Check your connection and try again.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (state === 'loading') {
    return (
      <View style={styles.centred} testID="command-center-at-risk">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  if (state === 'error' && items.length === 0) {
    return (
      <View style={styles.centred} testID="command-center-at-risk">
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity
          onPress={() => load(false)}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry loading at-risk clients"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="command-center-at-risk">
      <CommandCenterMockDataBanner />
      <FlatList
        data={items}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={
          items.length === 0
            ? styles.emptyContent
            : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={state === 'refreshing'}
            onRefresh={() => load(true)}
            tintColor={colors.forest}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.heading}>At-Risk Clients</Text>
            {totalAtRisk > 0 ? (
              <Text style={styles.subheading}>
                {totalAtRisk} {totalAtRisk === 1 ? 'client needs' : 'clients need'} your attention
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrapper}>
            <Text style={styles.emptyTitle}>No at-risk clients</Text>
            <Text style={styles.emptyBody}>
              All 0.3+ risk-score clients will appear here. Check back after the
              nightly PTM score run.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <AlertRow
            clientName={item.display_name}
            message={item.top_factor}
            bucket={item.bucket}
            onPress={() => onSelectClient?.(item.user_id, item.display_name)}
            testID="command-center-at-risk-row"
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
  header: {
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
