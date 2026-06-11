/**
 * CoachCommunityCohortDetailScreen — a single cohort's header, member list,
 * invite-by-email flow, and remove-member flow (v1-6). Consumes
 * `GET /community/coach/cohorts/:id`, `POST /community/coach/cohorts/:id/members`,
 * and `DELETE /community/coach/cohorts/:id/members/:userId`.
 *
 * Features:
 *   - Cohort header (name + member count).
 *   - Member rows with a monogram avatar fallback and a remove action.
 *   - Invite-by-email modal: a valid-looking email enables the invite button;
 *     the invite reconciles the member list on success.
 *   - Remove-member ALWAYS routes through a confirmation modal (hard gate
 *     §2.3 — no one-tap destructive actions); confirming fires an optimistic
 *     remove with rollback.
 *
 * THREE distinct branches (UX P0.2): a loading spinner; an honest
 * CoachErrorState on failure (never a calm/empty masquerade); and — on a
 * cohort with no members — the operator-locked Roman-voiced empty state whose
 * copy + crop come from the backend voice policy (face + voice contract).
 *
 * Destructive Remove is demoted (UX P1.1): it is NOT a button on every row.
 * Each client row carries an overflow (kebab) affordance that opens a small
 * action sheet whose only entry is "Remove from cohort"; choosing it routes
 * through the existing confirmation modal before any mutation fires. A
 * CompletionToast confirms a successful invite (G11). Touch targets are >= 44pt.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import {
  CoachEmptyState,
  CoachErrorState,
  MonogramBadge,
  ConfirmModal,
} from '../../components/community/coach';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import {
  useCoachCohortDetail,
  useInviteMember,
  useRemoveMember,
  useCoachEmptyStatePayload,
} from '../../hooks/useCoachCommunity';
import type { CoachCohortMember } from '../../api/coachCommunityApi';
import type { CoachCommunityRoute } from './coachCommunityNavTypes';

/** Minimal, intentionally permissive email shape check (server is the gate). */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function CoachCommunityCohortDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route = useRoute<CoachCommunityRoute<'CoachCommunityCohortDetail'>>();
  const cohortId = route.params?.cohortId ?? '';
  const fallbackName = route.params?.cohortName ?? 'Cohort';

  const detail = useCoachCohortDetail(cohortId);
  const invite = useInviteMember(cohortId);
  const remove = useRemoveMember(cohortId);
  const emptyPayload = useCoachEmptyStatePayload(
    'coach_community_cohort_members_empty',
  );
  const completion = useCompletionToast();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  // The member whose overflow sheet is open (pre-confirmation).
  const [menuMember, setMenuMember] = useState<CoachCohortMember | null>(null);
  const [pendingRemove, setPendingRemove] = useState<CoachCohortMember | null>(
    null,
  );

  const data = detail.data;
  const members = data?.members ?? [];
  const cohortName = data?.cohort.name ?? fallbackName;
  const memberCount = data?.cohort.member_count ?? members.length;
  const isEmptyMembers =
    !detail.isLoading && !detail.isError && members.length === 0;

  const canInvite = looksLikeEmail(email) && !invite.isPending;

  const onInvite = useCallback(() => {
    if (!looksLikeEmail(email) || invite.isPending) return;
    invite.mutate(
      { email: email.trim() },
      {
        onSuccess: () => {
          setEmail('');
          setInviteOpen(false);
          completion.show('Invite sent.');
        },
      },
    );
  }, [email, invite, completion]);

  const onConfirmRemove = useCallback(() => {
    if (!pendingRemove) return;
    remove.mutate(pendingRemove.user_id, {
      onSettled: () => setPendingRemove(null),
    });
  }, [pendingRemove, remove]);

  const renderMember = useCallback(
    ({ item }: { item: CoachCohortMember }) => (
      <View
        style={[
          styles.memberRow,
          {
            backgroundColor: semanticColors.bgSurface,
            borderColor: semanticColors.border,
          },
        ]}
        testID={`coach-community-member-row-${item.user_id}`}
      >
        <MonogramBadge
          name={item.name}
          avatarUrl={item.avatar_url}
          size={40}
          testID={`coach-community-member-avatar-${item.user_id}`}
        />
        <View style={styles.memberBody}>
          <Text
            style={[styles.memberName, { color: semanticColors.textPrimary }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text
            style={[styles.memberMeta, { color: semanticColors.textMuted }]}
            numberOfLines={1}
          >
            {item.role}
            {item.email ? ` · ${item.email}` : ''}
          </Text>
        </View>
        {item.role === 'client' ? (
          <HapticPressable
            intent="light"
            onPress={() => setMenuMember(item)}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${item.name}`}
            testID={`coach-community-member-menu-${item.user_id}`}
            style={styles.kebab}
          >
            <Text style={[styles.kebabGlyph, { color: semanticColors.textMuted }]}>
              ⋯
            </Text>
          </HapticPressable>
        ) : null}
      </View>
    ),
    [semanticColors, setMenuMember],
  );

  if (detail.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-cohort-detail-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-cohort-detail-loading"
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      testID="coach-community-cohort-detail-screen"
    >
      <View style={styles.header}>
        <Text style={[styles.headerName, { color: semanticColors.textPrimary }]}>
          {cohortName}
        </Text>
        <Text style={[styles.headerMeta, { color: semanticColors.textMuted }]}>
          {memberCount} members
        </Text>
      </View>

      {detail.isError ? (
        <CoachErrorState
          message="Could not load this cohort. Pull back and open it again."
          onRetry={() => detail.refetch()}
          retrying={detail.isRefetching}
          testID="coach-community-cohort-detail-error"
        />
      ) : isEmptyMembers ? (
        <CoachEmptyState
          payload={emptyPayload}
          testID="coach-community-cohort-detail-empty"
        />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m.user_id}
          renderItem={renderMember}
          contentContainerStyle={styles.listContent}
        />
      )}

      <HapticPressable
        intent="medium"
        onPress={() => setInviteOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Invite a client by email"
        testID="coach-community-cohort-detail-invite"
        style={[styles.fab, { backgroundColor: semanticColors.accent }]}
      >
        <Text style={[styles.fabLabel, { color: semanticColors.textOnAccent }]}>
          Invite client
        </Text>
      </HapticPressable>

      {/* Invite-by-email modal. */}
      <Modal
        visible={inviteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteOpen(false)}
        testID="coach-community-cohort-detail-invite-modal"
      >
        <View
          style={[
            styles.scrim,
            { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: semanticColors.bgSurface,
                borderColor: semanticColors.border,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: semanticColors.textPrimary }]}>
              Invite a client
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoFocus
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="client@example.com"
              placeholderTextColor={semanticColors.textMuted}
              accessibilityLabel="Client email"
              testID="coach-community-cohort-detail-email-input"
              onSubmitEditing={onInvite}
              style={[
                styles.modalInput,
                {
                  backgroundColor: semanticColors.bgPrimary,
                  borderColor: semanticColors.border,
                  color: semanticColors.textPrimary,
                },
              ]}
            />
            <View style={styles.modalActions}>
              <HapticPressable
                intent="light"
                onPress={() => {
                  setEmail('');
                  setInviteOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="coach-community-cohort-detail-invite-cancel"
                style={[styles.modalButton, styles.modalCancel, { borderColor: semanticColors.border }]}
              >
                <Text style={[styles.modalCancelLabel, { color: semanticColors.textPrimary }]}>
                  Cancel
                </Text>
              </HapticPressable>
              <HapticPressable
                intent="success"
                onPress={onInvite}
                disabled={!canInvite}
                accessibilityRole="button"
                accessibilityLabel="Send invite"
                accessibilityState={{ disabled: !canInvite }}
                testID="coach-community-cohort-detail-invite-submit"
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: canInvite
                      ? semanticColors.accent
                      : semanticColors.disabledBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modalSubmitLabel,
                    {
                      color: canInvite
                        ? semanticColors.textOnAccent
                        : semanticColors.textOnDisabled,
                    },
                  ]}
                >
                  Send invite
                </Text>
              </HapticPressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Overflow action sheet (UX P1.1 — Remove lives here, not on the row). */}
      <Modal
        visible={menuMember != null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuMember(null)}
        testID="coach-community-member-menu-sheet"
      >
        <HapticPressable
          intent="light"
          onPress={() => setMenuMember(null)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={[
            styles.sheetScrim,
            { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
          ]}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: semanticColors.bgSurface,
                borderColor: semanticColors.border,
              },
            ]}
          >
            <HapticPressable
              intent="warning"
              onPress={() => {
                setPendingRemove(menuMember);
                setMenuMember(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                menuMember ? `Remove ${menuMember.name} from cohort` : 'Remove'
              }
              testID="coach-community-member-menu-remove"
              style={styles.sheetItem}
            >
              <Text style={[styles.sheetItemLabel, { color: semanticColors.accent }]}>
                Remove from cohort
              </Text>
            </HapticPressable>
          </View>
        </HapticPressable>
      </Modal>

      {/* Remove-member confirmation (hard gate: no one-tap destructive). */}
      <ConfirmModal
        visible={pendingRemove != null}
        title="Remove this client"
        body={
          pendingRemove
            ? `Remove ${pendingRemove.name} from ${cohortName}? They lose access to this cohort.`
            : undefined
        }
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={onConfirmRemove}
        onCancel={() => setPendingRemove(null)}
        testID="coach-community-cohort-detail-remove-confirm"
      />

      <CompletionToast state={completion.toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  headerName: {
    fontSize: 24,
    fontWeight: '600',
  },
  headerMeta: {
    fontSize: 14,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  memberBody: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
  },
  memberMeta: {
    fontSize: 13,
  },
  kebab: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  kebabGlyph: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
  },
  sheetScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  sheet: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  sheetItem: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  sheetItemLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  scrim: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalInput: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalButton: {
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  modalCancel: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalCancelLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalSubmitLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
