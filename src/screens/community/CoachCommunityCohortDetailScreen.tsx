/**
 * CoachCommunityCohortDetailScreen — a single cohort's header, member list,
 * invite-by-email flow, and remove-member flow (v1-6). Consumes
 * `GET /community/cohorts/:id`, `GET`/`POST /community/cohorts/:id/members`,
 * and `DELETE /community/cohorts/:id/members/:userId`.
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
 * K2 Style B (#172-10, as the inbox): bone page, the cohort's name as a serif
 * page title, warm cream member cards with filled serif monograms, 24pt
 * gutters. THREE distinct branches (UX P0.2): skeleton cards while loading;
 * an honest inline error card on failure (never a calm/empty masquerade); and
 * — on a cohort with no members — the operator-locked Roman-voiced empty state
 * whose copy + crop come from the backend voice policy (face + voice
 * contract).
 *
 * Destructive Remove is demoted (UX P1.1): it is NOT a button on every row.
 * Each client row carries an overflow (kebab) affordance that opens a small
 * action sheet whose only entry is "Remove from cohort"; choosing it routes
 * through the existing confirmation modal before any mutation fires. A
 * CompletionToast confirms a successful invite (G11). Touch targets are >= 44pt.
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha, semantic, colors, layout } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import {
  CoachRomanEmptyState,
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
import {
  CoachCommunityApiError,
  type CoachCohortMember,
} from '../../api/coachCommunityApi';
import { describeCommunityFailure } from '../../api/communityErrors';
import type { CoachCommunityRoute } from './coachCommunityNavTypes';

/** An invite or remove that failed: the shared community copy, plus the one roster case it lacks. */
function alertMemberFailure(err: unknown): void {
  const f = describeCommunityFailure(
    err instanceof CoachCommunityApiError ? err.cause : err,
    'moderate',
  );
  Alert.alert(
    f.title,
    f.code === 'community.cohort.user_not_found'
      ? 'No client of yours has that email. Check it and try again.'
      : f.message,
  );
}

/** Up to two initials for a member's filled monogram (as the inbox's rows). */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

/** Minimal, intentionally permissive email shape check (server is the gate). */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function CoachCommunityCohortDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<CoachCommunityRoute<'CoachCommunityCohortDetail'>>();
  const cohortId = route.params?.cohortId ?? '';
  const fallbackName = route.params?.cohortName ?? 'Cohort';

  const detail = useCoachCohortDetail(cohortId);
  const invite = useInviteMember(cohortId);
  const remove = useRemoveMember(cohortId);
  const emptyState = useCoachEmptyStatePayload(
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
        onError: alertMemberFailure,
      },
    );
  }, [email, invite, completion]);

  const onConfirmRemove = useCallback(() => {
    if (!pendingRemove) return;
    remove.mutate(pendingRemove.user_id, {
      onError: alertMemberFailure,
      onSettled: () => setPendingRemove(null),
    });
  }, [pendingRemove, remove]);

  const renderMember = useCallback(
    ({ item }: { item: CoachCohortMember }) => (
      <View
        style={styles.memberRow}
        testID={`coach-community-member-row-${item.user_id}`}
      >
        {/* The roster has no photos (avatar_url is always null): K2 filled
            serif monogram, as the inbox's rows. */}
        <View
          style={styles.monogram}
          testID={`coach-community-member-avatar-${item.user_id}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.monogramText} allowFontScaling={false}>
            {initialsOf(item.name)}
          </Text>
        </View>
        <View style={styles.memberBody}>
          <Text style={styles.memberName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.memberMeta} numberOfLines={2}>
            {item.role}
            {item.email ? ` · ${item.email}` : ''}
          </Text>
        </View>
        {/* Only a saved membership can be removed: a person the space lets in
            by its rule has no row (id null), and the server answers 404. */}
        {item.role === 'client' && item.id != null ? (
          <HapticPressable
            intent="light"
            onPress={() => setMenuMember(item)}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${item.name}`}
            testID={`coach-community-member-menu-${item.user_id}`}
            style={styles.kebab}
          >
            <Text style={styles.kebabGlyph}>⋯</Text>
          </HapticPressable>
        ) : null}
      </View>
    ),
    [setMenuMember],
  );

  if (detail.isLoading) {
    return (
      <View style={styles.page} testID="coach-community-cohort-detail-screen">
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.headerName}>
            {cohortName}
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel="Loading this cohort"
          testID="coach-community-cohort-detail-loading"
          style={styles.skeletonList}
        >
          {[0, 1, 2].map((n) => (
            <View key={n} style={styles.skeletonCard} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page} testID="coach-community-cohort-detail-screen">
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.headerName}>
          {cohortName}
        </Text>
        {data ? (
          <Text style={styles.headerMeta}>{memberCount} members</Text>
        ) : null}
      </View>

      <HapticPressable
        intent="medium"
        onPress={() => setInviteOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Invite a client by email"
        testID="coach-community-cohort-detail-invite"
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonLabel}>Invite client</Text>
      </HapticPressable>

      {detail.isError ? (
        <ScrollView
          testID="coach-community-cohort-detail-error-scroll"
          contentContainerStyle={styles.noticeScroll}
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => detail.refetch()}
              tintColor={colors.forest}
            />
          }
        >
          <View style={styles.noticeCard} testID="coach-community-cohort-detail-error">
            <Text accessibilityRole="alert" style={styles.noticeText}>
              Could not load this cohort. Pull back and open it again.
            </Text>
            <HapticPressable
              intent="light"
              onPress={() => detail.refetch()}
              disabled={detail.isRefetching}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              accessibilityState={{
                disabled: detail.isRefetching,
                busy: detail.isRefetching,
              }}
              testID="coach-community-cohort-detail-error-retry"
              style={styles.noticeButton}
            >
              {detail.isRefetching ? (
                <ActivityIndicator color={colors.forest} />
              ) : (
                <Text style={styles.noticeButtonLabel}>Try again</Text>
              )}
            </HapticPressable>
          </View>
        </ScrollView>
      ) : isEmptyMembers ? (
        // Roman's words say "Pull to retry" when they fail to load: the pull
        // retries them and the roster.
        <ScrollView
          testID="coach-community-cohort-detail-empty-scroll"
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={() => {
                void detail.refetch();
                if (emptyState.status === 'error') emptyState.retry();
              }}
              tintColor={colors.forest}
            />
          }
        >
          <CoachRomanEmptyState
            result={emptyState}
            testID="coach-community-cohort-detail-empty"
          />
        </ScrollView>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m.user_id}
          renderItem={renderMember}
          contentContainerStyle={styles.listContent}
        />
      )}


      {/* Invite-by-email modal. */}
      <Modal
        visible={inviteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteOpen(false)}
        testID="coach-community-cohort-detail-invite-modal"
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.scrim,
            { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
          ]}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Invite a client</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoFocus
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="client@example.com"
              placeholderTextColor={colors.graphite}
              accessibilityLabel="Client email"
              testID="coach-community-cohort-detail-email-input"
              onSubmitEditing={onInvite}
              style={styles.modalInput}
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
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelLabel}>Cancel</Text>
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
                      ? colors.forest
                      : semanticColors.disabledBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modalSubmitLabel,
                    {
                      color: canInvite
                        ? colors.bone
                        : semanticColors.textOnDisabled,
                    },
                  ]}
                >
                  Send invite
                </Text>
              </HapticPressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Overflow action sheet (UX P1.1: Remove lives here, not on the row).
          The sheet sits at the foot of the screen over a full-screen scrim.
          The scrim is a plain Pressable filling the modal: HapticPressable
          wraps its target in an unsized view, so as the root it shrank to the
          sheet's height at the top of the screen. */}
      <Modal
        visible={menuMember != null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuMember(null)}
        testID="coach-community-member-menu-sheet"
      >
        <View
          style={[
            styles.sheetRoot,
            { paddingBottom: layout.gutter + insets.bottom },
          ]}
          testID="coach-community-member-menu-root"
        >
          <Pressable
            onPress={() => setMenuMember(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            testID="coach-community-member-menu-dismiss"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
            ]}
          />
          <View style={styles.sheet}>
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
              <Text style={[styles.sheetItemLabel, { color: semantic.danger.fg }]}>
                Remove from cohort
              </Text>
            </HapticPressable>
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
        variant="destructive"
        busy={remove.isPending}
        onConfirm={onConfirmRemove}
        onCancel={() => setPendingRemove(null)}
        testID="coach-community-cohort-detail-remove-confirm"
      />

      <CompletionToast state={completion.toast} />
    </View>
  );
}

