/**
 * ClientPathCopilotScreen — Wave 11.
 *
 * Route shell for the Client Path Copilot.
 *
 * Status: STUB. Backend endpoint is not live. The screen reads through a
 * mock-safe adapter (`fetchClientPathCopilot`) that returns an empty,
 * `isStale: true` payload until the live endpoint ships. The UI honestly
 * renders that as an empty state — we do not fabricate suggestions.
 *
 * Doctrine encoded in this screen:
 *   - Every AI block is wrapped in <AINote/> with the canonical disclaimer.
 *   - Verified-progress submissions are listed with the lifecycle chip;
 *     "approved" treatments require a human signoff actor.
 *   - The screen is gated by `featureFlags.clientPathCopilot`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as tokens, typography, spacing } from '../../theme/tokens';
import { fetchClientPathCopilot } from '../../services/wave11Adapters';
import type { ClientPathCopilotPayload, CopilotSuggestion } from '../../types/wave11';
import AINote from '../../components/trust/AINote';
import VerifiedProgressRow from '../../components/trust/VerifiedProgressRow';
import EmptyState from '../../components/EmptyState';
import { featureFlags } from '../../config/featureFlags';

export default function ClientPathCopilotScreen() {
  const [payload, setPayload] = useState<ClientPathCopilotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchClientPathCopilot();
      setPayload(next);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (!featureFlags.clientPathCopilot) {
    return (
      <View
        style={styles.flagOff}
        accessibilityLabel="Copilot is preview-only"
        accessibilityRole="none"
      >
        <EmptyState
          icon="lock-closed-outline"
          title="Copilot is preview-only"
          subtitle="The Client Path Copilot is in development and not yet available on your account."
        />
      </View>
    );
  }

  if (loading && !payload) {
    return (
      <View
        style={styles.center}
        accessibilityLabel="Loading your path data"
        accessibilityRole="none"
      >
        <ActivityIndicator color={tokens.forest} />
      </View>
    );
  }

  const empty = !payload || payload.suggestions.length === 0;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      accessibilityLabel="Client Path Copilot screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          accessibilityLabel="Pull to refresh your path data"
        />
      }
    >
      <Text style={styles.title} accessibilityRole="header">Your path</Text>
      <Text style={styles.subtitle}>
        AI summarises what you logged. Your coach decides what changes.
      </Text>

      {payload?.isStale ? (
        <View
          style={styles.stale}
          accessibilityLabel="Data not yet live — pull to refresh"
          accessibilityRole="none"
        >
          <Ionicons name="time-outline" size={14} color={tokens.charcoal} />
          <Text style={styles.staleText}>
            Latest update isn&apos;t live yet — pull to refresh.
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Suggestions</Text>
        {empty ? (
          <EmptyState
            icon="sparkles-outline"
            title="No suggestions yet"
            subtitle="Once you log a few days, your Copilot will summarise the patterns it sees and your coach will weigh in."
          />
        ) : (
          payload!.suggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} />)
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Verified progress</Text>
        {payload && payload.pendingVerifiedProgress.length > 0 ? (
          <View style={styles.list}>
            {payload.pendingVerifiedProgress.map((item) => (
              <VerifiedProgressRow key={item.id} item={item} />
            ))}
          </View>
        ) : (
          <EmptyState
            icon="ribbon-outline"
            title="No pending submissions"
            subtitle="Submit a milestone or check-in and your coach will review and sign off."
          />
        )}
      </View>
    </ScrollView>
  );
}

function SuggestionCard({ suggestion }: { suggestion: CopilotSuggestion }) {
  return (
    <View
      style={styles.card}
      accessibilityRole="none"
      accessibilityLabel={`Suggestion: ${suggestion.headline}`}
    >
      <Text style={styles.cardHeadline}>{suggestion.headline}</Text>
      <AINote
        variant="summary"
        disclaimer={suggestion.topic === 'finance' ? 'finance' : 'general'}
      >
        {suggestion.body}
      </AINote>
      {suggestion.requiresCoachApproval ? (
        <View
          style={styles.statusRow}
          accessibilityLabel={
            suggestion.coachApproval
              ? 'Approved by your coach'
              : 'Awaiting coach approval'
          }
          accessibilityRole="none"
        >
          {suggestion.coachApproval ? (
            <Text style={[styles.statusText, styles.approved]}>
              <Ionicons name="checkmark-circle" size={14} color={tokens.forest} />{' '}
              Approved by your coach
            </Text>
          ) : (
            <Text style={styles.statusText}>
              <Ionicons name="time-outline" size={14} color={tokens.charcoal} /> Awaiting
              coach approval
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: tokens.bone },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  flagOff: { flex: 1, backgroundColor: tokens.bone, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.bone },
  title: {
    ...typography.h1,
    color: tokens.ink,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: tokens.charcoal,
    marginBottom: spacing.lg,
  },
  stale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  staleText: { ...typography.bodySmall, color: tokens.charcoal },
  section: { marginTop: spacing.lg, gap: spacing.md },
  sectionTitle: {
    ...typography.h3,
    color: tokens.ink,
    marginBottom: spacing.xs,
  },
  list: { gap: spacing.sm },
  card: {
    backgroundColor: tokens.cream,
    borderRadius: 4,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeadline: {
    ...typography.h4,
    color: tokens.ink,
  },
  statusRow: { marginTop: spacing.xs },
  statusText: {
    ...typography.bodySmall,
    color: tokens.charcoal,
  },
  approved: { color: tokens.forest, fontWeight: '600' },
});
