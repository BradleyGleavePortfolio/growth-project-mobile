/**
 * ReportMessageSheet — Apple 1.2 abuse-reporting form for a single message.
 *
 * Modal sheet with a reason picker and an optional free-text "More details"
 * field. Submission delegates to the parent (which calls
 * messagesModerationApi.report) so the screen can update analytics +
 * blocked-state without coupling this presentational component to network
 * code.
 */
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { neutral, radius, voiceShades, type SemanticTokens } from '../../theme/tokens';
import {
  REPORT_REASON_OPTIONS,
  REPORT_EMERGENCY_NOTE,
  ReportReason,
  DETAILS_MAX,
  reportNeedsEmergencyNote,
} from '../../api/messagesApi';

export interface ReportMessageSheetProps {
  visible: boolean;
  messagePreview: string;
  onSubmit: (payload: { reason: ReportReason; details?: string }) => Promise<void>;
  onClose: () => void;
  /**
   * ROMAN-HOLD-M: bring the failure line into view and announce it (KT-11). Off by
   * default so the DM sheets (client and coach) are unchanged; see the PR's Found list.
   */
  revealError?: boolean;
  /** REFINE-950: 'roman' draws the parts this sheet shares with mobile-879-05 (the people's report sheet) as that
   *  frame draws them, for the Roman room only. The direct-message screens pass nothing and keep this sheet's look. */
  look?: 'roman';
}

export function ReportMessageSheet({
  visible,
  messagePreview,
  onSubmit,
  onClose,
  revealError = false,
  look,
}: ReportMessageSheetProps): React.ReactElement {
  const { colors, semanticColors, colorScheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const goal = useMemo(
    () => (look === 'roman' ? makeRomanStyles(colors, semanticColors, colorScheme !== 'dark') : null),
    [look, colors, semanticColors, colorScheme],
  );
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (revealError && error) scrollRef.current?.scrollToEnd({ animated: true });
  }, [revealError, error]);

  const reset = useCallback(() => {
    setReason(null);
    setDetails('');
    setError('');
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ reason, details: details.trim() ? details.trim() : undefined });
      reset();
    } catch {
      setError('Sending your report could not be confirmed. Check your connection, then try again.');
      setSubmitting(false);
    }
  }, [reason, submitting, details, onSubmit, reset]);

  const canSubmit = !!reason && !submitting;

  const heading = <Text style={goal ? goal.heading : styles.sectionLabel}>Why are you reporting this?</Text>;
  const rows = REPORT_REASON_OPTIONS.map((opt, i) => {
    const selected = reason === opt.value;
    return (
      <Pressable
        key={opt.value}
        onPress={() => setReason(opt.value)}
        style={({ pressed }) =>
          goal
            ? [styles.optionRow, goal.optionRow, i < REPORT_REASON_OPTIONS.length - 1 && goal.divider, pressed && styles.optionRowPressed]
            : [styles.optionRow, selected && styles.optionRowSelected, pressed && styles.optionRowPressed]
        }
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={opt.label}
      >
        <Text
          style={[styles.optionText, goal?.optionText, selected && styles.optionTextSelected]}
        >
          {opt.label}
        </Text>
        {selected ? (
          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
        ) : (
          <View style={styles.radioStub} />
        )}
      </Pressable>
    );
  });
  const note = reportNeedsEmergencyNote(reason) ? (
    <Text style={goal ? goal.emergency : styles.emergency} accessibilityRole="alert" testID="report-emergency-note">
      {REPORT_EMERGENCY_NOTE}
    </Text>
  ) : null;
  // mobile-879-05: the heading, the rows touching (a hairline between) and the note sit together.
  const reasons = goal ? (
    <View style={goal.reasons} testID="report-sheet-reasons">{heading}{rows}{note}</View>
  ) : (
    <>{heading}{rows}{note}</>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={goal ? [styles.container, goal.container] : styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Close report sheet"
          >
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Report Message</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.lede}>
            Reports are reviewed by the safety team within 24 hours. The user will not be told who
            reported them.
          </Text>

          <View style={goal ? [styles.previewWrap, goal.previewWrap] : styles.previewWrap}>
            <Text style={styles.previewLabel}>Message</Text>
            <Text style={styles.previewBody} numberOfLines={4}>
              {messagePreview}
            </Text>
          </View>

          {reasons}

          <Text style={styles.sectionLabel}>More details (optional)</Text>
          <TextInput
            style={styles.detailsInput}
            multiline
            maxLength={DETAILS_MAX}
            value={details}
            onChangeText={setDetails}
            placeholder="Add anything the safety team should know."
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Additional details"
          />
          <Text style={styles.counter}>
            {details.length}/{DETAILS_MAX}
          </Text>

          {error ? (
            <Text
              style={styles.errorText}
              accessibilityRole={revealError ? 'alert' : undefined}
              accessibilityLiveRegion={revealError ? 'polite' : undefined}
              testID="report-sheet-error"
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submitBtn,
              !canSubmit && styles.submitBtnDisabled,
              pressed && canSubmit && styles.submitBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Submit report"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.submitText}>Submit Report</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    content: { padding: 20, gap: 12 },
    lede: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
    emergency: { fontSize: 13, color: colors.textPrimary, lineHeight: 18, fontWeight: '600' },

    previewWrap: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    previewLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
    previewBody: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },

    sectionLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
      marginTop: 8,
    },

    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    optionRowSelected: { borderColor: colors.primary },
    optionRowPressed: { opacity: 0.85 },
    optionText: { fontSize: 14, color: colors.textPrimary },
    optionTextSelected: { color: colors.primary, fontWeight: '600' },
    radioStub: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.border,
    },

    detailsInput: {
      minHeight: 100,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 12,
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      textAlignVertical: 'top',
    },
    counter: { fontSize: 11, color: colors.textMuted, alignSelf: 'flex-end' },
    errorText: { color: colors.error, fontSize: 13, marginTop: 8 },

    footer: {
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    submitBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    submitBtnDisabled: { backgroundColor: colors.border },
    submitBtnPressed: { opacity: 0.9 },
    submitText: { color: colors.textOnPrimary, fontSize: 15, fontWeight: '600' },
  });

