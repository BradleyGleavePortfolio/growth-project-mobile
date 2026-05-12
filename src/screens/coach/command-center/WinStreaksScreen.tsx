// Coach Command Center — Win Streaks screen.
//
// Lists clients with active streaks >= 3 days, sorted by streak_days desc.
// Streak types: check_in, workout, weight_log.
//
// State machine:
//   idle → loading → (data | error)
//   Pull-to-refresh transitions loading → data/error.
//
// Data source: commandCenterApi.getWinStreaks()
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
  WinStreakEntry,
} from '../../../services/commandCenterApi';
import CommandCenterMockDataBanner from '../../../components/command-center/MockDataBanner';

type LoadState = 'idle' | 'loading' | 'refreshing' | 'data' | 'error';

const STREAK_TYPE_LABEL: Record<string, string> = {
  check_in:   'Check-in streak',
  workout:    'Training streak',
  weight_log: 'Weight tracking streak',
};

interface Props {
  onSelectClient?: (userId: string, displayName: string) => void;
}

function StreakRow({
  item,
  onPress,
}: {
  item: WinStreakEntry;
  onPress: () => void;
}) {
  const typeLabel = STREAK_TYPE_LABEL[item.streak_type] ?? item.streak_type;

  return (
    <TouchableOpacity
      onPress={onPress}
      testID="command-center-win-streak-row"
      accessibilityRole="button"
      accessibilityLabel={`${item.display_name}. ${item.streak_days} day ${typeLabel}.`}
      style={styles.row}
      activeOpacity={0.75}
    >
      <View style={styles.streakDaysBadge}>
        <Text style={styles.streakDaysValue}>{item.streak_days}</Text>
        <Text style={styles.streakDaysUnit}>days</Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.clientName} numberOfLines={1}>
          {item.display_name}
        </Text>
        <Text style={styles.streakType} numberOfLines={1}>
          {typeLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function WinStreaksScreen({ onSelectClient }: Props) {
  const [state, setState] = useState<LoadState>('idle');
  const [items, setItems] = useState<WinStreakEntry[]>([]);
  const [totalStreaks, setTotalStreaks] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    setState(isRefresh ? 'refreshing' : 'loading');
    try {
      const res = await commandCenterApi.getWinStreaks();
      setItems(res.data.items);
      setTotalStreaks(res.data.total_active_streaks);
      setState('data');
    } catch {
      setErrorMessage('Unable to load win streaks. Check your connection and try again.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (state === 'loading') {
    return (
      <View style={styles.centred} testID="command-center-win-streaks">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  if (state === 'error' && items.length === 0) {
    return (
      <View style={styles.centred} testID="command-center-win-streaks">
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity
          onPress={() => load(false)}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry loading win streaks"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="command-center-win-streaks">
      <CommandCenterMockDataBanner />
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.user_id}-${item.streak_type}`}
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
            <Text style={styles.heading}>Win Streaks</Text>
            {totalStreaks > 0 ? (
              <Text style={styles.subheading}>
                {totalStreaks} {totalStreaks === 1 ? 'client is' : 'clients are'} on an active streak
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrapper}>
            <Text style={styles.emptyTitle}>No active streaks</Text>
            <Text style={styles.emptyBody}>
              Clients with 3 or more consecutive days of check-ins, training,
              or weight logging will appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <StreakRow
            item={item}
            onPress={() => onSelectClient?.(item.user_id, item.display_name)}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.forest,
  },
  streakDaysBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.lg,
    minWidth: 40,
  },
  streakDaysValue: {
    ...typography.h2,
    color: colors.forest,
    lineHeight: 28,
  },
  streakDaysUnit: {
    ...typography.eyebrow,
    color: colors.stone,
  },
  rowContent: {
    flex: 1,
  },
  clientName: {
    ...typography.bodyMd,
    color: colors.ink,
    marginBottom: 2,
  },
  streakType: {
    ...typography.bodySmall,
    color: colors.stone,
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
