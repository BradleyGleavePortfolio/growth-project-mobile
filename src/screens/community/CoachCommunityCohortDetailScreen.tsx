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
 * Empty members + error states render the operator-locked Roman-voiced empty
 * state (neutral crop) — never a bare spinner. Touch targets are >= 44pt.
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
  COACH_EMPTY_COPY,
  MonogramBadge,
  ConfirmModal,
} from '../../components/community/coach';
import {
  useCoachCohortDetail,
  useInviteMember,
  useRemoveMember,
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

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
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
        },
      },
    );
  }, [email, invite]);

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
            intent="warning"
            onPress={() => setPendingRemove(item)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name}`}
            testID={`coach-community-member-remove-${item.user_id}`}
            style={[styles.removeButton, { borderColor: semanticColors.border }]}
          >
            <Text style={[styles.removeLabel, { color: semanticColors.accent }]}>
              Remove
            </Text>
          </HapticPressable>
        ) : null}
      </View>
    ),
    [semanticColors],
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

      {isEmptyMembers || detail.isError ? (
        <CoachEmptyState
          crop={COACH_EMPTY_COPY.cohortMembers.crop}
          copy={COACH_EMPTY_COPY.cohortMembers.copy}
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
  removeButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  removeLabel: {
    fontSize: 14,
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
