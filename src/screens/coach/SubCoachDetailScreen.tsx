/**
 * SubCoachDetailScreen
 *
 * Shows a sub-coach's full profile: their client list, engagement score
 * breakdown, and AI usage summary row. Accessed from TeamManagementScreen.
 *
 * Route params: { subCoachId: string; subCoachName: string }
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../constants/colors';
import {
  subCoachApi,
  SubCoachDetail,
  EngagementBreakdown,
} from '../../api/subCoachApi';
import type { TeamStackParamList } from '../../navigation/CoachNavigator';

function BreakdownRow({
  label,
  points,
  earned,
}: {
  label: string;
  points: number;
  earned: number;
}) {
  const hit = earned > 0;
  return (
    <View
      style={styles.breakdownRow}
      accessibilityLabel={`${label}: ${hit ? `+${points} earned` : 'not earned'}`}
    >
      <Text style={[styles.breakdownLabel, !hit && styles.breakdownMuted]}>
        {label}
      </Text>
      <Text style={[styles.breakdownPoints, hit ? styles.breakdownHit : styles.breakdownMiss]}>
        {hit ? `+${points}` : `+0 / ${points}`}
      </Text>
    </View>
  );
}

function ScoreCard({ score, breakdown }: { score: number; breakdown: EngagementBreakdown }) {
  return (
    <View style={styles.card}>
      <View style={styles.scoreHeader}>
        <Text style={styles.cardTitle}>Engagement</Text>
        <Text style={styles.scoreValue} accessibilityLabel={`Engagement score ${score} out of 100`}>
          {score}
          <Text style={styles.scoreMax}> / 100</Text>
        </Text>
      </View>
      <BreakdownRow label="Active within 7 days" points={20} earned={breakdown.logged_in_within_7d} />
      <BreakdownRow label="Responded within 48h of check-in" points={30} earned={breakdown.messaged_within_48h_of_checkin} />
      <BreakdownRow label="Updated workout plan this week" points={25} earned={breakdown.updated_workout_plan_this_week} />
      <BreakdownRow label="Client completion rate 70%+" points={25} earned={breakdown.avg_workout_completion_gte_70} />
    </View>
  );
}

export default function SubCoachDetailScreen() {
  const route = useRoute<RouteProp<TeamStackParamList, 'SubCoachDetail'>>();
  const navigation =
    useNavigation<NativeStackNavigationProp<TeamStackParamList>>();
  const { subCoachId } = route.params;

  const [detail, setDetail] = useState<SubCoachDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await subCoachApi.getSubCoach(subCoachId);
      setDetail(res.data);
    } catch {
      setError('Could not load sub-coach details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [subCoachId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReassign = useCallback(
    (clientId: string, clientName: string) => {
      navigation.navigate('ClientReassign', {
        clientId,
        clientName,
        fromSubCoachId: subCoachId,
      });
    },
    [navigation, subCoachId],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error !== null || detail === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Sub-coach not found.'}</Text>
        <Pressable
          onPress={load}
          style={styles.retryBtn}
          accessibilityRole="button"
          accessibilityLabel="Retry loading"
        >
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <Text style={styles.name}>{detail.name}</Text>
      <Text style={styles.email}>{detail.email}</Text>
      {detail.coach_profile?.business_name != null && (
        <Text style={styles.businessName}>{detail.coach_profile.business_name}</Text>
      )}
      {detail.coach_profile?.bio != null && (
        <Text style={styles.bio}>{detail.coach_profile.bio}</Text>
      )}

      {/* Capacity summary */}
      <View style={styles.capacityRow}>
        <Text style={styles.capacityStat} accessibilityLabel={`${detail.capacity.assignedClients} clients assigned`}>
          {detail.capacity.assignedClients}
          <Text style={styles.capacityStatLabel}> clients</Text>
        </Text>
        <Text style={styles.capacityStat}>
          {detail.capacity.maxClients}
          <Text style={styles.capacityStatLabel}> max ({detail.capacity.planTier})</Text>
        </Text>
      </View>

      {/* Engagement score card */}
      <ScoreCard
        score={detail.engagement.score}
        breakdown={detail.engagement.breakdown}
      />

      {/* Client list */}
      <Text style={styles.sectionTitle}>Clients</Text>
      {detail.clients.length === 0 ? (
        <Text style={styles.emptyText}>No clients assigned.</Text>
      ) : (
        detail.clients.map((client) => (
          <View key={client.id} style={styles.clientRow}>
            <View style={styles.clientInfo}>
              <Text style={styles.clientName}>{client.name}</Text>
              <Text style={styles.clientEmail}>{client.email}</Text>
            </View>
            <Pressable
              onPress={() => handleReassign(client.id, client.name)}
              style={styles.reassignBtn}
              accessibilityRole="button"
              accessibilityLabel={`Reassign ${client.name}`}
            >
              <Text style={styles.reassignBtnText}>Reassign</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingTop: 56,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  name: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  businessName: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  capacityRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 20,
  },
  capacityStat: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  capacityStatLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.textMuted,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 4,
    padding: 16,
    marginBottom: 24,
    gap: 10,
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  scoreValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.primary,
  },
  scoreMax: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textMuted,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 14,
    color: Colors.textPrimary,
    flex: 1,
  },
  breakdownMuted: {
    color: Colors.textMuted,
  },
  breakdownPoints: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  breakdownHit: {
    color: Colors.success,
  },
  breakdownMiss: {
    color: Colors.textMuted,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  clientEmail: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  reassignBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  reassignBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textOnPrimary,
  },
  errorText: {
    fontSize: 15,
    color: Colors.error,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textOnPrimary,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
});
