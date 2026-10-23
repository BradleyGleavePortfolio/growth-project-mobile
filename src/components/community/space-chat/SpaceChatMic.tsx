/**
 * SC-M2 (FX-871 PR 2, agent 170): the mic at the right of the space chat's composer (mockup VOICE-B 05b; the send arrow
 * takes its place while there is text). It opens m#848's record sheet (VoiceRecordSheet, FX-848: hold to record,
 * review, the microphone-off state) aimed at this space; Send hands the recording to the space's voice outbox.
 */
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceRecordSheet from '../VoiceRecordSheet';
import type { VoiceRecordingResult } from '../../../hooks/voiceRecorderPort';
import { forestPop as fp } from '../../../theme/tokens';

export interface SpaceChatMicProps {
  cohortName: string;
  onSend: (recording: VoiceRecordingResult) => void;
}

export default function SpaceChatMic({ cohortName, onSend }: SpaceChatMicProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // The sheet mounts on the first tap (one Modal less per space chat), then stays so closing still slides.
  const [used, setUsed] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={s.mic}
        onPress={() => { setUsed(true); setOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel="Record a voice note"
        testID="space-chat-mic"
      >
        <Ionicons name="mic-outline" size={24} color={fp.forest} />
      </TouchableOpacity>
      {used ? (
        <VoiceRecordSheet
          visible={open}
          target={{ kind: 'cohort', cohortName }}
          onClose={() => setOpen(false)}
          onSend={(recording) => { setOpen(false); onSend(recording); }}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  mic: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
