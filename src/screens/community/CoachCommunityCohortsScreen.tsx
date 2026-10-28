/**
 * CoachCommunityCohortsScreen — the coach's cohort list (v1-6). Consumes
 * `GET /community/cohorts` and `POST /community/workspaces/:id/cohorts`.
 *
 * Features:
 *   - Pull-to-refresh on the list.
 *   - An in-flow "New cohort" button (K2) opens a create-cohort modal; submitting a
 *     non-empty name fires an optimistic create (provisional row at the top of
 *     the list) that reconciles with the server row on success.
 *   - Tapping a row routes into CoachCommunityCohortDetail.
 *
 * K2 Style B (#172-10, as the inbox). THREE distinct branches (UX P0.2): skeleton cards; an honest
 * inline error card on failure (never a calm/empty masquerade); and — on a
 * genuinely empty cohort list — the operator-locked Roman-voiced empty state
 * whose copy + crop come from the backend voice policy (face + voice
 * contract). A CompletionToast confirms a successful create (G11). Touch
 * targets are >= 44pt.
 */
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha, colors, layout } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { CoachRomanEmptyState } from '../../components/community/coach';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import {
  useCoachCohorts,
  useCreateCohort,
  useCoachEmptyStatePayload,
} from '../../hooks/useCoachCommunity';
import type { CoachCohort } from '../../api/coachCommunityApi';
import type { CoachCommunityNav } from './coachCommunityNavTypes';
import {
  alertCoachFailure,
  InboxNoticeCard,
  initialsOf,
  k2Styles,
  membersLabel,
} from './CoachCommunityInboxScreen';

/** The serif page title (K2): the navigation bar above it stays empty. */
function CohortsTitle(): React.ReactElement {
  return (
    <View style={k2Styles.titleBlock}>
      <Text accessibilityRole="header" style={k2Styles.title}>
        Cohorts
      </Text>
    </View>
  );
}

export default function CoachCommunityCohortsScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CoachCommunityNav>();
  const cohorts = useCoachCohorts();
  const createCohort = useCreateCohort();
  const emptyState = useCoachEmptyStatePayload('coach_community_cohorts_empty');
  const completion = useCompletionToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');

  const data = cohorts.data ?? [];
  const isEmpty = !cohorts.isLoading && !cohorts.isError && data.length === 0;
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !createCohort.isPending;

  const onSubmit = useCallback(() => {
    if (trimmed.length === 0 || createCohort.isPending) return;
    createCohort.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName('');
          setModalOpen(false);
          completion.show('Cohort created.');
        },
        onError: alertCoachFailure,
      },
    );
  }, [trimmed, createCohort, completion]);

  const renderItem = useCallback(
    ({ item }: { item: CoachCohort }) => (
      <HapticPressable
        intent="light"
        onPress={() =>
          navigation.navigate('CoachCommunityCohortDetail', {
            cohortId: item.id,
            cohortName: item.name,
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${membersLabel(item.member_count)}${
          item.unread_count > 0 ? `, ${item.unread_count} unread` : ''
        }`}
        testID={`coach-community-cohort-row-${item.id}`}
        style={styles.row}
      >
        <View
          style={k2Styles.monogram}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={k2Styles.monogramText} allowFontScaling={false}>
            {initialsOf(item.name)}
          </Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.rowMeta}>
            {membersLabel(item.member_count)}
            {item.unread_count > 0 ? ` · ${item.unread_count} unread` : ''}
          </Text>
        </View>
      </HapticPressable>
    ),
    [navigation],
  );

  if (cohorts.isLoading) {
    return (
      <View style={k2Styles.page} testID="coach-community-cohorts-screen">
        <CohortsTitle />
        <View
          accessible
          accessibilityLabel="Loading your cohorts"
          testID="coach-community-cohorts-loading"
          style={k2Styles.skeletonList}
        >
          {[0, 1, 2].map((n) => (
            <View key={n} style={styles.skeletonCard} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={k2Styles.page} testID="coach-community-cohorts-screen">
      <CohortsTitle />
      <HapticPressable
        intent="medium"
        onPress={() => setModalOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Create a new cohort"
        testID="coach-community-cohorts-fab"
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonLabel}>New cohort</Text>
      </HapticPressable>

      {cohorts.isError ? (
        <ScrollView
          testID="coach-community-cohorts-error-scroll"
          contentContainerStyle={styles.noticeScroll}
          refreshControl={
            <RefreshControl
              refreshing={cohorts.isRefetching}
              onRefresh={() => cohorts.refetch()}
              tintColor={colors.forest}
            />
          }
        >
          <InboxNoticeCard
            message="Could not load your cohorts. Pull to retry."
            onRetry={() => cohorts.refetch()}
            retrying={cohorts.isRefetching}
            testID="coach-community-cohorts-error"
            flush
          />
        </ScrollView>
      ) : isEmpty ? (
        // Roman's words say "Pull to retry" when they fail: the pull retries them.
        <ScrollView
          testID="coach-community-cohorts-empty-scroll"
          contentContainerStyle={k2Styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={cohorts.isRefetching}
              onRefresh={() => {
                void cohorts.refetch();
                if (emptyState.status === 'error') emptyState.retry();
              }}
              tintColor={colors.forest}
            />
          }
        >
          <CoachRomanEmptyState
            result={emptyState}
            testID="coach-community-cohorts-empty"
          />
        </ScrollView>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={cohorts.isRefetching}
              onRefresh={() => cohorts.refetch()}
              tintColor={colors.forest}
            />
          }
        />
      )}

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
        testID="coach-community-cohorts-modal"
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.scrim,
            { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
          ]}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name your cohort</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              placeholder="Spring strength block"
              placeholderTextColor={colors.graphite}
              accessibilityLabel="Cohort name"
              testID="coach-community-cohorts-name-input"
              onSubmitEditing={onSubmit}
              style={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <HapticPressable
                intent="light"
                onPress={() => {
                  setName('');
                  setModalOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="coach-community-cohorts-modal-cancel"
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelLabel}>Cancel</Text>
              </HapticPressable>
              <HapticPressable
                intent="success"
                onPress={onSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel="Create cohort"
                accessibilityState={{ disabled: !canSubmit }}
                testID="coach-community-cohorts-modal-submit"
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: canSubmit
                      ? colors.forest
                      : semanticColors.disabledBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modalSubmitLabel,
                    {
                      color: canSubmit
                        ? colors.bone
                        : semanticColors.textOnDisabled,
                    },
                  ]}
                >
                  Create
                </Text>
              </HapticPressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CompletionToast state={completion.toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xs,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.cream,
    minHeight: 64,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 21,
    color: colors.ink,
  },
  rowMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: colors.graphite,
  },
  skeletonCard: {
    height: 76,
    borderRadius: radius.card,
    backgroundColor: colors.cream,
  },
  noticeScroll: { paddingHorizontal: layout.gutter, paddingTop: spacing.xs },
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