/**
 * REFINE-950: the parts this sheet shares with mobile-879-05, as that frame draws them (2x rows read in
 * RomanRefine950.test.tsx); the values are the community report sheet's (SafetyMenu, the same frame): a white
 * sheet, the message card white with a hairline and 16 pt corners, the heading 600 18/23, rows 48 pt with a
 * hairline between them and 16/21 words, the emergency note in the leaf-wash box.
 */
const makeRomanStyles = (colors: ThemeColors, sc: SemanticTokens, light: boolean) => {
  const sheet = light ? neutral[0] : sc.bgSurface;
  const line = light ? voiceShades.hairline : sc.border;
  return StyleSheet.create({
    container: { backgroundColor: sheet },
    previewWrap: { backgroundColor: sheet, borderColor: line, borderRadius: radius.card, paddingVertical: 8, paddingHorizontal: 12 },
    heading: { fontSize: 18, lineHeight: 23, fontWeight: '600', color: colors.textPrimary, marginBottom: 6 },
    reasons: { gap: 0 },
    optionRow: {
      minHeight: 48, paddingVertical: 6, paddingHorizontal: 0, borderRadius: 0, borderWidth: 0, borderBottomWidth: 0,
      backgroundColor: 'transparent', gap: 12,
    },
    divider: { borderBottomWidth: 1, borderBottomColor: line },
    optionText: { flex: 1, fontSize: 16, lineHeight: 21, color: colors.textPrimary },
    emergency: {
      overflow: 'hidden', borderWidth: 1, borderRadius: radius.card, paddingVertical: 12, paddingHorizontal: 14, marginTop: 10,
      fontSize: 14, lineHeight: 20, color: colors.textPrimary,
      backgroundColor: light ? voiceShades.leafWash : sc.bgSurface, borderColor: light ? voiceShades.washEdge : sc.border,
    },
  });
};

export default ReportMessageSheet;
