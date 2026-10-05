/**
 * S14 round 4b (Opus C-317-4) — confirm before disconnecting a source.
 *
 * Disconnect is destructive (new data stops reaching the coach), so it asks
 * first. Cancel is the default: it is listed first, styled as the primary
 * button, and closing the dialog any other way (back button, tapping
 * outside) cancels. A failed disconnect keeps the dialog open with coded
 * copy (see `disconnectCopy.ts`).
 */

import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WearableProvider } from '../../../api/wearablesConnectionsApi';
import { colors, radius, semantic, spacing, typography, withAlpha } from '../../../theme/tokens';
import { disconnectConfirmCopy } from './disconnectCopy';

export interface DisconnectConfirmDialogProps {
  provider: WearableProvider | null;
  name: string;
  visible: boolean;
  pending: boolean;
  /** Failure copy from the last attempt, shown inside the dialog. */
  errorText: string | null;
  /** Hide the Disconnect button when retrying here cannot help. */
  canRetry: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DisconnectConfirmDialog({
  provider,
  name,
  visible,
  pending,
  errorText,
  canRetry,
  onCancel,
  onConfirm,
}: DisconnectConfirmDialogProps) {
  if (provider == null) return null;
  const copy = disconnectConfirmCopy(provider, name);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        style={styles.backdrop}
        onPress={pending ? undefined : onCancel}
        accessibilityRole="button"
        accessibilityLabel={`Cancel, keep ${name} connected`}
      >
        <Pressable style={styles.card} accessibilityViewIsModal onPress={() => undefined}>
          <Text style={styles.title} accessibilityRole="header">
            {copy.title}
          </Text>
          <Text style={styles.body}>{copy.body}</Text>
          {errorText != null && (
            <Text style={styles.error} accessibilityRole="alert">
              {errorText}
            </Text>
          )}
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.cancel]}
              onPress={onCancel}
              disabled={pending}
              accessibilityRole="button"
              accessibilityLabel={`Cancel, keep ${name} connected`}
              testID="disconnect-cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            {canRetry && (
              <Pressable
                style={[styles.button, styles.destructive, pending && styles.disabled]}
                onPress={onConfirm}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel={`Disconnect ${name} now`}
                accessibilityState={{ disabled: pending }}
                testID="disconnect-confirm"
              >
                {pending ? (
                  <ActivityIndicator size="small" color={semantic.danger.fg} />
                ) : (
                  <Text style={styles.destructiveText}>Disconnect</Text>
                )}
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(colors.ink, 0.45),
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bone,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.h4,
    color: colors.ink,
  },
  body: {
    ...typography.bodyMd,
    color: colors.charcoal,
  },
  error: {
    ...typography.bodySmall,
    color: semantic.danger.fg,
    backgroundColor: semantic.danger.bg,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  button: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minWidth: 104,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    backgroundColor: colors.forest,
  },
  cancelText: {
    ...typography.bodySmall,
    color: colors.bone,
    fontWeight: '500',
  },
  destructive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: semantic.danger.border,
  },
  destructiveText: {
    ...typography.bodySmall,
    color: semantic.danger.fg,
    fontWeight: '500',
  },
  disabled: {
    opacity: 0.5,
  },
});