// K2 Style B, as the inbox: bone page (#166-2), cream cards, forest accent,
// ink text, graphite small text (#168-13), 24pt gutters, semantic radii.
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bone },
  header: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: 2,
  },
  headerName: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 36,
    lineHeight: 46,
    color: colors.ink,
  },
  headerMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: colors.graphite,
  },
  listContent: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xs,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: colors.cream,
    minHeight: 64,
  },
  monogram: {
    width: 44,
    height: 44,
    borderRadius: radius.chip,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 23,
    color: colors.bone,
  },
  memberBody: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 21,
    color: colors.ink,
  },
  memberMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: colors.graphite,
  },
  kebab: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.button,
  },
  kebabGlyph: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
    color: colors.ink,
  },
  skeletonList: { paddingHorizontal: layout.gutter, gap: spacing.sm },
  skeletonCard: {
    height: 72,
    borderRadius: radius.card,
    backgroundColor: colors.cream,
  },
  noticeScroll: { paddingHorizontal: layout.gutter, paddingTop: spacing.xs },
  emptyScroll: { flexGrow: 1 },
  noticeCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  // The inbox's inline card (GOAL B error frame): ink line, outlined forest
  // Try again across the card, so the page keeps one filled button.
  noticeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  noticeButton: {
    minHeight: 48,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  noticeButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: colors.forest,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: layout.gutter,
    paddingTop: layout.gutter,
  },
  sheet: {
    borderRadius: radius.sheet,
    backgroundColor: colors.bone,
    overflow: 'hidden',
  },
  sheetItem: {
    minHeight: 56,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
  },
  sheetItemLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  // K2 has no floating buttons: the main action sits in the page flow.
  primaryButton: {
    marginHorizontal: layout.gutter,
    marginBottom: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.button,
    backgroundColor: colors.forest,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 21,
    color: colors.bone,
  },
  scrim: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: layout.gutter,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl,
    borderRadius: radius.sheet,
    backgroundColor: colors.bone,
    gap: spacing.md,
  },
  modalTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 26,
    lineHeight: 33,
    color: colors.ink,
  },
  modalInput: {
    minHeight: 48,
    borderRadius: radius.button,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: colors.ink,
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
    borderRadius: radius.button,
  },
  modalCancel: {
    borderWidth: 1.5,
    borderColor: colors.forest,
  },
  modalCancelLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.forest,
  },
  modalSubmitLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});
