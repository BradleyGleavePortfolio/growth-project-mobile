/**
 * CoachBriefScreen — Wave 11.
 *
 * Daily morning brief for coaches. Shows AI-drafted summary, signoff queue,
 * and a per-client cards strip. STUB: backend not live yet; the adapter
 * returns an empty, stale payload.
 *
 * Doctrine: every AI block requires the coach to approve before posting
 * (e.g. as an announcement). The `approveDraft` toggle below is local-state
 * only until the live endpoint exists.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as tokens, typography, spacing } from '../../theme/tokens';
import { fetchCoachBrief } from '../../services/wave11Adapters';
import type { CoachBriefPayload, CoachBriefClientCard } from '../../types/wave11';
import AINote from '../../components/trust/AINote';
import VerifiedProgressRow from '../../components/trust/VerifiedProgressRow';
import EmptyState from '../../components/EmptyState';
import { featureFlags } from '../../config/featureFlags';

export default function CoachBriefScreen() {
  const [payload, setPayload] = useState<CoachBriefPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draftApproved, setDraftApproved] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchCoachBrief();
      setPayload(next);
      setDraftApproved(next.morningSummary.approvedByCoach);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!featureFlags.coachBrief) {
    return (
      <View
        style={styles.flagOff}
        accessibilityLabel="Coach Brief is preview-only"
        accessibilityRole="none"
      >
        <EmptyState
          icon="lock-closed-outline"
          title="Coach Brief is preview-only"
          subtitle="The morning brief is in development. We'll enable it for your account once the live data feed ships."
        />
      </View>
    );
  }

  if (loading && !payload) {
    return (
      <View
        style={styles.center}
        accessibilityLabel="Loading today's brief"
        accessibilityRole="none"
      >
        <ActivityIndicator color={tokens.forest} />
      </View>
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      accessibilityLabel="Coach Brief screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          accessibilityLabel="Pull to refresh today's brief"
        />
      }
    >
      <Text style={styles.title} accessibilityRole="header">Today&apos;s brief</Text>
      <Text style={styles.subtitle}>
        AI drafts the summary. You approve before anything is sent.
      </Text>

      {payload?.isStale ? (
        <View
          style={styles.stale}
          accessibilityLabel="Brief data is not yet live"
          accessibilityRole="none"
        >
          <Ionicons name="time-outline" size={14} color={tokens.charcoal} />
          <Text style={styles.staleText}>Brief data isn&apos;t live yet.</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Morning summary</Text>
        {payload?.morningSummary.aiDraft ? (
          <>
            <AINote variant="draft">{payload.morningSummary.aiDraft}</AINote>
            <Pressable
              onPress={() => setDraftApproved((v) => !v)}
              style={[styles.approveBtn, draftApproved && styles.approveBtnOn]}
              accessibilityRole="button"
              accessibilityLabel={draftApproved ? 'Draft approved — tap to revoke' : 'Approve draft to send'}
              accessibilityState={{ checked: draftApproved }}
            >
              <Ionicons
                name={draftApproved ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={draftApproved ? tokens.bone : tokens.forest}
              />
              <Text
                style={[
                  styles.approveLabel,
                  draftApproved && styles.approveLabelOn,
                ]}
              >
                {draftApproved ? 'Approved by you' : 'Approve to send'}
              </Text>
            </Pressable>
          </>
        ) : (
          <EmptyState
            icon="sunny-outline"
            title="No brief yet"
            subtitle="Once your clients log activity, the AI will draft a summary you can review and approve."
          />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Clients</Text>
        {payload && payload.clients.length > 0 ? (
          payload.clients.map((c) => <ClientCard key={c.clientId} card={c} />)
        ) : (
          <EmptyState
            icon="people-outline"
            title="No client activity to surface"
            subtitle="Clients will appear here when they log a check-in, hit a streak, or submit a verified-progress claim."
          />
        )}
      </View>
    </ScrollView>
  );
}

function ClientCard({ card }: { card: CoachBriefClientCard }) {
  return (
    <View
      style={styles.card}
      accessibilityRole="none"
      accessibilityLabel={`Client: ${card.clientDisplayName}`}
    >
      <Text style={styles.cardHeadline}>{card.clientDisplayName}</Text>
      <AINote variant="summary">{card.aiSummary}</AINote>
      {card.aiFlags.length > 0 ? (
        <View
          style={styles.flagsBlock}
          accessibilityLabel={`AI flagged ${card.aiFlags.length} items for your review`}
          accessibilityRole="none"
        >
          <Text style={styles.flagsLabel}>AI flagged for your review:</Text>
          {card.aiFlags.map((f, i) => (
            <Text key={i} style={styles.flagText}>
              · {f}
            </Text>
          ))}
        </View>
      ) : null}
      {card.todos.length > 0 ? (
        <View
          style={styles.todos}
          accessibilityLabel={`${card.todos.length} action items`}
          accessibilityRole="none"
        >
          {card.todos.map((t) => (
            <View key={t.id} style={styles.todoRow}>
              <Ionicons name="square-outline" size={14} color={tokens.charcoal} />
              <Text style={styles.todoText}>{t.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {card.latestVerifiedProgress ? (
        <VerifiedProgressRow item={card.latestVerifiedProgress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: tokens.bone },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  flagOff: { flex: 1, backgroundColor: tokens.bone, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.bone },
  title: { ...typography.h1, color: tokens.ink, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: tokens.charcoal, marginBottom: spacing.lg },
  stale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  staleText: { ...typography.bodySmall, color: tokens.charcoal },
  section: { marginTop: spacing.lg, gap: spacing.md },
  sectionTitle: { ...typography.h3, color: tokens.ink, marginBottom: spacing.xs },
  card: {
    backgroundColor: tokens.cream,
    borderRadius: 4,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeadline: { ...typography.h4, color: tokens.ink },
  flagsBlock: { gap: 4 },
  flagsLabel: {
    ...typography.bodySmall,
    color: tokens.charcoal,
    fontWeight: '600',
  },
  flagText: { ...typography.bodySmall, color: tokens.charcoal },
  todos: { gap: 6 },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  todoText: { ...typography.bodySmall, color: tokens.ink },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: tokens.forest,
    alignSelf: 'flex-start',
  },
  approveBtnOn: { backgroundColor: tokens.forest, borderColor: tokens.forest },
  approveLabel: {
    ...typography.bodyMd,
    fontSize: 14,
    color: tokens.forest,
    fontWeight: '600',
  },
  approveLabelOn: { color: tokens.bone },
});
