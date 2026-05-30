/**
 * CoachPackageContentsScreen — the coach content-authoring shell (PR-17 M2).
 *
 * One-sentence screen test: "This is where the coach authors package content."
 *
 * This screen LISTS a package's contents and lets the coach ADD / EDIT /
 * REMOVE them via the M1 `coachPackageContentsApi`. Each row carries a per-row
 * "Push to existing" affordance — but in M2 that is a PLACEHOLDER hook only
 * (`onPushPress(content)`); the push-vs-future prompt (M3), the confirm-preview
 * modal (M4), and the final wiring (M5) are out of scope here. The placeholder
 * seam is deliberately a single callback so M5 can wire it without restructuring
 * this file.
 *
 * UI Bible adherence:
 *   • Hick's Law — one primary path ("Add content"); destructive/secondary
 *     actions are de-emphasized; the safe default cadence lives in the form.
 *   • Miller's Law — each row exposes ≤5 elements (title, type, cadence, and a
 *     compact action group).
 *   • Warm copy — the empty state reads "No content yet — add the first piece",
 *     never "No data".
 *   • Consistency — reuses useTheme() colors (forest #2C4A36 / cream #F5EFE4),
 *     the primary-button TouchableOpacity style from CoachPackageEditScreen
 *     :397-411, and HapticPressable + haptics (lightTap/mediumTap). No emoji,
 *     no hardcoded hex, no new design dependency.
 *
 * Reorder is intentionally omitted in M2 (clean seam): the M1 client exposes
 * `coachPackageContentsApi.reorder`, and rows render in `display_order`, so a
 * later unit can add drag-reorder without reshaping the list.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';

import {
  AttachContentBody,
  coachPackageContentsApi,
  PackageContent,
  PatchContentBody,
} from '../../../api/packageContentsApi';
import { generateIdempotencyKey } from '../../../utils/idempotency';
import { errorMessage } from '../../../types/common';
import { lightTap, mediumTap, warningTap } from '../../../utils/haptics';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import HapticPressable from '../../../components/HapticPressable';
import ContentAttachForm, {
  assetTypeLabel,
  cadenceLabel,
} from './contents/ContentAttachForm';

type ParamList = {
  CoachPackageContents: { packageId: string; title?: string };
};
interface Props {
  navigation: NavigationProp<ParamListBase>;
  route: RouteProp<ParamList, 'CoachPackageContents'>;
}

export default function CoachPackageContentsScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { packageId, title } = route.params;

  const [contents, setContents] = useState<PackageContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<PackageContent | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await coachPackageContentsApi.list(packageId);
      setContents(res.data.contents ?? []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load content. Pull to try again.'));
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = useCallback(() => {
    mediumTap();
    setEditing(null);
    setFormVisible(true);
  }, []);

  const openEdit = useCallback((content: PackageContent) => {
    lightTap();
    setEditing(content);
    setFormVisible(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormVisible(false);
    setEditing(null);
  }, []);

  const handleAttach = useCallback(
    async (body: AttachContentBody) => {
      setSaving(true);
      try {
        // Idempotency key per the shared util (decision #8) — guards against a
        // double-submit creating two rows. The M1 client also defaults a key
        // when omitted; we pass an explicit one for clarity + testability.
        await coachPackageContentsApi.attach(
          packageId,
          body,
          generateIdempotencyKey(),
        );
        closeForm();
        await load();
      } catch (err) {
        warningTap();
        Alert.alert(
          'Could not add content',
          errorMessage(err, 'Please check the asset and try again.'),
        );
      } finally {
        setSaving(false);
      }
    },
    [packageId, closeForm, load],
  );

  const handlePatch = useCallback(
    async (body: PatchContentBody) => {
      if (!editing) return;
      setSaving(true);
      try {
        await coachPackageContentsApi.patch(
          packageId,
          editing.id,
          body,
          generateIdempotencyKey(),
        );
        closeForm();
        await load();
      } catch (err) {
        warningTap();
        Alert.alert(
          'Could not save content',
          errorMessage(err, 'Please try again.'),
        );
      } finally {
        setSaving(false);
      }
    },
    [packageId, editing, closeForm, load],
  );

  const handleRemove = useCallback(
    (content: PackageContent) => {
      warningTap();
      Alert.alert(
        'Remove this content?',
        'Buyers who already received it keep it. New buyers will no longer get it.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await coachPackageContentsApi.remove(
                  packageId,
                  content.id,
                  generateIdempotencyKey(),
                );
                await load();
              } catch (err) {
                Alert.alert(
                  'Could not remove',
                  errorMessage(err, 'Please try again.'),
                );
              }
            },
          },
        ],
      );
    },
    [packageId, load],
  );

  /**
   * PLACEHOLDER SEAM for M5 (decision #12, per-card entry point).
   *
   * M2 owns the affordance but NOT the behavior: the push-vs-future prompt
   * (M3) and confirm-preview modal (M4) are separate new files, wired here by
   * M5. Until then this is a no-op hint so the surface is discoverable without
   * pretending the flow exists. Do NOT build the push modal in this file.
   */
  const onPushPress = useCallback((_content: PackageContent) => {
    // TODO(M5): open PushPromptSheet → PushConfirmModal for `_content`.
    lightTap();
    Alert.alert(
      'Push to existing buyers',
      'Pushing an update to existing buyers is coming soon.',
    );
  }, []);

  const renderRow = useCallback(
    ({ item }: { item: PackageContent }) => {
      const rowTitle = item.display_title?.trim() || assetTypeLabel(item.asset_type);
      return (
        <View style={styles.row} testID={`content-row-${item.id}`}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {rowTitle}
            </Text>
            <View style={styles.rowMetaLine}>
              <Text style={styles.rowMeta}>{assetTypeLabel(item.asset_type)}</Text>
              <Text style={styles.rowMetaDot}>·</Text>
              <Text style={styles.rowMeta}>{cadenceLabel(item.cadence_kind)}</Text>
            </View>
          </View>
          <View style={styles.rowActions}>
            <HapticPressable
              intent="light"
              onPress={() => onPushPress(item)}
              style={styles.rowActionBtn}
              accessibilityRole="button"
              accessibilityLabel={`Push ${rowTitle} to existing buyers`}
              testID={`content-row-push-${item.id}`}
            >
              <Ionicons name="paper-plane-outline" size={18} color={colors.primary} />
            </HapticPressable>
            <HapticPressable
              intent="light"
              onPress={() => openEdit(item)}
              style={styles.rowActionBtn}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${rowTitle}`}
              testID={`content-row-edit-${item.id}`}
            >
              <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
            </HapticPressable>
            <HapticPressable
              intent="warning"
              onPress={() => handleRemove(item)}
              style={styles.rowActionBtn}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${rowTitle}`}
              testID={`content-row-remove-${item.id}`}
            >
              <Ionicons name="trash-outline" size={18} color={colors.warning} />
            </HapticPressable>
          </View>
        </View>
      );
    },
    [styles, colors, onPushPress, openEdit, handleRemove],
  );

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.center} testID="content-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.center} testID="content-error">
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (contents.length === 0) {
      return (
        <View style={styles.center} testID="content-empty">
          <Ionicons
            name="document-text-outline"
            size={32}
            color={colors.textMuted}
          />
          <Text style={styles.emptyTitle}>No content yet — add the first piece</Text>
          <Text style={styles.emptyHint}>
            Attach a workout, plan, PDF, video, or message and choose when buyers
            receive it.
          </Text>
        </View>
      );
    }
    return (
      <FlatList
        data={contents}
        keyExtractor={(c) => c.id}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        testID="content-list"
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          {title?.trim() || 'Package content'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.body}>{renderBody()}</View>

      {/* Hick's Law — one primary path. */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={openAdd}
          accessibilityRole="button"
          accessibilityLabel="Add content"
          testID="content-add-button"
        >
          <Ionicons name="add" size={20} color={colors.textOnPrimary} />
          <Text style={styles.primaryBtnText}>Add content</Text>
        </TouchableOpacity>
      </View>

      <ContentAttachForm
        visible={formVisible}
        content={editing}
        saving={saving}
        onCancel={closeForm}
        onSubmitAttach={handleAttach}
        onSubmitPatch={handlePatch}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    body: { flex: 1 },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      gap: 10,
    },
    listContent: { paddingHorizontal: 24, paddingVertical: 12 },
    separator: { height: 1, backgroundColor: colors.divider },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      gap: 12,
    },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    rowMetaLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
    },
    rowMeta: { fontSize: 12, color: colors.textSecondary },
    rowMetaDot: { fontSize: 12, color: colors.textMuted },
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rowActionBtn: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    emptyHint: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    errorText: { fontSize: 14, color: colors.error, textAlign: 'center' },
    retryBtn: {
      marginTop: 4,
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 2,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    retryBtnText: { color: colors.primary, fontSize: 14, fontWeight: '500' },
    footer: {
      paddingHorizontal: 24,
      paddingTop: 12,
      paddingBottom: 28,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 2,
    },
    primaryBtnText: {
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
  });
