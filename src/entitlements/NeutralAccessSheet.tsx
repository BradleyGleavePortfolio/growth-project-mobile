/**
 * NeutralAccessSheet — modal wrapper around NeutralAccessState. Replaces
 * PaywallSheet when `clientPurchasesHidden()` (iOS v1, App Review 3.1).
 */
import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import NeutralAccessState from './NeutralAccessState';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAttached?: () => void | Promise<unknown>;
}

export default function NeutralAccessSheet({ visible, onClose, onAttached }: Props) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]} testID="neutral-access-sheet">
        <TouchableOpacity
          onPress={onClose}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID="neutral-access-close"
        >
          <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Close</Text>
        </TouchableOpacity>
        <NeutralAccessState onAttached={onAttached} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  close: { alignSelf: 'flex-end', padding: 16, minHeight: 44, justifyContent: 'center' },
});
