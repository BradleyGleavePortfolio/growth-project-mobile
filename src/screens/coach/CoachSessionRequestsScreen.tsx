// CoachSessionRequestsScreen — queue of incoming client call requests.

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
  COACH_REQUEST_QUEUE,
  SESSIONS_DISABLED_PLACEHOLDER,
  sessionTypeLabel,
  statusLabelFor,
} from '../../constants/sessionsCopy';
import { isSessionsFeatureEnabled } from '../../config/sessionsFlags';
import { getSessionsAdapter } from '../../services/sessions/sessionsClient';
import MockDataBanner from '../../components/sessions/MockDataBanner';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type { SessionRequestSummary } from '../../types/sessions';

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'CoachSessionRequests'>;
  route: RouteProp<ClientsStackParamList, 'CoachSessionRequests'>;
};

export default function CoachSessionRequestsScreen({ route }: Props) {
  const { coachId } = route.params;
  const enabled = isSessionsFeatureEnabled('SESSIONS_ENABLED');
  const [items, setItems] = useState<SessionRequestSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const list = await getSessionsAdapter().listRequestsForCoach(coachId);
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
      <View style={styles.root} testID="coach-requests-disabled">
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
          {COACH_REQUEST_QUEUE.title}
        </Text>
        {items === null || items.length === 0 ? (
          <View style={styles.placeholderInline} testID="coach-requests-empty">
            <Text style={styles.placeholderTitle}>
              {COACH_REQUEST_QUEUE.emptyTitle}
            </Text>
            <Text style={styles.placeholderBody}>
              {COACH_REQUEST_QUEUE.emptyBody}
            </Text>
          </View>
        ) : (
          items.map((it) => (
            <View
              key={it.session.id}
              style={styles.card}
              testID={`coach-request-${it.session.id}`}
              accessible
              accessibilityLabel={`Request from ${it.clientDisplayName}: ${sessionTypeLabel(it.session.type)}, ${Math.round(it.ageMinutes)} minutes ago`}
            >
              <Text style={styles.cardName}>{it.clientDisplayName}</Text>
              <Text style={styles.cardType}>
                {sessionTypeLabel(it.session.type)} ·{' '}
                {Math.round(it.ageMinutes)}m ago
              </Text>
              <Text style={styles.cardStatus}>
                {statusLabelFor(it.session.status, 'coach')}
              </Text>
              {it.session.clientRequestNote ? (
                <Text style={styles.cardNote}>{it.session.clientRequestNote}</Text>
              ) : null}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.primary}
                  accessibilityLabel={`${COACH_REQUEST_QUEUE.approveAction} for ${it.clientDisplayName}`}
                  accessibilityRole="button"
                  testID={`coach-request-approve-${it.session.id}`}
                >
                  <Text style={styles.primaryLabel}>
                    {COACH_REQUEST_QUEUE.approveAction}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondary}
                  accessibilityLabel={`${COACH_REQUEST_QUEUE.declineAction} request from ${it.clientDisplayName}`}
                  accessibilityRole="button"
                  testID={`coach-request-decline-${it.session.id}`}
                >
                  <Text style={styles.secondaryLabel}>
                    {COACH_REQUEST_QUEUE.declineAction}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
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
  cardName: { ...typography.h3, color: colors.ink },
  cardType: { ...typography.caption, color: colors.charcoal, marginTop: spacing.xs },
  cardStatus: { ...typography.body, color: colors.forest, marginTop: spacing.xs },
  cardNote: {
    ...typography.body,
    color: colors.charcoal,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  actionRow: { flexDirection: 'row', marginTop: spacing.md },
  primary: {
    backgroundColor: colors.forest,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    marginRight: spacing.sm,
  },
  primaryLabel: { ...typography.bodyMd, color: colors.bone },
  secondary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.camel,
  },
  secondaryLabel: { ...typography.bodyMd, color: colors.charcoal },
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
