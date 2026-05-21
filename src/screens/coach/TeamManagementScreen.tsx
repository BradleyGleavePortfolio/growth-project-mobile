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
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../constants/colors';
import { subCoachApi, SubCoachSummary } from '../../api/subCoachApi';
import { coachTeamApi } from '../../api/coachTeamApi';
import { authApi } from '../../services/api';
import type { TeamStackParamList } from '../../navigation/CoachNavigator';
import SubCoachInviteModal from './SubCoachInviteModal';

const SCALE_TIERS = ['scale', 'enterprise'];

// Read the head coach's own plan tier from /auth/me, falling back to the
// cached user_data blob if the network call fails. The previous code inferred
// tier from `data[0].coach_profile.plan_tier`, which broke on the empty case
// (head coach with zero sub-coaches saw the upgrade gate even on Scale).
async function resolveHeadCoachTier(): Promise<string> {
  try {
    const me = await authApi.me();
    const tier =
      (me.data as { plan_tier?: string; profile?: { plan_tier?: string } } | undefined)
        ?.plan_tier ||
      (me.data as { profile?: { plan_tier?: string } } | undefined)?.profile?.plan_tier;
    if (tier) return tier;
  } catch {
    // fall through to cache
  }
  try {
    const raw = await AsyncStorage.getItem('user_data');
    if (raw) {
      const parsed = JSON.parse(raw);
      const cached: string | undefined =
        parsed?.plan_tier || parsed?.profile?.plan_tier;
      if (cached) return cached;
    }
  } catch {
    // ignore
  }
  return 'flat_300';
}

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
  const [inviteOpen, setInviteOpen] = useState(false);
  // P0-3 — remaining seat headroom for the invite modal's `maxClients`
  // clamp. `null` means "unknown" (team profile not yet loaded / endpoint
  // not configured); the modal skips the clamp in that case rather than
  // blocking.
  const [remainingSeats, setRemainingSeats] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Always resolve the head coach's tier from their own profile, regardless
    // of whether sub-coaches exist yet.
    const tier = await resolveHeadCoachTier();
    setPlanTier(tier);
    // P0-3 — fetch seat headroom in parallel with the roster. A failure here
    // is non-fatal: the modal degrades to "no clamp" rather than blocking
    // invites, but on the happy path we surface the exact remaining-seat
    // count so the head coach sees structured headroom feedback.
    void coachTeamApi.getProfile().then((profileResult) => {
      if (profileResult.ok) {
        const headroom =
          profileResult.data.client_capacity - profileResult.data.clients_assigned;
        setRemainingSeats(headroom >= 0 ? headroom : 0);
      } else {
        setRemainingSeats(null);
      }
    });
    try {
      const res = await subCoachApi.listSubCoaches();
      setSubCoaches(res.data ?? []);
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
      <View style={styles.headerRow}>
        <Text style={styles.header}>Team</Text>
        <Pressable
          onPress={() => setInviteOpen(true)}
          style={styles.addBtn}
          accessibilityRole="button"
          accessibilityLabel="Invite sub-coach"
        >
          <Ionicons name="add" size={18} color={Colors.textOnPrimary} />
          <Text style={styles.addBtnText}>Invite</Text>
        </Pressable>
      </View>

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
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              No sub-coaches yet. Tap Invite to add your first one.
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />

      <SubCoachInviteModal
        visible={inviteOpen}
        onDismiss={() => setInviteOpen(false)}
        onInvited={() => {
          // Refresh the roster — newly invited sub-coaches appear once they
          // accept, but we still re-fetch in case the backend pre-creates a
          // pending row.
          void load();
        }}
        existingEmails={subCoaches.map((s) => s.email)}
        remainingSeats={remainingSeats ?? undefined}
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
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    gap: 4,
  },
  addBtnText: {
    color: Colors.textOnPrimary,
    fontWeight: '600',
    fontSize: 13,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
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
    fontWeight: '600',
    color: Colors.textOnPrimary,
  },
  gate: {
    flex: 1,
    paddingTop: 40,
    alignItems: 'center',
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: '600',
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
