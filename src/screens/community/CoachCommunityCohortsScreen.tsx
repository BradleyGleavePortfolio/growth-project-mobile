/**
 * CoachCommunityCohortsScreen — the coach's cohort list (v1-6). Consumes
 * `GET /community/coach/cohorts` and `POST /community/coach/cohorts`.
 *
 * Features:
 *   - Pull-to-refresh on the list.
 *   - A floating action button (FAB) opens a create-cohort modal; submitting a
 *     non-empty name fires an optimistic create (provisional row at the top of
 *     the list) that reconciles with the server row on success.
 *   - Tapping a row routes into CoachCommunityCohortDetail.
 *
 * THREE distinct branches (UX P0.2): a loading spinner; an honest
 * CoachErrorState on failure (never a calm/empty masquerade); and — on a
 * genuinely empty cohort list — the operator-locked Roman-voiced empty state
 * whose copy + crop come from the backend voice policy (face + voice
 * contract). A CompletionToast confirms a successful create (G11). Touch
 * targets are >= 44pt.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { CoachEmptyState, CoachErrorState } from '../../components/community/coach';
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

export default function CoachCommunityCohortsScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CoachCommunityNav>();
  const cohorts = useCoachCohorts();
  const createCohort = useCreateCohort();
  const emptyPayload = useCoachEmptyStatePayload('coach_community_cohorts_empty');
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
        accessibilityLabel={`${item.name}, ${item.member_count} members`}
        testID={`coach-community-cohort-row-${item.id}`}
        style={[
          styles.row,
          {
            backgroundColor: semanticColors.bgSurface,
            borderColor: semanticColors.border,
          },
        ]}
      >
        <View style={styles.rowBody}>
          <Text
            style={[styles.rowName, { color: semanticColors.textPrimary }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text style={[styles.rowMeta, { color: semanticColors.textMuted }]}>
            {item.member_count} members
            {item.unread_count > 0 ? ` · ${item.unread_count} unread` : ''}
          </Text>
        </View>
      </HapticPressable>
    ),
    [navigation, semanticColors],
  );

  if (cohorts.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-cohorts-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-cohorts-loading"
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      testID="coach-community-cohorts-screen"
    >
      {cohorts.isError ? (
        <CoachErrorState
          message="Could not load your cohorts. Pull to retry."
          onRetry={() => cohorts.refetch()}
          retrying={cohorts.isRefetching}
          testID="coach-community-cohorts-error"
        />
      ) : isEmpty ? (
        <CoachEmptyState
          payload={emptyPayload}
          testID="coach-community-cohorts-empty"
        />
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
              tintColor={semanticColors.accent}
            />
          }
        />
      )}

      <HapticPressable
        intent="medium"
        onPress={() => setModalOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Create a new cohort"
        testID="coach-community-cohorts-fab"
        style={[styles.fab, { backgroundColor: semanticColors.accent }]}
      >
        <Text style={[styles.fabLabel, { color: semanticColors.textOnAccent }]}>
          New cohort
        </Text>
      </HapticPressable>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
        testID="coach-community-cohorts-modal"
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
              Name your cohort
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              placeholder="Spring strength block"
              placeholderTextColor={semanticColors.textMuted}
              accessibilityLabel="Cohort name"
              testID="coach-community-cohorts-name-input"
              onSubmitEditing={onSubmit}
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
                  setName('');
                  setModalOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="coach-community-cohorts-modal-cancel"
                style={[styles.modalButton, styles.modalCancel, { borderColor: semanticColors.border }]}
              >
                <Text style={[styles.modalCancelLabel, { color: semanticColors.textPrimary }]}>
                  Cancel
                </Text>
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
                      ? semanticColors.accent
                      : semanticColors.disabledBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modalSubmitLabel,
                    {
                      color: canSubmit
                        ? semanticColors.textOnAccent
                        : semanticColors.textOnDisabled,
                    },
                  ]}
                >
                  Create
                </Text>
              </HapticPressable>
            </View>
          </View>
        </View>
      </Modal>

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
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 13,
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
