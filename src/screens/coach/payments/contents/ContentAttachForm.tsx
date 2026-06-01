/**
 * ContentAttachForm — the attach/edit form rendered as a page-sheet modal from
 * CoachPackageContentsScreen (PR-17 M2).
 *
 * One concept per moment (UI Bible): the coach picks WHAT (asset type + the
 * asset reference + optional title/caption) and WHEN (cadence). The cadence
 * defaults to the safe `immediate` and the advanced cadence options live
 * behind a progressive-disclosure toggle so the default path is a single
 * obvious choice (Hick's Law + progressive disclosure). The visible surface is
 * kept to ≤5 primary elements (Miller's Law): asset-type picker, asset
 * reference, optional title, optional caption, and the primary save action —
 * cadence is `immediate` until the coach opens the advanced disclosure.
 *
 * Reuse (consistency): the segmented-TouchableOpacity picker pattern mirrors
 * CoachPackageEditScreen.tsx:62-67/345-368; the primary-button TouchableOpacity
 * style mirrors CoachPackageEditScreen.tsx:397-411; modal precedent is
 * PackageSelectionSheet.tsx:343-354 (RN core <Modal presentationStyle="pageSheet">).
 * Colors come from useTheme() ({ colors }) — no hardcoded hex, no emoji, no new
 * design dependency.
 *
 * This form is mode-agnostic: passing an existing `content` puts it in edit
 * mode (it seeds the fields and the parent routes submit → patch); omitting it
 * is attach mode (parent routes submit → attach). The parent owns the API
 * calls + idempotency keys; this component only collects + validates input.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  AttachContentBody,
  CadenceKind,
  ContentAssetType,
  PackageContent,
  PatchContentBody,
} from '../../../../api/packageContentsApi';
import { useTheme, ThemeColors } from '../../../../theme/ThemeProvider';
import { mediumTap, warningTap } from '../../../../utils/haptics';

// ─── option tables (mirror the M1 ContentAssetType / CadenceKind unions) ──────

const ASSET_TYPE_OPTIONS: Array<{ label: string; value: ContentAssetType }> = [
  { label: 'Workout program', value: 'workout_program' },
  { label: 'Workout plan', value: 'workout_plan' },
  { label: 'Meal plan', value: 'meal_plan' },
  { label: 'PDF', value: 'pdf' },
  { label: 'Video', value: 'video' },
  { label: 'Message', value: 'auto_message' },
];

// `immediate` is the safe default + the only option shown until the coach
// opens the advanced disclosure (progressive disclosure / Hick's Law).
const CADENCE_OPTIONS: Array<{ label: string; value: CadenceKind }> = [
  { label: 'Right away', value: 'immediate' },
  { label: 'After purchase', value: 'relative_to_purchase' },
  { label: 'On a date', value: 'fixed_calendar' },
  { label: 'On completion', value: 'on_completion' },
  { label: 'On milestone', value: 'on_milestone' },
];

// Human cadence labels shared with the contents screen rows.
export function cadenceLabel(kind: CadenceKind): string {
  switch (kind) {
    case 'immediate':
      return 'Right away';
    case 'relative_to_purchase':
      return 'After purchase';
    case 'fixed_calendar':
      return 'On a date';
    case 'on_completion':
      return 'On completion';
    case 'on_milestone':
      return 'On milestone';
    default:
      return kind;
  }
}

export function assetTypeLabel(type: ContentAssetType): string {
  const found = ASSET_TYPE_OPTIONS.find((o) => o.value === type);
  return found ? found.label : type;
}

export interface ContentAttachFormProps {
  visible: boolean;
  /** When set, the form opens in edit mode seeded from this row. */
  content?: PackageContent | null;
  saving?: boolean;
  onCancel: () => void;
  /**
   * Attach mode submit (no `content` prop). The parent generates the
   * idempotency key and calls coachPackageContentsApi.attach.
   */
  onSubmitAttach: (body: AttachContentBody) => void;
  /**
   * Edit mode submit (with `content` prop). The parent routes to
   * coachPackageContentsApi.patch.
   */
  onSubmitPatch: (body: PatchContentBody) => void;
}

