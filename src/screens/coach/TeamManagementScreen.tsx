/**
 * TeamManagementScreen
 *
 * Displays the head coach's sub-coach roster with an engagement score badge
 * for each sub-coach. Tapping a row navigates to SubCoachDetailScreen.
 *
 * No coach plan gate and no plan-based client cap (owner TM-P1: zero locks).
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
import { Colors } from '../../constants/colors';
import { subCoachApi, SubCoachSummary } from '../../api/subCoachApi';
import type { TeamStackParamList } from '../../navigation/CoachNavigator';
import SubCoachInviteModal from './SubCoachInviteModal';
import LoadFailedNotice from '../../components/coach/LoadFailedNotice';
import { Screen } from '../../ui';
import { radius } from '../../theme/tokens';

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
      </View>
      <ScoreBadge score={item.engagement.score} />
    </Pressable>
  );
}

export default function TeamManagementScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<TeamStackParamList>>();

  const [subCoaches, setSubCoaches] = useState<SubCoachSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await subCoachApi.listSubCoaches();
      setSubCoaches(res.data ?? []);
    } catch {
      setError('Your team could not load.');
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // COACH-INSETS-B-134 (B13 B28 B39): the shared Screen owns the status-bar
  // inset (Android edge-to-edge included); the tab bar owns the bottom.
  return (
    <Screen edges={['top']} scroll={false} contentStyle={styles.body} testID="team-management">
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

      {/* QA-COACH-HOME-131 (U4): a failed read is said in words, without red,
          and the empty line below stays hidden because it would be false. */}
      {error != null && (
        <LoadFailedNotice message={error} onRetry={() => void load()} testID="team-load-error" />
      )}

      <FlatList
        data={subCoaches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SubCoachRow item={item} onPress={handlePress} />
        )}
        ListEmptyComponent={
          error == null ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No sub-coaches yet. Tap Invite to add your first one.
              </Text>
            </View>
          ) : null
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
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The list pads its own foot; Screen keeps the 24 pt gutter.
  body: { paddingBottom: 0 },
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
    borderRadius: radius.button,
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
    borderRadius: radius.card,
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
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textOnPrimary,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
});
