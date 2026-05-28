/**
 * PendingAiDraftsScreen — Stream 2 inbox of pending AI drafts.
 *
 * Lists every `AiActionDraft` row in `status='pending'` for the current
 * coach across all four Stream 2 capabilities (and the existing
 * `draft.coach_message` from PR #293 — the inbox is capability-aware
 * and ignores anything it doesn't have a card for). Each card renders
 * a capability-specific preview, an Approve, and a Reject button.
 *
 * Doctrine compliance (post-Stream-1 round 3/4):
 *   - Single forest accent on the Approve button. Reject is a quiet
 *     destructive (ink text, hairline border — NOT a red flood).
 *   - No emoji, no exclamation marks, no celebration overlays. The
 *     "Sent by AI" badge after approval is a small caption ("AI draft"),
 *     not a celebratory pill (doctrine §3 / §5).
 *   - Typography pulled from `theme/tokens` — display weights ≤500.
 *
 * Polling: focus-gated 30s refetch (`usePendingAiDrafts` + `useIsFocused`).
 * When the screen blurs, the React Query interval suspends; on focus, the
 * cached list renders immediately and a fresh fetch lands within ~1s.
 */

import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';
import { typography, radius, spacing } from '../../theme/tokens';
import ErrorBoundary from '../../components/ErrorBoundary';
import {
  usePendingAiDrafts,
  COACH_AI_PENDING_DRAFTS_QUERY_KEY,
} from '../../hooks/usePendingAiDrafts';
import {
  capabilityLabel,
  previewFor,
  type CoachAiDraft,
} from '../../api/types/coachAiExecution';
import { coachAiExecutionApi } from '../../api/coachAiExecutionApi';

/** Inbox screen registered in CoachNavigator under ClientsStack as
 *  `PendingAiDrafts`. Reached from the ClientDetail Summary tab via
 *  the `<AskAiCta>` row, OR from the Coach Home dashboard via a
 *  future "AI drafts (N)" pill (out of scope for this PR). */