export default function ContentAttachForm({
  visible,
  content,
  saving = false,
  onCancel,
  onSubmitAttach,
  onSubmitPatch,
}: ContentAttachFormProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isEdit = Boolean(content);

  const [assetType, setAssetType] = useState<ContentAssetType>(
    content?.asset_type ?? 'workout_program',
  );
  const [assetId, setAssetId] = useState(content?.asset_id ?? '');
  const [cadenceKind, setCadenceKind] = useState<CadenceKind>(
    content?.cadence_kind ?? 'immediate',
  );
  const [title, setTitle] = useState(content?.display_title ?? '');
  const [caption, setCaption] = useState(content?.display_caption ?? '');
  // Advanced cadence is disclosed only when the seeded row already uses a
  // non-immediate cadence, otherwise it stays collapsed on the safe default.
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(
    Boolean(content && content.cadence_kind !== 'immediate'),
  );
  const [relativeDays, setRelativeDays] = useState<string>(() => {
    const d = content?.cadence_payload?.offset_days;
    return typeof d === 'number' ? String(d) : '';
  });
  // fixed_calendar → release_at (ISO 8601). M2 collects this as a simple text
  // entry; the rich date picker lands with M4 (do NOT add that dep here).
  const [releaseAt, setReleaseAt] = useState<string>(() => {
    const r = content?.cadence_payload?.release_at;
    return typeof r === 'string' ? r : '';
  });
  // on_milestone → milestone_key (non-empty string per backend DTO).
  const [milestoneKey, setMilestoneKey] = useState<string>(() => {
    const m = content?.cadence_payload?.milestone_key;
    return typeof m === 'string' ? m : '';
  });
  const [error, setError] = useState('');

  // P1 #1 fix — re-sync ALL form state when the editing target or visibility
  // changes. The parent keeps a SINGLE ContentAttachForm instance mounted
  // (CoachPackageContentsScreen.tsx) and merely flips `content`/`visible`, so
  // without this the useState initializers above only run once and editing an
  // existing row would submit stale/default values (wiping title/caption and
  // resetting cadence to immediate). Keyed on content?.id + visible (and
  // content?.updated_at so an edited-then-reopened row re-seeds): null content
  // → add-mode defaults; an existing row → its seeded values.
  useEffect(() => {
    if (content) {
      setAssetType(content.asset_type);
      setAssetId(content.asset_id ?? '');
      setCadenceKind(content.cadence_kind);
      setTitle(content.display_title ?? '');
      setCaption(content.display_caption ?? '');
      setAdvancedOpen(content.cadence_kind !== 'immediate');
      const d = content.cadence_payload?.offset_days;
      setRelativeDays(typeof d === 'number' ? String(d) : '');
      const r = content.cadence_payload?.release_at;
      setReleaseAt(typeof r === 'string' ? r : '');
      const m = content.cadence_payload?.milestone_key;
      setMilestoneKey(typeof m === 'string' ? m : '');
    } else {
      // Add mode — reset to the safe defaults.
      setAssetType('workout_program');
      setAssetId('');
      setCadenceKind('immediate');
      setTitle('');
      setCaption('');
      setAdvancedOpen(false);
      setRelativeDays('');
      setReleaseAt('');
      setMilestoneKey('');
    }
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.id, content?.updated_at, visible]);

  const buildCadencePayload = useCallback((): {
    payload: Record<string, unknown> | null;
    message: string | null;
  } => {
    // Build the per-kind cadence_payload and validate the required field is
    // present BEFORE submit (error-prevention, UI Bible). Every kind exposed in
    // CADENCE_OPTIONS builds a payload the backend zod schema accepts:
    //   immediate            → {} (ImmediatePayload is strict-empty)
    //   relative_to_purchase → { offset_days } (int 0..365)
    //   fixed_calendar       → { release_at } (ISO 8601 string)
    //   on_completion        → {} (depends_on_content_id is optional)
    //   on_milestone         → { milestone_key } (non-empty string)
    if (cadenceKind === 'relative_to_purchase') {
      const n = Number(relativeDays.trim());
      if (!relativeDays.trim() || !Number.isInteger(n) || n < 0 || n > 365) {
        return {
          payload: null,
          message: 'Days after purchase must be a whole number between 0 and 365.',
        };
      }
      return { payload: { offset_days: n }, message: null };
    }
    if (cadenceKind === 'fixed_calendar') {
      const v = releaseAt.trim();
      if (!v || Number.isNaN(Date.parse(v))) {
        return {
          payload: null,
          message:
            'Enter a release date as an ISO date — for example 2026-09-01T09:00:00Z.',
        };
      }
      return { payload: { release_at: v }, message: null };
    }
    if (cadenceKind === 'on_milestone') {
      const v = milestoneKey.trim();
      if (!v) {
        return {
          payload: null,
          message: 'Add the milestone key that releases this content.',
        };
      }
      return { payload: { milestone_key: v }, message: null };
    }
    // `immediate` and `on_completion` carry no required payload field.
    return { payload: {}, message: null };
  }, [cadenceKind, relativeDays, releaseAt, milestoneKey]);

  const handleSubmit = useCallback(() => {
    const trimmedAssetId = assetId.trim();
    if (!trimmedAssetId) {
      setError('Pick the asset to attach.');
      warningTap();
      return;
    }
    const cad = buildCadencePayload();
    if (!cad.payload) {
      setError(cad.message ?? 'Check the cadence settings.');
      warningTap();
      return;
    }
    setError('');
    mediumTap();
    const displayTitle = title.trim() || null;
    const displayCaption = caption.trim() || null;

    if (isEdit) {
      const patch: PatchContentBody = {
        display_title: displayTitle,
        display_caption: displayCaption,
        cadence_kind: cadenceKind,
        cadence_payload: cad.payload,
      };
      onSubmitPatch(patch);
      return;
    }
    const body: AttachContentBody = {
      asset_type: assetType,
      asset_id: trimmedAssetId,
      cadence_kind: cadenceKind,
      cadence_payload: cad.payload,
      display_title: displayTitle,
      display_caption: displayCaption,
    };
    onSubmitAttach(body);
  }, [
    assetId,
    assetType,
    cadenceKind,
    title,
    caption,
    isEdit,
    buildCadencePayload,
    onSubmitAttach,
    onSubmitPatch,
  ]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.sheet}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={onCancel}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>
            {isEdit ? 'Edit content' : 'Add content'}
          </Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID="content-attach-form"
        >
          {/* Asset type — segmented picker (disabled in edit; asset_type is
              immutable once attached). */}
          <Label colors={colors}>What are you adding?</Label>
          <View style={styles.segment}>
            {ASSET_TYPE_OPTIONS.map((opt) => {
              const active = assetType === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.segmentItem,
                    active && styles.segmentItemActive,
                    isEdit && styles.segmentItemLocked,
                  ]}
                  onPress={() => {
                    if (isEdit) return;
                    setAssetType(opt.value);
                  }}
                  disabled={isEdit}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: isEdit }}
                  accessibilityLabel={opt.label}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      active && styles.segmentTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {!isEdit ? (
            <>
              <Label colors={colors}>Asset reference</Label>
              <TextInput
                value={assetId}
                onChangeText={setAssetId}
                placeholder="Paste the asset ID"
                style={styles.input}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                testID="content-attach-asset-id"
              />
            </>
          ) : null}

          <Label colors={colors}>Title (optional)</Label>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What the buyer sees"
            style={styles.input}
            placeholderTextColor={colors.textMuted}
            maxLength={120}
            testID="content-attach-title"
          />

          <Label colors={colors}>Caption (optional)</Label>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="A short note for the buyer"
            style={[styles.input, styles.inputMultiline]}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            testID="content-attach-caption"
          />

          {/* Progressive disclosure: the default cadence is `immediate`. The
              advanced cadence picker only appears once the coach opts in. */}
          <TouchableOpacity
            style={styles.disclosureRow}
            onPress={() => {
              const next = !advancedOpen;
              setAdvancedOpen(next);
              if (!next) {
                // Collapsing returns to the safe default.
                setCadenceKind('immediate');
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedOpen }}
            accessibilityLabel="Advanced delivery timing"
            testID="content-attach-cadence-disclosure"
          >
            <View>
              <Text style={styles.disclosureTitle}>Delivery timing</Text>
              <Text style={styles.disclosureHint}>
                {advancedOpen
                  ? 'Choose when buyers receive this'
                  : `Default — ${cadenceLabel('immediate')}`}
              </Text>
            </View>
            <Ionicons
              name={advancedOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {advancedOpen ? (
            <View testID="content-attach-cadence-advanced">
              <View style={styles.segment}>
                {CADENCE_OPTIONS.map((opt) => {
                  const active = cadenceKind === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.segmentItem,
                        active && styles.segmentItemActive,
                      ]}
                      onPress={() => setCadenceKind(opt.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={opt.label}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {cadenceKind === 'relative_to_purchase' ? (
                <>
                  <Label colors={colors}>Days after purchase</Label>
                  <TextInput
                    value={relativeDays}
                    onChangeText={setRelativeDays}
                    placeholder="7"
                    style={styles.input}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={3}
                    testID="content-attach-relative-days"
                  />
                </>
              ) : null}

              {/* fixed_calendar needs release_at. This collects a simple ISO
                  date string; a richer date picker can replace this input in a
                  later milestone without changing the surrounding contract. */}
              {cadenceKind === 'fixed_calendar' ? (
                <>
                  <Label colors={colors}>Release date (ISO)</Label>
                  <TextInput
                    value={releaseAt}
                    onChangeText={setReleaseAt}
                    placeholder="2026-09-01T09:00:00Z"
                    style={styles.input}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="content-attach-release-at"
                  />
                </>
              ) : null}

              {/* on_milestone needs a milestone_key (non-empty string). */}
              {cadenceKind === 'on_milestone' ? (
                <>
                  <Label colors={colors}>Milestone key</Label>
                  <TextInput
                    value={milestoneKey}
                    onChangeText={setMilestoneKey}
                    placeholder="first_workout_complete"
                    style={styles.input}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="content-attach-milestone-key"
                  />
                </>
              ) : null}
            </View>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={isEdit ? 'Save content' : 'Add content'}
            testID="content-attach-submit"
          >
            {saving ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {isEdit ? 'Save content' : 'Add content'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Label({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: ThemeColors;
}) {
  return (
    <Text
      style={{
        marginTop: 16,
        marginBottom: 6,
        fontSize: 12,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: '500',
      }}
    >
      {children}
    </Text>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 12,
    },
    iconBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
    content: { paddingHorizontal: 24, paddingBottom: 60 },
    input: {
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 4,
      fontSize: 15,
      color: colors.textPrimary,
    },
    inputMultiline: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    segment: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 4,
      gap: 4,
    },
    segmentItem: {
      flexGrow: 1,
      flexBasis: '30%',
      paddingVertical: 10,
      borderRadius: 2,
      alignItems: 'center',
    },
    segmentItemActive: { backgroundColor: colors.primary },
    segmentItemLocked: { opacity: 0.6 },
    segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
    segmentTextActive: { color: colors.textOnPrimary },
    disclosureRow: {
      marginTop: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    disclosureTitle: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    disclosureHint: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
    primaryBtn: {
      marginTop: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 2,
    },
    primaryBtnDisabled: { opacity: 0.6 },
    primaryBtnText: {
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
    errorText: {
      marginTop: 12,
      color: colors.error,
      fontSize: 13,
    },
  });
