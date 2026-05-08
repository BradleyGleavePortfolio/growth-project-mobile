/**
 * TeamManagementScreen
 *
 * Tier-gated (Scale plan or higher). Displays the head coach's sub-coach
 * roster with a capacity bar (assigned / max clients) and an engagement
 * score badge for each sub-coach. Tapping a row navigates to
 * SubCoachDetailScreen.
 *
 * Shown only when plan_tier is 'scale' or 'enterprise'. All other plan
 * tiers see an upgrade prompt.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../constants/colors';
import { subCoachApi, SubCoachSummary } from '../../api/subCoachApi';
import type { TeamStackParamList } from '../../navigation/CoachNavigator';

const SCALE_TIERS = ['scale', 'enterprise'];

function CapacityBar({
  assigned,
  max,
}: {
  assigned: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(1, assigned / max) : 0;
  const barColor =
    pct >= 1
      ? Colors.error
      : pct >= 0.8
        ? Colors.warning
        : Colors.primary;

  return (
    <View style={styles.capacityContainer}>
      <View style={styles.capacityTrack}>
        <View
          style={[styles.capacityFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: barColor }]}
        />
      </View>
      <Text style={styles.capacityLabel} accessibilityLabel={`${assigned} of ${max} clients`}>
        {assigned} / {max}
      </Text>
    </View>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const bg =
    score >= 80
      ? Colors.success
      : score >= 50
        ? Colors.warning
        : Colors.error;

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={styles.badgeText} accessibilityLabel={`Engagement score ${score}`}>
        {score}
      </Text>
    </View>
  );
}

function SubCoachRow({
  item,
  onPress,
}: {
  item: SubCoachSummary;
  onPress: (item: SubCoachSummary) => void;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`View details for ${item.name}`}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{item.name}</Text>
        <Text style={styles.rowEmail}>{item.email}</Text>
        <CapacityBar
          assigned={item.capacity.assignedClients}
          max={item.capacity.maxClients}
        />
      </View>
      <ScoreBadge score={item.engagement.score} />
    </Pressable>
  );
}

function UpgradeGate() {
  return (
    <View style={styles.gate}>
      <Text style={styles.gateTitle}>Scale plan required</Text>
      <Text style={styles.gateBody}>
        Team management is available on the Scale plan and above. Upgrade to
        add sub-coaches and delegate clients.
      </Text>
    </View>
  );
}

export default function TeamManagementScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<TeamStackParamList>>();

  const [subCoaches, setSubCoaches] = useState<SubCoachSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planTier, setPlanTier] = useState<string>('flat_300');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await subCoachApi.listSubCoaches();
      const data: SubCoachSummary[] = res.data ?? [];
      setSubCoaches(data);
      // Infer the head coach's tier from the first sub-coach's profile
      // (all share the same billing plan) or fall back to a default.
      if (data.length > 0 && data[0].coach_profile?.plan_tier) {
        setPlanTier(data[0].coach_profile.plan_tier);
      }
    } catch {
      setError('Could not load team. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePress = useCallback(
    (item: SubCoachSummary) => {
      navigation.navigate('SubCoachDetail', {
        subCoachId: item.id,
        subCoachName: item.name,
      });
    },
    [navigation],
  );

  const isGated = !SCALE_TIERS.includes(planTier);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (isGated) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Team</Text>
        <UpgradeGate />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Team</Text>

      {error != null && (
        <Pressable
          onPress={load}
          accessibilityRole="button"
          accessibilityLabel="Retry loading team"
        >
          <Text style={styles.errorText}>{error} Tap to retry.</Text>
        </Pressable>
      )}

      <FlatList
        data={subCoaches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SubCoachRow item={item} onPress={handlePress} />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No sub-coaches yet.</Text>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  center: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 20,
  },
  list: {
    paddingBottom: 24,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 4,
    padding: 16,
    gap: 12,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  rowEmail: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  capacityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  capacityTrack: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.divider,
    borderRadius: 2,
    overflow: 'hidden',
  },
  capacityFill: {
    height: '100%',
    borderRadius: 2,
  },
  capacityLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    minWidth: 44,
    textAlign: 'right',
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textOnPrimary,
  },
  gate: {
    flex: 1,
    paddingTop: 40,
    alignItems: 'center',
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  gateBody: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
});
