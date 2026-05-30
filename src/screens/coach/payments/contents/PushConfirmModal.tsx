/**
 * PushConfirmModal — PR-17 M4 push confirm + date picker (mobile).
 *
 * After the coach chooses "push to existing buyers" (M3's prompt), this modal
 * shows the concrete confirmation/preview step (PR-17 decision #10: "delivers
 * to N buyers on <date>") AND collects the fire-at DATE (decision #2:
 * coach-chosen date) with PAST dates physically un-selectable via the date
 * picker's `minimumDate` (decision #6, UI Bible error-prevention).
 *
 * Scope (M4): this is the CONFIRM UI ONLY. It does NOT call the push API and
 * does NOT wire into CoachPackageContentsScreen — M5 owns the screen wiring and
 * passes the resolved audience count + the API call behind `onConfirm`.
 *
 * UI Bible compliance:
 *  - CALM / Hick's / Miller's: a single dominant primary action ("Confirm &
 *    schedule"); a de-emphasised "Cancel"; ≤5 decision elements (preview line,
 *    date picker, notify toggle, confirm, cancel). One concept per moment.
 *  - Error-prevention (decision #6): the date picker sets `minimumDate = today`
 *    so a past date can never be selected; confirm stays disabled until a valid
 *    future `fireAt` exists, and is also disabled when `audienceCount === 0`
 *    (calm empty-state) or while `submitting`.
 *  - Brand: colours come from `useTheme()` `semanticColors` (forest/oxblood
 *    accent) — NO hardcoded hex, NO emoji. Mirrors the M2 ContentAttachForm
 *    page-sheet Modal precedent for consistency.
 *  - Accessibility: stable testIDs, 44pt touch targets, safe-area aware,
 *    `submitting` disables confirm and shows progress.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { useTheme } from '../../../../theme/useTheme';
import type { SemanticTokens } from '../../../../theme/tokens';
import { mediumTap, warningTap } from '../../../../utils/haptics';

export interface PushConfirmModalProps {
  visible: boolean;
  contentTitle: string;
  audienceCount: number; // "delivers to N buyers" (M5 passes resolved count from preview endpoint)
  audienceLabel?: string; // e.g. "active buyers" / "all buyers" / cohort name (decision #1)
  buyerNotify: boolean; // per-push toggle, default ON (decision #9)
  onChangeBuyerNotify: (next: boolean) => void;
  fireAt: Date | null; // selected fire date (decision #2)
  onChangeFireAt: (next: Date) => void;
  onConfirm: () => void; // coach confirms → M5 calls the push API
  onCancel: () => void;
  submitting?: boolean; // disable confirm + show spinner while M5's API call is in flight
}

// Start-of-today, used as the picker's minimumDate so PAST dates are physically
// un-selectable (decision #6 / UI Bible error-prevention).
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Warm, human preview formatting of the selected fire-at moment. Kept local
// (not the repo's `formatDate`, which takes a YYYY-MM-DD string) because a
// fire-at is a full Date including a time-of-day.
function formatFireAt(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function PushConfirmModal({
  visible,
  contentTitle,
  audienceCount,
  audienceLabel = 'buyers',
  buyerNotify,
  onChangeBuyerNotify,
  fireAt,
  onChangeFireAt,
  onConfirm,
  onCancel,
  submitting = false,
}: PushConfirmModalProps) {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Android shows the picker as a transient dialog; iOS renders it inline. We
  // gate the Android dialog behind this flag (opened from the date row).
  const [pickerOpen, setPickerOpen] = useState(false);

  const minimumDate = useMemo(() => startOfToday(), []);

  const hasAudience = audienceCount > 0;
  // Defence-in-depth (R2 P1): `fireAt` is valid ONLY when it is a non-null Date
  // that is NOT in the past, using the SAME now/today basis as the picker's
  // `minimumDate` (= start-of-today). Chosen basis: "today or later"
  // (`fireAt.getTime() >= minimumDate.getTime()`), NOT "future instant", so the
  // gate and the picker agree exactly — any whole day from today onward is
  // selectable AND confirmable. The picker's `minimumDate` blocks past dates
  // chosen IN the picker; this guard additionally blocks a past `fireAt` that
  // arrives via PROPS (e.g. M5 passing a stale/restored date, or a value that
  // crossed midnight). Decision #6: past dates are BLOCKED at the gate, not
  // only at the picker.
  const hasFireAt = fireAt != null && fireAt.getTime() >= minimumDate.getTime();
  // Confirm is enabled ONLY when there is an audience, a chosen future date, and
  // no in-flight submit (error-prevention + CALM single-decision gating).
  const canConfirm = hasAudience && hasFireAt && !submitting;

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date) => {
      // Android closes the dialog on any interaction; iOS stays inline.
      if (Platform.OS !== 'ios') {
        setPickerOpen(false);
      }
      if (event.type === 'dismissed' || !selected) {
        return;
      }
      // Defence-in-depth: even though minimumDate blocks past dates in the UI,
      // never propagate a past selection upward.
      if (selected.getTime() < minimumDate.getTime()) {
        return;
      }
      onChangeFireAt(selected);
    },
    [minimumDate, onChangeFireAt],
  );

  const handleConfirm = useCallback(() => {
    if (!canConfirm) {
      warningTap();
      return;
    }
    mediumTap();
    onConfirm();
  }, [canConfirm, onConfirm]);

  const previewLine = hasFireAt
    ? `This delivers “${contentTitle}” to ${audienceCount} ${audienceLabel} on ${formatFireAt(
        fireAt as Date,
      )}.`
    : `This delivers “${contentTitle}” to ${audienceCount} ${audienceLabel}. Choose a date below.`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Text style={styles.topTitle}>Confirm push</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID="push-confirm-modal"
        >
          {/* Full preview copy (decision #10) — warm, not technical. */}
          <Text style={styles.previewLine} testID="push-confirm-preview">
            {previewLine}
          </Text>

          {!hasAudience ? (
            // Calm empty-state when no buyers match (audienceCount === 0).
            <Text style={styles.emptyState} testID="push-confirm-empty">
              No buyers match yet — there is no one to deliver this to right now.
            </Text>
          ) : null}

          {/* Date picker — error-prevention: minimumDate = today blocks past
              dates from being selectable at all (decision #6). */}
          <Text style={styles.label}>When should this go out?</Text>
          {Platform.OS === 'ios' ? (
            <View testID="push-confirm-date">
              <DateTimePicker
                value={fireAt ?? minimumDate}
                mode="date"
                display="inline"
                minimumDate={minimumDate}
                onChange={handlePickerChange}
                accessibilityLabel="Choose the date this push goes out"
              />
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.dateRow}
                onPress={() => setPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Choose the date this push goes out"
                testID="push-confirm-date"
              >
                <Text style={styles.dateRowText}>
                  {hasFireAt ? formatFireAt(fireAt as Date) : 'Pick a date'}
                </Text>
              </TouchableOpacity>
              {pickerOpen ? (
                <DateTimePicker
                  value={fireAt ?? minimumDate}
                  mode="date"
                  display="default"
                  minimumDate={minimumDate}
                  onChange={handlePickerChange}
                />
              ) : null}
            </>
          )}

          {/* Buyer-notify toggle (decision #9) — default ON, warm label. */}
          <View style={styles.notifyRow}>
            <View style={styles.notifyTextWrap}>
              <Text style={styles.notifyTitle}>Notify these buyers</Text>
              <Text style={styles.notifyHint}>
                Buyers get a notification when this goes out.
              </Text>
            </View>
            <Switch
              value={buyerNotify}
              onValueChange={onChangeBuyerNotify}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityRole="switch"
              accessibilityLabel="Notify these buyers"
              accessibilityState={{ checked: buyerNotify }}
              testID="push-confirm-notify"
            />
          </View>

          {/* Primary action — visually dominant (CALM / Hick's). */}
          <TouchableOpacity
            style={[styles.primaryBtn, !canConfirm && styles.primaryBtnDisabled]}
            onPress={handleConfirm}
            disabled={!canConfirm}
            accessibilityRole="button"
            accessibilityLabel="Confirm and schedule"
            accessibilityState={{ disabled: !canConfirm }}
            testID="push-confirm-submit"
          >
            {submitting ? (
              <ActivityIndicator color={colors.bgPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>Confirm &amp; schedule</Text>
            )}
          </TouchableOpacity>

          {/* Secondary action — de-emphasised. */}
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onCancel}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            testID="push-confirm-cancel"
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.bgPrimary },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 12,
    },
    topTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
    content: { paddingHorizontal: 24, paddingBottom: 60 },
    previewLine: {
      marginTop: 8,
      fontSize: 16,
      lineHeight: 24,
      color: colors.textPrimary,
    },
    emptyState: {
      marginTop: 12,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textMuted,
    },
    label: {
      marginTop: 24,
      marginBottom: 6,
      fontSize: 12,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      fontWeight: '500',
    },
    dateRow: {
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: colors.bgSurface,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dateRowText: { fontSize: 15, color: colors.textPrimary },
    notifyRow: {
      marginTop: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
    },
    notifyTextWrap: { flex: 1, paddingRight: 12 },
    notifyTitle: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    notifyHint: { marginTop: 2, fontSize: 12, color: colors.textMuted },
    primaryBtn: {
      marginTop: 28,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      paddingVertical: 14,
      borderRadius: 2,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: {
      color: colors.bgPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
    cancelBtn: {
      marginTop: 12,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    cancelBtnText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  });
