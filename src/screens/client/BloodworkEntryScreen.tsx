/**
 * BloodworkEntryScreen — client-facing manual entry of lab results.
 *
 * v1 contract:
 *   - manual entry only (no OCR, no EHR import, no provider connect)
 *   - feature-flagged OFF by default; renders a bland fail-closed state
 *     when the flag is OFF
 *   - disclaimer acknowledgement is REQUIRED on first view, stored via
 *     expo-secure-store keyed by user id; the screen is not accessible
 *     until the user taps "I understand"
 *   - empty state explains the manual flow honestly; no "coming soon"
 *   - never displays AI-drafted insights unless the panel is in
 *     `coach_reviewed` state AND the AI draft is `approved`
 *   - long-form disclaimer is rendered unconditionally after acknowledgement
 *   - all numeric values displayed with units (mg/dL, mmol/L, etc.)
 *   - bloodwork values NEVER appear on leaderboard, share surfaces, or
 *     coach views without explicit client-granted permission
 *
 * Backend hookup is intentionally absent. The submit handler is a stub
 * that just clears the local form — the server-side surface is tracked
 * in docs/BLOODWORK_HANDOFF.md.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HapticPressable from '../../components/HapticPressable';
import EmptyState from '../../components/EmptyState';
import BloodworkDisclaimerModal from '../../components/BloodworkDisclaimerModal';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { isFeatureEnabled } from '../../config/featureFlags';
import { hasAcknowledgedDisclaimer } from '../../lib/bloodworkDisclaimerHelper';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  BLOODWORK_DISCLAIMER_LONG,
  BLOODWORK_DISCLAIMER_SHORT,
  BLOODWORK_CLIENT_EMPTY_TITLE,
  BLOODWORK_CLIENT_EMPTY_BODY,
  BLOODWORK_FEATURE_OFF_TITLE,
  BLOODWORK_FEATURE_OFF_BODY,
  BLOODWORK_FORM_LABELS,
  BLOODWORK_LOADING_DISCLAIMER_CHECK,
} from '../../constants/bloodworkCopy';
import {
  BloodworkPanelDraftInput,
  BloodworkReferenceRange,
} from '../../types/bloodwork';

interface MarkerRow {
  name: string;
  value: string;
  unit: string;
  refLow: string;
  refHigh: string;
}

const EMPTY_MARKER: MarkerRow = {
  name: '',
  value: '',
  unit: '',
  refLow: '',
  refHigh: '',
};

function buildDraftInput(
  panelLabel: string,
  collectionDate: string,
  labName: string,
  sourceNotes: string,
  markers: MarkerRow[],
): BloodworkPanelDraftInput {
  return {
    label: panelLabel.trim() || undefined,
    collectionDate: collectionDate.trim() || undefined,
    labName: labName.trim() || undefined,
    sourceNotes: sourceNotes.trim() || undefined,
    markers: markers
      .filter((m) => m.name.trim().length > 0)
      .map((m) => {
        const numericValue = m.value.trim().length ? Number(m.value) : undefined;
        const refRange: BloodworkReferenceRange | undefined =
          m.refLow.trim() || m.refHigh.trim()
            ? {
                low: m.refLow.trim() ? Number(m.refLow) : undefined,
                high: m.refHigh.trim() ? Number(m.refHigh) : undefined,
                unit: m.unit.trim(),
              }
            : undefined;
        return {
          name: m.name.trim(),
          value: Number.isFinite(numericValue) ? numericValue : undefined,
          valueText: !Number.isFinite(numericValue) && m.value.trim() ? m.value.trim() : undefined,
          unit: m.unit.trim() || undefined,
          referenceRange: refRange,
        };
      }),
  };
}

export default function BloodworkEntryScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const enabled = isFeatureEnabled('bloodwork');
  const currentUser = useCurrentUser();

  // Disclaimer gate state.
  // 'loading' = checking SecureStore, 'required' = modal shown, 'acknowledged' = proceed
  const [disclaimerState, setDisclaimerState] = useState<'loading' | 'required' | 'acknowledged'>('loading');

  const [panelLabel, setPanelLabel] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [labName, setLabName] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [markers, setMarkers] = useState<MarkerRow[]>([{ ...EMPTY_MARKER }]);

  // On mount, check whether the user has already acknowledged the disclaimer.
  // Fail-closed: if user is not loaded yet, stay in 'loading'.
  useEffect(() => {
    if (!enabled) return;
    if (!currentUser?.id) return;
    let cancelled = false;
    hasAcknowledgedDisclaimer(currentUser.id).then((acked) => {
      if (cancelled) return;
      setDisclaimerState(acked ? 'acknowledged' : 'required');
    });
    return () => { cancelled = true; };
  }, [enabled, currentUser?.id]);

  const handleDisclaimerAcknowledged = useCallback(() => {
    setDisclaimerState('acknowledged');
  }, []);

  // Feature off — fail-closed.
  if (!enabled) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState
          icon="flask-outline"
          title={BLOODWORK_FEATURE_OFF_TITLE}
          subtitle={BLOODWORK_FEATURE_OFF_BODY}
        />
      </SafeAreaView>
    );
  }

  // Loading SecureStore check — show neutral loader, not data.
  if (disclaimerState === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>{BLOODWORK_LOADING_DISCLAIMER_CHECK}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Disclaimer required — modal is shown; render nothing behind it.
  if (disclaimerState === 'required') {
    return (
      <SafeAreaView style={styles.safe}>
        <BloodworkDisclaimerModal
          visible
          userId={currentUser?.id ?? 'anonymous'}
          onAcknowledged={handleDisclaimerAcknowledged}
        />
      </SafeAreaView>
    );
  }

  // Acknowledged — full screen.

  const updateMarker = (index: number, patch: Partial<MarkerRow>) => {
    setMarkers((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const addMarker = () => setMarkers((prev) => [...prev, { ...EMPTY_MARKER }]);

  const removeMarker = (index: number) =>
    setMarkers((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const onSubmit = () => {
    const draft = buildDraftInput(panelLabel, collectionDate, labName, sourceNotes, markers);
    if (draft.markers.length === 0) {
      Alert.alert('Add at least one marker', 'Enter the marker name and value before submitting.');
      return;
    }
    // Backend not wired. Surface the contract that submission is what gets
    // the panel into coach review.
    Alert.alert(
      'Submitted to coach',
      'When the backend ships, this will create a panel and notify your coach for review.',
    );
    setPanelLabel('');
    setCollectionDate('');
    setLabName('');
    setSourceNotes('');
    setMarkers([{ ...EMPTY_MARKER }]);
  };

  const hasAnyInput =
    panelLabel.trim() ||
    collectionDate.trim() ||
    labName.trim() ||
    sourceNotes.trim() ||
    markers.some((m) => m.name.trim() || m.value.trim());

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.disclaimerCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.disclaimerLong}>{BLOODWORK_DISCLAIMER_LONG}</Text>
        </View>

        <Text style={styles.h1}>Lab results</Text>
        <Text style={styles.shortDisclaimer}>{BLOODWORK_DISCLAIMER_SHORT}</Text>

        {!hasAnyInput ? (
          <EmptyState
            icon="document-text-outline"
            title={BLOODWORK_CLIENT_EMPTY_TITLE}
            subtitle={BLOODWORK_CLIENT_EMPTY_BODY}
          />
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Panel</Text>
          <Text style={styles.helperNote}>{BLOODWORK_FORM_LABELS.manualEntryNote}</Text>

          <Field
            label={BLOODWORK_FORM_LABELS.panelLabel}
            hint={BLOODWORK_FORM_LABELS.panelLabelHint}
            value={panelLabel}
            onChangeText={setPanelLabel}
            colors={colors}
          />
          <Field
            label={BLOODWORK_FORM_LABELS.collectionDate}
            hint="YYYY-MM-DD"
            value={collectionDate}
            onChangeText={setCollectionDate}
            colors={colors}
          />
          <Field
            label={BLOODWORK_FORM_LABELS.labName}
            hint={BLOODWORK_FORM_LABELS.labNameHint}
            value={labName}
            onChangeText={setLabName}
            colors={colors}
          />
          <Field
            label={BLOODWORK_FORM_LABELS.sourceNotes}
            value={sourceNotes}
            onChangeText={setSourceNotes}
            colors={colors}
            multiline
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Markers</Text>
          {markers.map((m, idx) => (
            <View key={idx} style={styles.markerCard}>
              <View style={styles.markerHeader}>
                <Text style={styles.markerHeaderText}>Marker #{idx + 1}</Text>
                {markers.length > 1 ? (
                  <HapticPressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove marker ${idx + 1}`}
                    onPress={() => removeMarker(idx)}
                    style={styles.removeBtn}
                  >
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </HapticPressable>
                ) : null}
              </View>
              <Field
                label={BLOODWORK_FORM_LABELS.markerName}
                hint={BLOODWORK_FORM_LABELS.markerNameHint}
                value={m.name}
                onChangeText={(v) => updateMarker(idx, { name: v })}
                colors={colors}
              />
              <View style={styles.row}>
                <View style={styles.col}>
                  <Field
                    label={BLOODWORK_FORM_LABELS.markerValue}
                    value={m.value}
                    onChangeText={(v) => updateMarker(idx, { value: v })}
                    colors={colors}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.col}>
                  <Field
                    label={BLOODWORK_FORM_LABELS.markerUnit}
                    value={m.unit}
                    onChangeText={(v) => updateMarker(idx, { unit: v })}
                    colors={colors}
                  />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.col}>
                  <Field
                    label={BLOODWORK_FORM_LABELS.referenceLow}
                    value={m.refLow}
                    onChangeText={(v) => updateMarker(idx, { refLow: v })}
                    colors={colors}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.col}>
                  <Field
                    label={BLOODWORK_FORM_LABELS.referenceHigh}
                    value={m.refHigh}
                    onChangeText={(v) => updateMarker(idx, { refHigh: v })}
                    colors={colors}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          ))}

          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel="Add another marker"
            onPress={addMarker}
            style={styles.addRow}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.addRowText}>Add another marker</Text>
          </HapticPressable>
        </View>

        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel={BLOODWORK_FORM_LABELS.submitForReview}
          onPress={onSubmit}
          style={styles.submitBtn}
        >
          <Text style={styles.submitBtnText}>{BLOODWORK_FORM_LABELS.submitForReview}</Text>
        </HapticPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ThemeColors;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'numeric';
}

function Field({ label, hint, value, onChangeText, colors, multiline, keyboardType }: FieldProps) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <TextInput
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        value={value}
        onChangeText={onChangeText}
        multiline={!!multiline}
        keyboardType={keyboardType ?? 'default'}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 16, paddingBottom: 48 },
    loadingCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
      color: colors.textMuted,
    },
    disclaimerCard: {
      flexDirection: 'row',
      gap: 8,
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: 16,
    },
    disclaimerLong: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    h1: {
      fontSize: 24,
      fontWeight: '500',
      color: colors.textPrimary,
      marginTop: 4,
    },
    shortDisclaimer: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 4,
      marginBottom: 16,
    },
    section: {
      marginTop: 16,
      padding: 14,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    helperNote: {
      fontSize: 12,
      color: colors.textMuted,
      marginBottom: 12,
    },
    field: { marginBottom: 12 },
    fieldLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    fieldHint: {
      fontSize: 11,
      color: colors.textMuted,
      marginBottom: 4,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
    inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
    row: { flexDirection: 'row', gap: 8 },
    col: { flex: 1 },
    markerCard: {
      padding: 10,
      marginBottom: 10,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.background,
    },
    markerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    markerHeaderText: {
      fontSize: 12,
      color: colors.textMuted,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    removeBtn: { padding: 4 },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    addRowText: { fontSize: 14, color: colors.textSecondary },
    submitBtn: {
      marginTop: 24,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
    },
    submitBtnText: {
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
  });
}

// Exported for tests.
export { buildDraftInput };
