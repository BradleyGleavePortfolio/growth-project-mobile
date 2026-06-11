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
 *
 * Confirm-button colour follows `variant` (UX-03 fix):
 *   - `destructive` (DEFAULT) — the confirm reads as a real delete. It uses the
 *     dedicated `semantic.danger` tokens (deep-oxblood text on a soft danger
 *     fill with a danger border), matching the Moderation row "Hide" treatment.
 *     The previous `semanticColors.accent` fill was the brand/constructive tone
 *     and read as a safe primary action on a destructive confirm — the exact
 *     mismatch this fix removes.
 *   - `constructive` — a non-destructive confirm (e.g. an affirmative "Save"
 *     style). Keeps the brand `accent` fill with on-accent text.
 */
import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../../HapticPressable';
import { useTheme } from '../../../theme/useTheme';
import { spacing, radius, withAlpha, semantic } from '../../../theme/tokens';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Label for the destructive confirm button (e.g. "Remove", "Hide"). */
  confirmLabel: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Confirm-button treatment. `destructive` (default) renders the danger
   * tokens so a delete never wears the brand/constructive accent;
   * `constructive` keeps the brand accent for an affirmative confirm.
   */
  variant?: 'destructive' | 'constructive';
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
  variant = 'destructive',
  busy = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmModalProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const isDestructive = variant === 'destructive';
  // Resting (non-busy) confirm colours by variant. Destructive uses the
  // dedicated danger tokens; constructive keeps the brand accent.
  const confirmBg = isDestructive
    ? semantic.danger.bg
    : semanticColors.accent;
  const confirmFg = isDestructive
    ? semantic.danger.fg
    : semanticColors.textOnAccent;
  const confirmBorderColor = isDestructive
    ? semantic.danger.border
    : 'transparent';
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
              intent={isDestructive ? 'warning' : 'medium'}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: busy }}
              testID={testID ? `${testID}-confirm` : 'confirm-confirm'}
              style={[
                styles.button,
                {
                  backgroundColor: busy ? semanticColors.disabledBg : confirmBg,
                  borderColor: busy ? 'transparent' : confirmBorderColor,
                  borderWidth: busy || !isDestructive ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text
                style={[
                  styles.confirmLabel,
                  {
                    color: busy ? semanticColors.textOnDisabled : confirmFg,
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
