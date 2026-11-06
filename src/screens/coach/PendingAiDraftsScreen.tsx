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
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';
import { coachInboxB as B, typography, radius, spacing } from '../../theme/tokens';
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
import { QuietError, QuietLoading, loadFailureMessage } from '../../ui/states/QuietStates';
import { PATH_DRAFTS_KEY, PathChangeDrafts, usePathChangeDrafts } from './copilot/PathChangeDrafts';
import { useScreenInsets } from '../../ui/layout/Screen';
import { draftKinds } from './inboxStyleB';

/** Roles allowed to see + decide AI drafts. Mirrors backend
 *  `@Roles('coach', 'owner')` on the gateway list/decide endpoints. */
const ALLOWED_ROLES = new Set(['coach', 'owner']);

export default function PendingAiDraftsScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(), []);
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  // The stack draws no header here: the title clears the status bar itself.
  const insets = useScreenInsets();

  // Defence-in-depth role guard. CoachNavigator is the primary gate; this
  // layer keeps an inert surface even if the screen is reached through a
  // deep link refactor that bypasses the navigator-level role split.
  const allowed = user?.role !== undefined && ALLOWED_ROLES.has(user.role);

  // Polling is also gated on `allowed` so a non-coach session never even
  // hits the gateway list endpoint (which would 403 anyway, but no point
  // burning a roundtrip).
  const query = usePendingAiDrafts({ enabled: allowed && isFocused });
  // COPILOT-M1: the client_path_change rows (flag off: never fetched). "No pending drafts" only once both reads say so.
  const path = usePathChangeDrafts(allowed && isFocused);
  const hasPath = (path.data?.length ?? 0) > 0;
  const pathFailed = path.isError && !path.data;

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
  const kinds = draftKinds(allRows);
  // LO-952 C1: the headline counts every card the list shows, the plan changes too; the tiles stay the drafts' kinds.
  const ready = kinds.total + (path.data?.length ?? 0);
  const bare = renderable.length === 0 && !query.isLoading && !path.isLoading && !hasPath && !pathFailed;
  // LS-952 B1, LO-952 B1: the header and kind tiles scroll with the cards (a 320 pt screen at 130% text keeps room for
  // them). The screen keeps insets.top so a scrolled card stops below the clock; the header adds 8 as before.
  const header = (
    <View style={[styles.header, bare && styles.headerSides]}>
      {navigation.canGoBack() ? (
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={B.ink} />
        </Pressable>
      ) : null}
      <Text style={ready > 0 ? styles.eyebrow : styles.headerTitle}>Pending AI drafts</Text>
      {ready > 0 ? (
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{`Roman has ${ready} ${ready === 1 ? 'draft' : 'drafts'} ready`}</Text>
      ) : null}
      <Text style={styles.headerSubtitle}>
        Review what the AI proposed before it reaches your clients.
      </Text>
      {kinds.kinds.length > 0 ? (
        <View style={styles.kindRow} testID="pending-ai-drafts-kinds">
          {kinds.kinds.map((k) => (
            <View key={k.label} style={styles.kindTile} accessible accessibilityLabel={`${k.count} ${k.label}`}>
              <Text style={styles.kindCount} maxFontSizeMultiplier={1.3}>{k.count}</Text>
              <Text style={styles.kindLabel}>{k.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <ErrorBoundary>
      <View style={[styles.root, { paddingTop: insets.top }]} testID="pending-ai-drafts-screen">
        <FlatList
          data={renderable}
          // The Copilot editors' number pad has no Done key: lift content over it, first tap lands, drag dismisses.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DraftCard
              draft={item}
              capability={item.capability as CoachAiDraftCapability}
              styles={styles}
              onApprove={onApprove}
              onReject={onReject}
              disabled={isMutating}
            />
          )}
          contentContainerStyle={bare ? styles.emptyContainer : styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={query.isFetching}
              onRefresh={() => {
                void query.refetch();
                void queryClient.invalidateQueries({ queryKey: PATH_DRAFTS_KEY });
              }}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={<>{header}<PathChangeDrafts query={path} showError={!query.isError} /></>}
          ListEmptyComponent={<View style={styles.emptyFill}>{
            // QA-COACH-STATES-131: the shared skeleton and the calm error.
            query.isError ? (
              <QuietError
                message={loadFailureMessage(query.error, 'Pending AI drafts')}
                onRetry={() => void Promise.all([query.refetch(), pathFailed && path.refetch()])}
                retrying={query.isFetching}
                testID="pending-ai-drafts-error"
              />
            ) : query.isLoading || path.isLoading ? (
              <QuietLoading label="Loading pending drafts" testID="pending-ai-drafts-loading" />
            ) : hasPath || pathFailed ? null : (
              <EmptyState
                styles={styles}
                colors={colors}
                title="No pending drafts"
                body="Ask the AI to draft something from a client's detail screen."
              />
            )
          }</View>}
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
  onApprove: (draftId: string) => void;
  onReject: (draftId: string) => void;
  disabled: boolean;
}

function DraftCard({
  draft,
  capability,
  styles,
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
            color={B.onDeep}
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

function makeStyles() {
  return StyleSheet.create({
    // K2 Style B (owner #196-D10): the drawn tiles and cards on the app page (owner #197-E6), colours from coachInboxB.
    root: { flex: 1, backgroundColor: B.page },
    header: { paddingTop: 8, paddingBottom: 16, gap: 6 },
    headerSides: { paddingHorizontal: 24 },
    back: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
    eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 1.6, textTransform: 'uppercase', color: B.muted },
    headerTitle: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 34, lineHeight: 43, fontWeight: '400', fontVariant: ['lining-nums'], color: B.ink },
    headerSubtitle: { ...typography.body, color: B.muted },
    kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
    kindTile: { flexGrow: 1, flexShrink: 0, backgroundColor: B.tile, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 14, gap: 2 },
    kindCount: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 38, lineHeight: 48, fontVariant: ['lining-nums'], color: B.deep },
    kindLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20, fontWeight: '600', color: B.body },

    listContainer: { paddingHorizontal: 24, paddingBottom: 32 },
    emptyContainer: { flexGrow: 1 },
    // The empty and error states stay in the middle of the room under the header.
    emptyFill: { flexGrow: 1, justifyContent: 'center' },

    card: { backgroundColor: B.tile, borderRadius: radius.card, padding: spacing.md, marginBottom: 12 },
    cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardHeaderIconWrap: { width: 36, height: 36, borderRadius: radius.chip, backgroundColor: B.deep, alignItems: 'center', justifyContent: 'center' },
    cardHeaderTextWrap: { flex: 1 },
    cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 22, fontWeight: '600', color: B.ink },
    cardSubtitle: { ...typography.bodySmall, color: B.muted, marginTop: 2 },
    aiBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: B.chip },
    aiBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18, fontWeight: '600', color: B.deep },

    cardPreviewWrap: { marginTop: 10 },
    previewBody: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, color: B.body },

    cardActionRow: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm, marginTop: 14 },
    btn: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
    btnReject: { borderWidth: 1, borderColor: B.line, backgroundColor: B.chip },
    btnRejectText: { ...typography.bodyMd, color: B.ink },
    btnApprove: { backgroundColor: B.deep },
    btnApproveText: { ...typography.bodyMd, color: B.onDeep },
    btnDisabled: { opacity: 0.5 },

    emptyState: { alignItems: 'center', paddingHorizontal: 32 },
    emptyIcon: { marginBottom: 12 },
    emptyTitle: { ...typography.h3, color: B.ink, textAlign: 'center' },
    emptyBody: { ...typography.body, color: B.body, textAlign: 'center', marginTop: 8 },
  });
}
