/**
 * VoiceReportedFold — GOAL B-06b: once the viewer reports a voice note, the note folds into a
 * dashed row with a flag mark ("You reported this voice note. It is hidden for you.", VN-07,
 * owner-approved 10-20 12:25). The player unmounts, so the audio is released and cannot be played.
 *
 * The reported ids live in voiceReportedStore (saved per signed-in account, dropped at sign-out), so
 * the Hall feed, the detail screen and Find fold the same note, and a restart keeps it folded.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { forestPop as fp, voiceFaces, voiceShades } from '../../theme/tokens';

export { markVoiceNoteReported, resetReportedVoiceNotes, useReportedVoiceNotes } from './voiceReportedStore';

export default function VoiceReportedFold({ testID }: { testID?: string }): React.ReactElement {
  return (
    <View style={styles.fold} accessible testID={testID}>
      <Ionicons name="flag-outline" size={16} color={fp.n700} />
      <Text style={styles.text}>You reported this voice note. It is hidden for you.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // GOAL .bfold: dashed 1 px track line, 16 corners, padding 12, 13/1.4 n700, gap 8.
  fold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: voiceShades.track,
    borderRadius: 16,
    padding: 12,
  },
  text: { flex: 1, fontFamily: voiceFaces.regular, fontSize: 13, lineHeight: 18, color: fp.n700 },
});
