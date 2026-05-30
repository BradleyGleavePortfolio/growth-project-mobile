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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  PushAudience,
} from '../../../api/packageContentsApi';
import { generateIdempotencyKey } from '../../../utils/idempotency';
import { errorMessage } from '../../../types/common';
import {
  lightTap,
  mediumTap,
  successTap,
  warningTap,
} from '../../../utils/haptics';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import HapticPressable from '../../../components/HapticPressable';
import ContentAttachForm, {
  assetTypeLabel,
  cadenceLabel,
} from './contents/ContentAttachForm';
import PushPromptSheet from './contents/PushPromptSheet';
import PushConfirmModal from './contents/PushConfirmModal';

// Resolved audience for THIS push (decision #1, per-push). M5 defaults to
// 'active' (active buyers); the confirm modal shows the resolved count/label.
// Module-scope constants so handlers don't need them in their dependency lists.
const PUSH_AUDIENCE: PushAudience = 'active';
const PUSH_AUDIENCE_LABEL = 'active buyers';

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

  // ── Per-card push flow state (PR-17 M5, decision #12) ──────────────────────
  // The push flow is a small state machine confined to this screen:
  //   pushTarget set  → PushPromptSheet visible (the M3 push-vs-future choice)
  //   confirmVisible  → PushConfirmModal visible (the M4 preview + date + notify)
  // `pushTarget` is the content row the coach tapped; it stays set across the
  // prompt → confirm hops so the confirm step knows which content to push.
  const [pushTarget, setPushTarget] = useState<PackageContent | null>(null);
  const [promptVisible, setPromptVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [audienceCount, setAudienceCount] = useState(0);
  const [buyerNotify, setBuyerNotify] = useState(true); // default ON (decision #9)
  const [fireAt, setFireAt] = useState<Date | null>(null); // coach picks (decision #2)
  const [pushSubmitting, setPushSubmitting] = useState(false);
  // Calm loading affordance during the pushPreview round-trip (P2): the prompt
  // sheet has closed, but the confirm modal cannot open until preview resolves.
  // Without this the screen shows a "dead" moment. We render a calm overlay
  // (warm, no "Loading…" text, no spinner-flash jank if preview is instant).
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Synchronous push guards (PR-17 M5 P0 fix, decision #8 / #19 / R19) ─────
  // React state (`pushSubmitting`) updates are async/batched, so a fast
  // DOUBLE-TAP on Confirm in the SAME tick both see `pushSubmitting === false`
  // and fire push twice — and worse, each tap minted a NEW idempotency key, so
  // the backend saw two DIFFERENT keys and could NOT dedupe → double delivery.
  //
  // The fix is two refs (refs are written synchronously; state is not):
  //   • submitInFlightRef — set true at the TOP of the confirm handler BEFORE
  //     any await; a synchronous second tap bails immediately. Reset in finally.
  //   • pushIdemKeyRef — ONE stable idempotency key per push INTENT, minted
  //     once when the intent begins (preview resolves / confirm modal opens)
  //     and reused for the push call AND any retry of the SAME intent. A
  //     brand-new intent (new modal open) gets a fresh key.
  const submitInFlightRef = useRef(false);
  const pushIdemKeyRef = useRef<string | null>(null);

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

  // The resolved title for a row — mirrors renderRow's `rowTitle` so the prompt
  // and confirm copy name the exact content the coach tapped.
  const contentTitleOf = useCallback(
    (content: PackageContent) =>
      content.display_title?.trim() || assetTypeLabel(content.asset_type),
    [],
  );

  // ── Per-card push flow (PR-17 M5, decision #12) ──────────────────────────

  // Reset all transient push state — used when the flow closes (dismiss / cancel
  // / future-only / success) so a later tap starts clean.
  const resetPushState = useCallback(() => {
    setPushTarget(null);
    setAudienceCount(0);
    setBuyerNotify(true);
    setFireAt(null);
    setPushSubmitting(false);
    setPreviewLoading(false);
    // Clear the synchronous push guards: this push intent is over, so a later
    // tap starts a brand-new intent (and will mint a fresh idempotency key).
    submitInFlightRef.current = false;
    pushIdemKeyRef.current = null;
  }, []);

  // Step 1 — tap the row's push icon: open the M3 prompt for that content.
  // mode='new_content' is the per-card "push this existing content" entry
  // (cadence_edit/full_edit belong to the edit-save flow, out of M5 scope).
  const onPushPress = useCallback((content: PackageContent) => {
    lightTap();
    setPushTarget(content);
    setConfirmVisible(false);
    setAudienceCount(0);
    setBuyerNotify(true);
    setFireAt(null);
    setPushSubmitting(false);
    setPreviewLoading(false);
    // Fresh push intent: clear the synchronous guards so the next confirmed
    // push mints exactly one new stable idempotency key.
    submitInFlightRef.current = false;
    pushIdemKeyRef.current = null;
    setPromptVisible(true);
  }, []);

  // Step 2 — future-only / dismiss: close the sheet, NO push (decision #5).
  const closePrompt = useCallback(() => {
    setPromptVisible(false);
    resetPushState();
  }, [resetPushState]);

  // Step 3 — "push to existing": close the prompt, preview the audience, then
  // open the M4 confirm modal with the resolved count. A preview FAILURE shows
  // a warm Alert and does NOT open the confirm modal (error-prevention: never
  // surface a real error as a benign empty state).
  const onPushExisting = useCallback(async () => {
    const target = pushTarget;
    if (!target) return;
    setPromptVisible(false);
    // P2: show a calm loading affordance for the duration of the preview
    // round-trip so there is no dead moment between the sheet closing and the
    // confirm modal opening.
    setPreviewLoading(true);
    try {
      const res = await coachPackageContentsApi.pushPreview(packageId, target.id, {
        audience: PUSH_AUDIENCE,
        mode: 'push_existing',
      });
      setAudienceCount(res.data.count);
      setBuyerNotify(true);
      setFireAt(null);
      setPushSubmitting(false);
      // The push INTENT begins here: mint ONE stable idempotency key now and
      // reuse it for the push call and any retry of this same intent. Both the
      // ref (synchronous source of truth) and state (debug/inspection) carry it.
      const intentKey = generateIdempotencyKey();
      pushIdemKeyRef.current = intentKey;
      submitInFlightRef.current = false;
      setPreviewLoading(false);
      setConfirmVisible(true);
    } catch (err) {
      warningTap();
      Alert.alert(
        'Could not check buyers',
        errorMessage(err, 'Please try again.'),
      );
      resetPushState();
    }
  }, [pushTarget, packageId, resetPushState]);

  // Step 4 — confirm modal field changes.
  const onChangeBuyerNotify = useCallback((next: boolean) => {
    setBuyerNotify(next);
  }, []);
  const onChangeFireAt = useCallback((next: Date) => {
    setFireAt(next);
  }, []);

  // Step 6 — cancel: close the confirm modal, reset transient push state.
  const onPushCancel = useCallback(() => {
    setConfirmVisible(false);
    resetPushState();
  }, [resetPushState]);

  // Step 5 — confirm: call the push API with ONE stable idempotency key per
  // push intent. Double-submit (P0) is blocked SYNCHRONOUSLY by
  // `submitInFlightRef`: a fast second tap in the same tick — before the
  // `pushSubmitting` state re-render lands — sees the ref already true and
  // bails, so push fires EXACTLY ONCE. The `pushSubmitting` STATE still drives
  // the spinner/disabled UI. The idempotency key was minted ONCE when the
  // intent began (`onPushExisting`), so a retry after a FAILED push reuses the
  // SAME key (same intent → backend can dedupe). On success: warm Alert +
  // success haptic + refresh. On error: warningTap + warm Alert, keep the
  // modal OPEN so the coach can retry, submitting + the ref back to false.
  const onPushConfirm = useCallback(async () => {
    // SYNCHRONOUS re-entrancy guard FIRST — before any await. Refs are written
    // synchronously, so a same-tick double-tap is blocked here even though the
    // `pushSubmitting` state has not re-rendered yet.
    if (submitInFlightRef.current) return;
    const target = pushTarget;
    // Guard a missing date/target (the modal also enforces these).
    if (!target || fireAt == null) return;
    // Reuse the ONE key minted when this push intent began. A retry of a failed
    // push keeps the same key; a fresh modal open mints a new one in preview.
    const key = pushIdemKeyRef.current ?? generateIdempotencyKey();
    pushIdemKeyRef.current = key;
    // Claim the lock synchronously, then reflect it in state for the UI.
    submitInFlightRef.current = true;
    setPushSubmitting(true);
    try {
      const res = await coachPackageContentsApi.push(
        packageId,
        target.id,
        {
          audience: PUSH_AUDIENCE,
          fire_at: fireAt.toISOString(),
          mode: 'push_existing',
          notify: buyerNotify,
        },
        key,
      );
      successTap();
      setConfirmVisible(false);
      resetPushState();
      // Warm success copy in the decision #10 preview language.
      Alert.alert(
        'Scheduled',
        `This delivers to ${res.data.scheduled} ${PUSH_AUDIENCE_LABEL}.`,
      );
      await load();
    } catch (err) {
      warningTap();
      // Keep the modal OPEN so the coach can retry; reuse the SAME key. Release
      // the synchronous lock so a deliberate retry tap can proceed.
      submitInFlightRef.current = false;
      setPushSubmitting(false);
      Alert.alert('Could not push', errorMessage(err, 'Please try again.'));
    }
  }, [
    pushTarget,
    fireAt,
    packageId,
    buyerNotify,
    resetPushState,
    load,
  ]);

  const renderRow = useCallback(
    ({ item }: { item: PackageContent }) => {
      const rowTitle = contentTitleOf(item);
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
    [styles, colors, contentTitleOf, onPushPress, openEdit, handleRemove],
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

      {/* PR-17 M5 — per-card push: prompt (M3) → confirm (M4) → push API. */}
      <PushPromptSheet
        visible={promptVisible}
        contentTitle={pushTarget ? contentTitleOf(pushTarget) : ''}
        mode="new_content"
        onPushExisting={onPushExisting}
        onFutureOnly={closePrompt}
        onDismiss={closePrompt}
      />

      <PushConfirmModal
        visible={confirmVisible}
        contentTitle={pushTarget ? contentTitleOf(pushTarget) : ''}
        audienceCount={audienceCount}
        audienceLabel={PUSH_AUDIENCE_LABEL}
        buyerNotify={buyerNotify}
        onChangeBuyerNotify={onChangeBuyerNotify}
        fireAt={fireAt}
        onChangeFireAt={onChangeFireAt}
        onConfirm={onPushConfirm}
        onCancel={onPushCancel}
        submitting={pushSubmitting}
      />

      {/* P2 — calm preview affordance: after the prompt sheet closes and before
          the confirm modal opens, the pushPreview round-trip would otherwise be
          a dead moment. Show a calm, warm overlay (no "Loading…" text). If
          preview is instant this unmounts immediately — no spinner-flash jank. */}
      {previewLoading ? (
        <View
          style={styles.previewOverlay}
          testID="push-preview-loading"
          accessibilityRole="progressbar"
          accessibilityLabel="Checking your buyers"
        >
          <View style={styles.previewCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.previewText}>Checking your buyers…</Text>
          </View>
        </View>
      ) : null}
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
    previewOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      opacity: 0.96,
    },
    previewCard: {
      alignItems: 'center',
      gap: 12,
      paddingVertical: 24,
      paddingHorizontal: 32,
    },
    previewText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
