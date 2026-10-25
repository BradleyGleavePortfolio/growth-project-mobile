/**
 * VoiceReportedFold — GOAL B-06b: once the viewer reports a voice note, the note folds into a
 * dashed row with a flag mark ("You reported this voice note. It is hidden for you.", VN-07,
 * owner-approved 10-20 12:25). The player unmounts, so the audio is released and cannot be played.
 *
 * The reported ids live for the app session in one shared set, so the Hall feed and the detail
 * screen fold the same note. A restart shows it again until the review removes it (the server is
 * the record; nothing about the report is saved on the phone).
 */
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { forestPop as fp, voiceFaces, voiceShades } from '../../theme/tokens';

const reported = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Folds the note away for this session (called once the report is sent). */
export function markVoiceNoteReported(id: string): void {
  if (reported.has(id)) return;
  reported.add(id);
  version += 1;
  listeners.forEach((fn) => fn());
}

/** Test seam: forget every reported note. */
export function resetReportedVoiceNotes(): void {
  reported.clear();
  version += 1;
  listeners.forEach((fn) => fn());
}

/** The set of notes this viewer reported in this session (re-renders when it changes). */
export function useReportedVoiceNotes(): ReadonlySet<string> {
  useSyncExternalStore(subscribe, () => version, () => version);
  return reported;
}

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
