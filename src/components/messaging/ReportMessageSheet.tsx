/**
 * ReportMessageSheet — Apple 1.2 abuse-reporting form for a single message.
 *
 * Modal sheet with a reason picker and an optional free-text "More details"
 * field. Submission delegates to the parent (which calls
 * messagesModerationApi.report) so the screen can update analytics +
 * blocked-state without coupling this presentational component to network
 * code.
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Modal, View, Text, Pressable, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { REPORT_REASON_OPTIONS, ReportReason } from '../../api/messagesApi';

export interface ReportMessageSheetProps {
  visible: boolean;
  messagePreview: string;
  onSubmit: (payload: { reason: ReportReason; details?: string }) => Promise<void>;
  onClose: () => void;
}

const DETAILS_MAX = 500;

export function ReportMessageSheet({
  visible,
  messagePreview,
  onSubmit,
  onClose,
}: ReportMessageSheetProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

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
      setError("We couldn't submit that report. Please try again.");
      setSubmitting(false);
    }
  }, [reason, submitting, details, onSubmit, reset]);

  const canSubmit = !!reason && !submitting;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
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

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.lede}>
            Reports are reviewed by our team within 24 hours. The user will not be told who
            reported them.
          </Text>

          <View style={styles.previewWrap}>
            <Text style={styles.previewLabel}>Message</Text>
            <Text style={styles.previewBody} numberOfLines={4}>
              {messagePreview}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Why are you reporting this?</Text>
          {REPORT_REASON_OPTIONS.map((opt) => {
            const selected = reason === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setReason(opt.value)}
                style={({ pressed }) => [
                  styles.optionRow,
                  selected && styles.optionRowSelected,
                  pressed && styles.optionRowPressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={opt.label}
              >
                <Text
                  style={[styles.optionText, selected && styles.optionTextSelected]}
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
          })}

          <Text style={styles.sectionLabel}>More details (optional)</Text>
          <TextInput
            style={styles.detailsInput}
            multiline
            maxLength={DETAILS_MAX}
            value={details}
            onChangeText={setDetails}
            placeholder="Add anything our team should know."
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Additional details"
          />
          <Text style={styles.counter}>
            {details.length}/{DETAILS_MAX}
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
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

export default ReportMessageSheet;
