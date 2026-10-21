/**
 * VoiceRecordSheet — Style B: the record sheet over the voice notes feed. The
 * scrim does not close it (a stray tap never loses a recording); Cancel, Not
 * now, Delete or Android back do. Closing unmounts the composer (mic freed).
 */
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { forestPop as fp, lightTokens, radius, spacing } from '../../theme/tokens';
import VoiceNoteComposer, { type VoiceNoteComposerProps } from './VoiceNoteComposer';

export interface VoiceRecordSheetProps extends VoiceNoteComposerProps {
  visible: boolean;
}

export default function VoiceRecordSheet({
  visible,
  onClose,
  ...composer
}: VoiceRecordSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          accessibilityViewIsModal
          testID="voice-record-sheet"
        >
          <View style={styles.handle} />
          {visible ? <VoiceNoteComposer {...composer} onClose={onClose} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: lightTokens.overlay },
  sheet: {
    backgroundColor: fp.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.chip,
    backgroundColor: fp.sageLine,
  },
});
