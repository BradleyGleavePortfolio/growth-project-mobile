// CoachUpcomingCallsScreen — confirmed calls + complete/no-show actions.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  COACH_UPCOMING_CALLS,
  SESSIONS_DISABLED_PLACEHOLDER,
  sessionTypeLabel,
  statusLabelFor,
} from '../../constants/sessionsCopy';
import { isSessionsFeatureEnabled } from '../../config/sessionsFlags';
import { getSessionsAdapter } from '../../services/sessions/sessionsClient';
import { canMarkComplete } from '../../lib/sessionsStatusDisplay';
import MockDataBanner from '../../components/sessions/MockDataBanner';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type { CoachingSession } from '../../types/sessions';

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'CoachUpcomingCalls'>;
  route: RouteProp<ClientsStackParamList, 'CoachUpcomingCalls'>;
};

export default function CoachUpcomingCallsScreen({ route }: Props) {
  const { coachId } = route.params;
  const enabled = isSessionsFeatureEnabled('SESSIONS_ENABLED');
  const [items, setItems] = useState<CoachingSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const list = await getSessionsAdapter().listUpcomingForCoach(coachId);
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, coachId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!enabled) {
    return (
      <View style={styles.root} testID="coach-upcoming-disabled">
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>
            {SESSIONS_DISABLED_PLACEHOLDER.title}
          </Text>
          <Text style={styles.placeholderBody}>
            {SESSIONS_DISABLED_PLACEHOLDER.body}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MockDataBanner />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={styles.heading} accessibilityRole="header">
          {COACH_UPCOMING_CALLS.title}
        </Text>
        {items.length === 0 ? (
          <View style={styles.placeholderInline} testID="coach-upcoming-empty">
            <Text style={styles.placeholderTitle}>No upcoming calls</Text>
            <Text style={styles.placeholderBody}>
              Confirmed calls with your clients will appear here.
            </Text>
          </View>
        ) : (
          items.map((s) => {
            const canComplete = canMarkComplete(s);
            const typeLabel = sessionTypeLabel(s.type);
            const timeLabel = new Date(s.startsAt).toLocaleString();
            return (
              <View
                key={s.id}
                style={styles.card}
                testID={`coach-upcoming-${s.id}`}
                accessible
                accessibilityLabel={`${typeLabel}, ${timeLabel}, ${statusLabelFor(s.status, 'coach')}`}
              >
                <Text style={styles.cardType}>{typeLabel}</Text>
                <Text style={styles.cardTime}>{timeLabel}</Text>
                <Text style={styles.cardStatus}>
                  {statusLabelFor(s.status, 'coach')}
                </Text>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.action, !canComplete && styles.actionDisabled]}
                    disabled={!canComplete}
                    accessibilityLabel={`${COACH_UPCOMING_CALLS.markCompleteAction} for ${typeLabel} call`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canComplete }}
                    testID={`coach-mark-complete-${s.id}`}
                  >
                    <Text style={styles.actionLabel}>
                      {COACH_UPCOMING_CALLS.markCompleteAction}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.action, !canComplete && styles.actionDisabled]}
                    disabled={!canComplete}
                    accessibilityLabel={`${COACH_UPCOMING_CALLS.markNoShowClientAction} for ${typeLabel} call`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canComplete }}
                    testID={`coach-mark-noshow-client-${s.id}`}
                  >
                    <Text style={styles.actionLabel}>
                      {COACH_UPCOMING_CALLS.markNoShowClientAction}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bone },
  scroll: { flex: 1 },
  content: { padding: spacing.lg },
  heading: { ...typography.h2, color: colors.ink, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.cream,
    padding: spacing.lg,
    borderRadius: 8,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.camel,
  },
  cardType: { ...typography.eyebrow, color: colors.charcoal },
  cardTime: { ...typography.h3, color: colors.ink, marginTop: spacing.xs },
  cardStatus: { ...typography.body, color: colors.forest, marginTop: spacing.xs },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  action: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.camel,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionDisabled: { opacity: 0.4 },
  actionLabel: { ...typography.caption, color: colors.charcoal },
  placeholder: {
    flex: 1,
    margin: spacing.lg,
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderInline: {
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: 'center',
  },
  placeholderTitle: {
    ...typography.h3,
    color: colors.ink,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  placeholderBody: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
});
