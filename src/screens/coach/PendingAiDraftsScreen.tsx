/**
 * PendingAiDraftsScreen — Stream 2 inbox of pending AI drafts.
 *
 * Lists every `AiActionDraft` row in `status='pending'` for the current
 * coach. The gateway returns rows across ALL capabilities; we filter
 * with `isStream2Capability` so pre-Stream-2 rows (draft.coach_message)
 * still surface in their own surface and don't show up unhandled here.
 *
 * Each card renders a capability-specific preview, Approve, and Reject.
 *
 * Doctrine compliance:
 *   - Single forest accent on Approve. Reject is a quiet destructive (ink
 *     text, hairline border — not a red flood).
 *   - No emoji, no exclamation marks, no celebration overlays. "AI draft"
 *     caption badge after approval, not a celebratory pill.
 *
 * Defence-in-depth role guard (R1 audit fix P2-2): renders an inert
 * "Restricted" state if the authenticated user role is not coach/owner.
 * Structural gate (CoachNavigator only mounts for coaches) remains the
 * primary defence; this is the second layer.
 *
 * Polling: focus-gated 30s refetch via `usePendingAiDrafts` +
 * `useIsFocused`.
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
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  usePendingAiDrafts,
  COACH_AI_PENDING_DRAFTS_QUERY_KEY,
} from '../../hooks/usePendingAiDrafts';
import {
  capabilityLabel,
  isStream2Capability,
  previewFor,
  type AiActionDraftRow,
  type CoachAiDraftCapability,
} from '../../api/types/coachAiExecution';
import { coachAiExecutionApi } from '../../api/coachAiExecutionApi';

/** Roles allowed to see + decide AI drafts. Mirrors backend
 *  `@Roles('coach', 'owner')` on the gateway list/decide endpoints. */
const ALLOWED_ROLES = new Set(['coach', 'owner']);

export default function PendingAiDraftsScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const user = useCurrentUser();

  // Defence-in-depth role guard. CoachNavigator is the primary gate; this
  // layer keeps an inert surface even if the screen is reached through a
  // deep link refactor that bypasses the navigator-level role split.
  const allowed = user?.role !== undefined && ALLOWED_ROLES.has(user.role);

  // Polling is also gated on `allowed` so a non-coach session never even
  // hits the gateway list endpoint (which would 403 anyway, but no point
  // burning a roundtrip).
  const query = usePendingAiDrafts({ enabled: allowed && isFocused });

  const approveMutation = useMutation({
    mutationFn: (draftId: string) => coachAiExecutionApi.approveDraft(draftId),
    onSettled: () => {
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

  if (!allowed) {
    return (
      <ErrorBoundary>
        <View style={styles.root} testID="pending-ai-drafts-screen-restricted">
          <View style={styles.emptyState}>
            <Ionicons
              name="lock-closed-outline"
              size={48}
              color={colors.textMuted}
              style={styles.emptyIcon}
            />
            <Text style={styles.emptyTitle}>Restricted</Text>
            <Text style={styles.emptyBody}>
              This view is only available to coach accounts.
            </Text>
          </View>
        </View>
      </ErrorBoundary>
    );
  }

  const allRows = query.data?.drafts ?? [];
  // Render only Stream 2 capabilities. Older draft.coach_message rows live
  // in their own surface.
  const renderable = allRows.filter((r) => isStream2Capability(r.capability));
  const isMutating = approveMutation.isPending || rejectMutation.isPending;

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
          data={renderable}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DraftCard
              draft={item}
              capability={item.capability as CoachAiDraftCapability}
              styles={styles}
              colors={colors}
              onApprove={onApprove}
              onReject={onReject}
              disabled={isMutating}
            />
          )}
          contentContainerStyle={
            renderable.length === 0 ? styles.emptyContainer : styles.listContainer
          }
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
  draft: AiActionDraftRow;
  capability: CoachAiDraftCapability;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onApprove: (draftId: string) => void;
  onReject: (draftId: string) => void;
  disabled: boolean;
}

function DraftCard({
  draft,
  capability,
  styles,
  colors,
  onApprove,
  onReject,
  disabled,
}: DraftCardProps): React.ReactElement {
  const subjectLabel = draft.subject_user_id
    ? `client ${draft.subject_user_id.slice(0, 8)}`
    : 'client';
  const a11yBase = `${capabilityLabel(capability)} for ${subjectLabel}`;
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={a11yBase}
      testID={`ai-draft-card-${capability}`}
    >
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderIconWrap}>
          <Ionicons
            name={iconForCapability(capability)}
            size={18}
            color={colors.primary}
          />
        </View>
        <View style={styles.cardHeaderTextWrap}>
          <Text style={styles.cardTitle}>{capabilityLabel(capability)}</Text>
          <Text style={styles.cardSubtitle}>For {subjectLabel}</Text>
        </View>
        <View style={styles.aiBadge}>
          <Text style={styles.aiBadgeText}>AI draft</Text>
        </View>
      </View>

      <View style={styles.cardPreviewWrap}>
        <Text style={styles.previewBody} numberOfLines={4}>
          {previewFor(draft)}
        </Text>
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

function iconForCapability(c: CoachAiDraftCapability): keyof typeof Ionicons.glyphMap {
  switch (c) {
    case 'draft.assign_workout':
      return 'barbell-outline';
    case 'draft.assign_meal_plan':
      return 'nutrition-outline';
    case 'draft.send_notification':
      return 'notifications-outline';
  }
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

// Re-export helpers so tests can target them without re-rendering the screen.
export { previewFor };
export type { AiActionDraftRow };

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