export default function PendingAiDraftsScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();

  // P0-equivalent from Stream 1 round 1 (the unread-polling bug):
  // focus-gated polling means the inbox does not poll when the coach
  // is on a different screen. The hook reads `enabled` each render so
  // the focus toggle flows through without a stale-closure trap.
  const query = usePendingAiDrafts({ enabled: isFocused });

  const approveMutation = useMutation({
    mutationFn: (draftId: string) => coachAiExecutionApi.approveDraft(draftId),
    onSettled: () => {
      // Both branches (success + error) re-fetch — on success the row
      // disappears from the pending list; on error the row stays
      // pending and the coach can retry.
      queryClient.invalidateQueries({ queryKey: COACH_AI_PENDING_DRAFTS_QUERY_KEY });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (draftId: string) => coachAiExecutionApi.rejectDraft(draftId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: COACH_AI_PENDING_DRAFTS_QUERY_KEY });
    },
  });

  const onApprove = useCallback(
    (draftId: string) => approveMutation.mutate(draftId),
    [approveMutation],
  );
  const onReject = useCallback(
    (draftId: string) => rejectMutation.mutate(draftId),
    [rejectMutation],
  );

  const drafts = query.data?.drafts ?? [];
  const isMutating =
    approveMutation.isPending || rejectMutation.isPending;

  return (
    <ErrorBoundary>
      <View style={styles.root} testID="pending-ai-drafts-screen">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Pending AI drafts</Text>
          <Text style={styles.headerSubtitle}>
            Review what the AI proposed before it reaches your clients.
          </Text>
        </View>

        <FlatList
          data={drafts}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DraftCard
              draft={item}
              styles={styles}
              colors={colors}
              onApprove={onApprove}
              onReject={onReject}
              disabled={isMutating}
            />
          )}
          contentContainerStyle={drafts.length === 0 ? styles.emptyContainer : styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={query.isFetching}
              onRefresh={() => query.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            query.isLoading ? (
              <EmptyState
                styles={styles}
                colors={colors}
                title="Loading pending drafts…"
                body=""
              />
            ) : query.isError ? (
              <EmptyState
                styles={styles}
                colors={colors}
                title="Could not load drafts"
                body="Pull down to retry."
              />
            ) : (
              <EmptyState
                styles={styles}
                colors={colors}
                title="No pending drafts"
                body="Ask the AI to draft something from a client's detail screen."
              />
            )
          }
          testID="pending-ai-drafts-list"
        />
      </View>
    </ErrorBoundary>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────

interface DraftCardProps {
  draft: CoachAiDraft;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onApprove: (draftId: string) => void;
  onReject: (draftId: string) => void;
  disabled: boolean;
}

/**
 * Per-capability card. The switch on `draft.capability` picks the
 * preview body; the surrounding chrome (badge, header, action row)
 * is shared so the inbox stays visually coherent even as new
 * capabilities are added.
 */
function DraftCard({
  draft,
  styles,
  colors,
  onApprove,
  onReject,
  disabled,
}: DraftCardProps): React.ReactElement {
  const a11yBase = `${capabilityLabel(draft.capability)} for ${draft.subjectClientName}`;
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={a11yBase}
      testID={`ai-draft-card-${draft.capability}`}
    >
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderIconWrap}>
          <Ionicons
            name={iconForCapability(draft.capability)}
            size={18}
            color={colors.primary}
          />
        </View>
        <View style={styles.cardHeaderTextWrap}>
          <Text style={styles.cardTitle}>{capabilityLabel(draft.capability)}</Text>
          <Text style={styles.cardSubtitle}>
            For {draft.subjectClientName}
          </Text>
        </View>
        <View style={styles.aiBadge}>
          <Text style={styles.aiBadgeText}>AI draft</Text>
        </View>
      </View>

      {/* Capability-specific preview body. Each variant pulls from the
          discriminated CoachAiDraft union so TS narrows the payload
          shape correctly. */}
      <View style={styles.cardPreviewWrap}>
        <CardPreview draft={draft} styles={styles} />
      </View>

      <View style={styles.cardActionRow}>
        <Pressable
          style={[styles.btn, styles.btnReject]}
          onPress={() => onReject(draft.id)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Reject ${a11yBase}`}
          testID={`ai-draft-reject-${draft.id}`}
        >
          <Text style={styles.btnRejectText}>Reject</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnApprove, disabled && styles.btnDisabled]}
          onPress={() => onApprove(draft.id)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Approve ${a11yBase}`}
          testID={`ai-draft-approve-${draft.id}`}
        >
          <Text style={styles.btnApproveText}>Approve</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface CardPreviewProps {
  draft: CoachAiDraft;
  styles: ReturnType<typeof makeStyles>;
}

function CardPreview({ draft, styles }: CardPreviewProps): React.ReactElement {
  switch (draft.capability) {
    case 'draft.client_message':
      return (
        <View>
          <Text style={styles.previewBody} numberOfLines={4}>
            {draft.payload.body}
          </Text>
        </View>
      );
    case 'draft.assign_workout':
      return (
        <View>
          <Text style={styles.previewHeadline}>{draft.payload.workoutName}</Text>
          <Text style={styles.previewMeta}>
            {draft.payload.weekCount} weeks · day 1 has{' '}
            {draft.payload.day1ExerciseCount} exercises
          </Text>
          {draft.payload.rationale && (
            <Text style={styles.previewRationale} numberOfLines={2}>
              {draft.payload.rationale}
            </Text>
          )}
        </View>
      );
    case 'draft.assign_meal_plan':
      return (
        <View>
          <Text style={styles.previewHeadline}>{draft.payload.planName}</Text>
          <Text style={styles.previewMeta}>
            {draft.payload.dayCount} days · {draft.payload.macroSummary}
          </Text>
          {draft.payload.rationale && (
            <Text style={styles.previewRationale} numberOfLines={2}>
              {draft.payload.rationale}
            </Text>
          )}
        </View>
      );
    case 'draft.send_notification':
      return (
        <View>
          <Text style={styles.previewHeadline}>{draft.payload.title}</Text>
          <Text style={styles.previewBody} numberOfLines={3}>
            {draft.payload.body}
          </Text>
          {draft.payload.scheduledFor && (
            <Text style={styles.previewMeta}>
              Scheduled for {formatScheduledFor(draft.payload.scheduledFor)}
            </Text>
          )}
        </View>
      );
  }
}

function iconForCapability(c: CoachAiDraft['capability']): keyof typeof Ionicons.glyphMap {
  switch (c) {
    case 'draft.client_message':
      return 'chatbubble-outline';
    case 'draft.assign_workout':
      return 'barbell-outline';
    case 'draft.assign_meal_plan':
      return 'nutrition-outline';
    case 'draft.send_notification':
      return 'notifications-outline';
  }
}

function formatScheduledFor(iso: string): string {
  // Intl is available in jest-expo + RN. We use the device locale so the
  // coach sees their own time format.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Empty state ──────────────────────────────────────────────────────────

interface EmptyStateProps {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  title: string;
  body: string;
}

function EmptyState({ styles, colors, title, body }: EmptyStateProps): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <Ionicons
        name="document-text-outline"
        size={48}
        color={colors.textMuted}
        style={styles.emptyIcon}
      />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body !== '' && <Text style={styles.emptyBody}>{body}</Text>}
    </View>
  );
}

