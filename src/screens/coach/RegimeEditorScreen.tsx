/**
 * RegimeEditorScreen — F2 named-regime editor (coach surface).
 *
 * Surfaces, per locked operator decisions:
 *   • a regime display-name text input (regime name is INDEPENDENT of the
 *     package name — decision #6) saved via useUpdateRegime;
 *   • a read-only "Last 3 versions" revision drawer (rolling retention,
 *     decision #7) backed by useRegime(id);
 *   • a "Push changes to existing buyers" button calling
 *     usePushRegimeToExisting (opt-in propagation only — decision #1; F1 ships
 *     the endpoint, 404 OK until F1 merges);
 *   • an "Archive regime" button → confirmation modal calling useArchiveRegime
 *     (active clients continue, new attachments blocked — decision #8).
 *
 * There is NO pause action (decision #2).
 *
 * Flag-gated by `featureFlags.namedRegimes`: the route is only REGISTERED in
 * CoachNavigator behind the flag, so this screen is unreachable when OFF. The
 * body also renders null when OFF as defence-in-depth.
 *
 * Standardized on semanticColors / tokens.ts (bgSurface, never `surface`).
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import {
  useRegime,
  useRegimes,
  useUpdateRegime,
  useArchiveRegime,
  usePushRegimeToExisting,
} from '../../hooks/useRegimes';
import {
  romanRegimeArchived,
  romanRegimePushed,
} from '../../lib/roman/copy';
import type { RegimeListItem, RegimeRevisionItem } from '../../types/regimes';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';

type Props = NativeStackScreenProps<ClientsStackParamList, 'RegimeEditor'>;

/** Compact, locale-stable label for a revision row's timestamp. */
export function formatRevisionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function RegimeEditorScreen({
  route,
}: Props): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(), []);
  const regimeId = route.params?.regimeId ?? null;

  const regimes = useRegimes();
  const revisions = useRegime(regimeId ?? '');
  const update = useUpdateRegime();
  const archive = useArchiveRegime();
  const push = usePushRegimeToExisting();

  const current: RegimeListItem | undefined = useMemo(
    () => regimes.data?.find((r) => r.id === regimeId),
    [regimes.data, regimeId],
  );

  const [name, setName] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Defence-in-depth: route is unregistered when the flag is OFF.
  if (!featureFlags.namedRegimes) return null;

  const displayName = current
    ? current.regime_display_name ?? current.name
    : '';
  const nameValue = name || displayName;
  const archived = !!current?.archived_at;

  return (
    <SafeAreaView
      testID="regime-editor-screen"
      style={[styles.screen, { backgroundColor: semanticColors.bgPrimary }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.label, { color: semanticColors.textMuted }]}>
          Regime name
        </Text>
        <TextInput
          testID="regime-name-input"
          value={nameValue}
          onChangeText={setName}
          placeholder="Name this regime"
          placeholderTextColor={semanticColors.textMuted}
          editable={!archived}
          style={[
            styles.input,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
              color: semanticColors.textPrimary,
            },
          ]}
        />
        <TouchableOpacity
          testID="regime-save-name"
          accessibilityRole="button"
          disabled={update.isPending || archived || !regimeId || !nameValue.trim()}
          onPress={() =>
            regimeId &&
            update.mutate({ id: regimeId, regime_display_name: nameValue.trim() })
          }
          style={[styles.primaryButton, { backgroundColor: semanticColors.accent }]}
        >
          <Text style={[styles.primaryButtonText, { color: semanticColors.textOnAccent }]}>
            Save name
          </Text>
        </TouchableOpacity>

        {/* Read-only "Last 3 versions" revision drawer. */}
        <TouchableOpacity
          testID="regime-revisions-toggle"
          accessibilityRole="button"
          onPress={() => setDrawerOpen((v) => !v)}
          style={[styles.drawerToggle, { borderColor: semanticColors.border }]}
        >
          <Text style={[styles.drawerToggleText, { color: semanticColors.accentText }]}>
            {drawerOpen ? 'Hide versions' : 'Last 3 versions'}
          </Text>
        </TouchableOpacity>
        {drawerOpen ? (
          <View testID="regime-revisions-drawer" style={styles.drawer}>
            {revisions.isLoading ? (
              <ActivityIndicator testID="regime-revisions-spinner" />
            ) : (revisions.data?.length ?? 0) === 0 ? (
              <Text style={[styles.drawerEmpty, { color: semanticColors.textMuted }]}>
                No revisions recorded yet.
              </Text>
            ) : (
              (revisions.data ?? []).map((rev: RegimeRevisionItem) => (
                <View
                  key={rev.revision_index}
                  testID={`regime-revision-${rev.revision_index}`}
                  style={[styles.revisionRow, { borderColor: semanticColors.border }]}
                >
                  <Text style={[styles.revisionTitle, { color: semanticColors.textPrimary }]}>
                    Version {rev.revision_index}
                  </Text>
                  <Text style={[styles.revisionMeta, { color: semanticColors.textMuted }]}>
                    {formatRevisionDate(rev.created_at)} · {rev.cause}
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {/* Opt-in propagation to existing buyers (decision #1). */}
        <TouchableOpacity
          testID="regime-push-existing"
          accessibilityRole="button"
          disabled={push.isPending || archived || current?.head_revision_id == null}
          onPress={() =>
            current?.head_revision_id &&
            push.mutate({
              packageId: current.id,
              contentId: current.head_revision_id,
            })
          }
          style={[styles.secondaryButton, { borderColor: semanticColors.border }]}
        >
          <Text style={[styles.secondaryButtonText, { color: semanticColors.textPrimary }]}>
            Push changes to existing buyers
          </Text>
        </TouchableOpacity>
        {push.isSuccess && push.data ? (
          <Text
            testID="regime-push-confirmation"
            style={[styles.confirmation, { color: semanticColors.textMuted }]}
          >
            {romanRegimePushed({
              drops_updated: push.data.drops_updated,
              buyers_affected: push.data.buyers_affected,
            })}
          </Text>
        ) : null}

        {/* Archive (decision #8) — opens a confirmation modal. */}
        {archived ? (
          <Text
            testID="regime-archived-note"
            style={[styles.confirmation, { color: semanticColors.textMuted }]}
          >
            {romanRegimeArchived}
          </Text>
        ) : (
          <TouchableOpacity
            testID="regime-archive-button"
            accessibilityRole="button"
            disabled={!regimeId}
            onPress={() => setConfirmArchive(true)}
            style={[styles.destructiveButton, { borderColor: semanticColors.border }]}
          >
            <Text style={[styles.destructiveButtonText, { color: semanticColors.accentText }]}>
              Archive regime
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal
        visible={confirmArchive}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmArchive(false)}
      >
        <View style={[styles.modalScrim, { backgroundColor: semanticColors.overlay }]}>
          <View
            testID="regime-archive-modal"
            style={[
              styles.modalCard,
              {
                backgroundColor: semanticColors.bgSurface,
                borderColor: semanticColors.border,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: semanticColors.textPrimary }]}>
              Archive this regime?
            </Text>
            <Text style={[styles.modalBody, { color: semanticColors.textMuted }]}>
              Active clients keep their current plan. New purchases can no longer
              attach this regime.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                testID="regime-archive-cancel"
                accessibilityRole="button"
                onPress={() => setConfirmArchive(false)}
                style={[styles.secondaryButton, { borderColor: semanticColors.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: semanticColors.textPrimary }]}>
                  Keep regime
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="regime-archive-confirm"
                accessibilityRole="button"
                disabled={archive.isPending || !regimeId}
                onPress={() => {
                  if (!regimeId) return;
                  archive.mutate(regimeId, {
                    onSuccess: () => setConfirmArchive(false),
                  });
                }}
                style={[styles.primaryButton, { backgroundColor: semanticColors.accent }]}
              >
                <Text style={[styles.primaryButtonText, { color: semanticColors.textOnAccent }]}>
                  Archive
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles() {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    content: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: 16,
    },
    primaryButton: {
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
    },
    primaryButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    secondaryButton: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
    },
    secondaryButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    destructiveButton: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    destructiveButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    drawerToggle: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    drawerToggleText: {
      fontSize: 14,
      fontWeight: '600',
    },
    drawer: {
      gap: spacing.xs,
    },
    drawerEmpty: {
      fontSize: 13,
      paddingVertical: spacing.sm,
    },
    revisionRow: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      padding: spacing.sm,
      gap: 2,
    },
    revisionTitle: {
      fontSize: 14,
      fontWeight: '600',
    },
    revisionMeta: {
      fontSize: 12,
    },
    confirmation: {
      fontSize: 13,
      lineHeight: 18,
    },
    modalScrim: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.lg,
    },
    modalCard: {
      width: '100%',
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
    },
    modalBody: {
      fontSize: 14,
      lineHeight: 20,
    },
    modalActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
  });
}
