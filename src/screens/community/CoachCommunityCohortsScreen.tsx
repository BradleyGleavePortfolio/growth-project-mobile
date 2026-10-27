/**
 * CoachCommunityCohortsScreen — the coach's cohort list (v1-6). Consumes
 * `GET /community/cohorts` and `POST /community/workspaces/:id/cohorts`.
 *
 * Features:
 *   - Pull-to-refresh on the list.
 *   - An in-flow "New cohort" button (K2: no floating buttons) opens a
 *     create-cohort modal; submitting a
 *     non-empty name fires an optimistic create (provisional row at the top of
 *     the list) that reconciles with the server row on success.
 *   - Tapping a row routes into CoachCommunityCohortDetail.
 *
 * K2 Style B (#172-10, the area's newest GOAL, as the inbox): bone page, a
 * serif page title, warm cream row cards with filled serif monograms, 24pt
 * gutters. THREE distinct branches (UX P0.2): skeleton cards while loading; an
 * honest inline error card on failure (never a calm/empty masquerade; the
 * card can be pulled, so "Pull to retry" is true, and has a Try again button);
 * and — on a genuinely empty cohort list — the operator-locked Roman-voiced
 * empty state whose copy + crop come from the backend voice policy (face +
 * voice contract). A CompletionToast confirms a successful create (G11).
 * Touch targets are >= 44pt.
 */
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
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

/** Up to two initials for a cohort's filled monogram (as the inbox's rows). */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

/** The serif page title (K2): the navigation bar above it stays empty. */
function CohortsTitle(): React.ReactElement {
  return (
    <View style={styles.titleBlock}>
      <Text accessibilityRole="header" style={styles.title}>
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
        style={styles.row}
      >
        <View
          style={styles.monogram}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.monogramText} allowFontScaling={false}>
            {initialsOf(item.name)}
          </Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.rowMeta}>
            {item.member_count} members
            {item.unread_count > 0 ? ` · ${item.unread_count} unread` : ''}
          </Text>
        </View>
      </HapticPressable>
    ),
    [navigation],
  );

  if (cohorts.isLoading) {
    return (
      <View style={styles.page} testID="coach-community-cohorts-screen">
        <CohortsTitle />
        <View
          accessible
          accessibilityLabel="Loading your cohorts"
          testID="coach-community-cohorts-loading"
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
    <View style={styles.page} testID="coach-community-cohorts-screen">
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
          contentContainerStyle={styles.noticeScroll}
          refreshControl={
            <RefreshControl
              refreshing={cohorts.isRefetching}
              onRefresh={() => cohorts.refetch()}
              tintColor={colors.forest}
            />
          }
        >
          <View style={styles.noticeCard} testID="coach-community-cohorts-error">
            <Text style={styles.noticeText}>
              Could not load your cohorts. Pull to retry.
            </Text>
            <HapticPressable
              intent="light"
              onPress={() => cohorts.refetch()}
              disabled={cohorts.isRefetching}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              accessibilityState={{
                disabled: cohorts.isRefetching,
                busy: cohorts.isRefetching,
              }}
              testID="coach-community-cohorts-error-retry"
              style={styles.noticeButton}
            >
              {cohorts.isRefetching ? (
                <ActivityIndicator color={colors.bone} />
              ) : (
                <Text style={styles.noticeButtonLabel}>Try again</Text>
              )}
            </HapticPressable>
          </View>
        </ScrollView>
      ) : isEmpty ? (
        <CoachRomanEmptyState
          result={emptyState}
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

// K2 Style B, as the inbox: bone page (#166-2), cream cards, forest accent,
// ink text, graphite small text (#168-13), 24pt gutters, semantic radii.
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bone },
  titleBlock: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 34,
    lineHeight: 43,
    color: colors.ink,
  },
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
  skeletonList: { paddingHorizontal: layout.gutter, gap: spacing.sm },
  skeletonCard: {
    height: 76,
    borderRadius: radius.card,
    backgroundColor: colors.cream,
  },
  noticeScroll: { paddingHorizontal: layout.gutter, paddingTop: spacing.xs },
  noticeCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  noticeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  noticeButton: {
    minHeight: 48,
    borderRadius: radius.button,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  noticeButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
    color: colors.bone,
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
