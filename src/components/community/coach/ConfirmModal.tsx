/**
 * ConfirmModal — the single confirmation surface for every DESTRUCTIVE coach
 * action in v1-6 (remove member, hide post, hide message). The hard gate
 * (§2.3 / AGENT_RULES) forbids one-tap destructive actions, so every such
 * action routes through this modal: a coach must confirm before the mutation
 * fires.
 *
 * Behaviour:
 *   - When `visible`, renders a scrim + a centered card with a title, an
 *     optional body, a cancel button, and a destructive confirm button.
 *   - The confirm button is `disabled` while a mutation is in flight
 *     (`busy`) so a double-tap cannot fire two deletes.
 *   - Both buttons clear a >= 44pt touch target.
 *   - Colours come from semanticColors; the confirm uses the `accent`
 *     (oxblood) fill which is the palette's destructive/primary tone.
 */
import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../../HapticPressable';
import { useTheme } from '../../../theme/useTheme';
import { spacing, radius, withAlpha } from '../../../theme/tokens';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Label for the destructive confirm button (e.g. "Remove", "Hide"). */
  confirmLabel: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** True while the confirmed mutation is in flight; disables confirm. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export default function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmModalProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID={testID}
    >
      <View
        style={[
          styles.scrim,
          { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
        ]}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
            },
          ]}
        >
          <Text style={[styles.title, { color: semanticColors.textPrimary }]}>
            {title}
          </Text>
          {body ? (
            <Text style={[styles.body, { color: semanticColors.textMuted }]}>
              {body}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <HapticPressable
              intent="light"
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              testID={testID ? `${testID}-cancel` : 'confirm-cancel'}
              style={[
                styles.button,
                styles.cancel,
                { borderColor: semanticColors.border },
              ]}
            >
              <Text
                style={[styles.cancelLabel, { color: semanticColors.textPrimary }]}
              >
                {cancelLabel}
              </Text>
            </HapticPressable>
            <HapticPressable
              intent="warning"
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: busy }}
              testID={testID ? `${testID}-confirm` : 'confirm-confirm'}
              style={[
                styles.button,
                {
                  backgroundColor: busy
                    ? semanticColors.disabledBg
                    : semanticColors.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.confirmLabel,
                  {
                    color: busy
                      ? semanticColors.textOnDisabled
                      : semanticColors.textOnAccent,
                  },
                ]}
              >
                {confirmLabel}
              </Text>
            </HapticPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  button: {
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  cancel: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