// Export the helpers for tests so the renderer-internal logic stays
// covered without re-rendering the whole screen.
export { previewFor };
export type { CoachAiDraft };

// ─── styles ───────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
      backgroundColor: colors.background,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    headerSubtitle: {
      ...typography.body,
      color: colors.textSecondary,
      marginTop: 4,
    },

    listContainer: { paddingHorizontal: 16, paddingBottom: 32 },
    emptyContainer: { flexGrow: 1, justifyContent: 'center' },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    cardHeaderIconWrap: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardHeaderTextWrap: { flex: 1 },
    cardTitle: { ...typography.bodyMd, color: colors.textPrimary },
    cardSubtitle: {
      ...typography.bodySmall,
      color: colors.textMuted,
      marginTop: 2,
    },
    /**
     * Quiet "AI draft" badge. Doctrine §3 §5: no celebratory pill, no
     * gradient, no glow. A hairline border + caption typography reads
     * as a sober label, not a marketing tag.
     */
    aiBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    aiBadgeText: {
      ...typography.caption,
      color: colors.textMuted,
    },

    cardPreviewWrap: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    previewBody: {
      ...typography.body,
      color: colors.textPrimary,
    },
    previewHeadline: {
      ...typography.bodyMd,
      color: colors.textPrimary,
    },
    previewMeta: {
      ...typography.bodySmall,
      color: colors.textMuted,
      marginTop: 4,
    },
    previewRationale: {
      ...typography.bodySmall,
      color: colors.textSecondary,
      marginTop: 6,
      fontStyle: 'italic',
    },

    cardActionRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginTop: 16,
    },
    btn: {
      paddingVertical: 10,
      paddingHorizontal: 18,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 96,
    },
    btnReject: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    btnRejectText: {
      ...typography.bodyMd,
      color: colors.textPrimary,
    },
    btnApprove: { backgroundColor: colors.primary },
    btnApproveText: {
      ...typography.bodyMd,
      color: colors.textOnPrimary,
    },
    btnDisabled: { opacity: 0.5 },

    emptyState: {
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    emptyIcon: { marginBottom: 12 },
    emptyTitle: {
      ...typography.h3,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    emptyBody: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 8,
    },
  });
}
