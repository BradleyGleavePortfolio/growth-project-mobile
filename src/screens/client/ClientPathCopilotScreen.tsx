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
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, type SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { fetchClientPathCopilot } from '../../services/wave11Adapters';
import type { ClientPathCopilotPayload, CopilotSuggestion } from '../../types/wave11';
import AINote from '../../components/trust/AINote';
import VerifiedProgressRow from '../../components/trust/VerifiedProgressRow';
import EmptyState from '../../components/EmptyState';
import { featureFlags } from '../../config/featureFlags';

export default function ClientPathCopilotScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const [error, setError] = useState(false);
  const [payload, setPayload] = useState<ClientPathCopilotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const next = await fetchClientPathCopilot();
      setPayload(next);
    } catch {
      setError(true);
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
        accessibilityLabel="Path suggestions unavailable"
        accessibilityRole="none"
      >
        <EmptyState
          icon="lock-closed-outline"
          title="Your path"
          subtitle="Path suggestions are not available on this account."
        />
      </View>
    );
  }

  if (loading && !payload) {
    return <SkeletonScreen count={5} />;
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
        Suggestions and submitted progress.
      </Text>

      {payload?.isStale ? (
        <View
          style={styles.stale}
          accessibilityLabel="Latest path data unavailable"
          accessibilityRole="none"
        >
          <Ionicons name="time-outline" size={14} color={sc.textMuted} />
          <Text style={styles.staleText}>
            Latest path data is unavailable. Pull down to refresh.
          </Text>
        </View>
      ) : null}
      {error ? <Text style={styles.subtitle} accessibilityRole="alert">Path data did not load. Check your connection and pull down to try again.</Text> : null}

      {!error || payload ? <><View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Suggestions</Text>
        {empty ? (
          <EmptyState
            icon="sparkles-outline"
            title="No suggestions yet"
            subtitle="No suggestions are available."
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
            subtitle="No progress submissions are waiting for review."
          />
        )}
      </View></> : null}
    </ScrollView>
  );
}

function SuggestionCard({ suggestion }: { suggestion: CopilotSuggestion }) {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
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
              <Ionicons name="checkmark-circle-outline" size={14} color={sc.accentText} />{' '}
              Approved by your coach
            </Text>
          ) : (
            <Text style={styles.statusText}>
              <Ionicons name="time-outline" size={14} color={sc.textMuted} /> Awaiting
              coach approval
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) => {
  const tokens = { bone: sc.bgPrimary, ink: sc.textPrimary, charcoal: sc.textMuted, cream: sc.bgPrimary, forest: sc.accentText };
  return StyleSheet.create({
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
    ...typography.eyebrow,
    color: tokens.ink,
    marginBottom: spacing.xs,
  },
  list: { gap: spacing.sm },
  card: {
    backgroundColor: tokens.cream,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
    paddingVertical: spacing.lg,
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
};
