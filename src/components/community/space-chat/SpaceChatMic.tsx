/**
 * SC-M2 (FX-871 PR 2, agent 170): the mic at the right of the space chat's composer (mockup VOICE-B 05b; the send arrow
 * takes its place while there is text). It opens m#848's record sheet (VoiceRecordSheet, FX-848: hold to record,
 * review, the microphone-off state) aimed at this space; Send hands the recording to the space's voice outbox.
 * FIX-944R3 (owner #ALM-E11, answering #ALM-D2): no first-use card, ever. A tap opens the record sheet at once, for a
 * member and for the coach, and the phone asks the server nothing first; the sheet asks for the microphone as it opens.
 * LO-944R2 B1 = LS-944R2 B1 (FIX-944R2): the keyboard is put away as the tap opens the sheet, never over its foot.
 */
import React, { useState } from 'react';
import { Keyboard, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceRecordSheet from '../VoiceRecordSheet';
import type { VoiceRecordingResult } from '../../../hooks/voiceRecorderPort';
import { forestPop as fp } from '../../../theme/tokens';

export interface SpaceChatMicProps {
  cohortName: string;
  /** The signed-in person. Unused since FIX-944R3 (it keyed the first-use answer); kept so part 4's call stands. */
  userId: string;
  /** A coach. Unused since FIX-944R3 (the coach's first-use card); kept so part 4's call stands. */
  coach: boolean;
  onSend: (recording: VoiceRecordingResult) => void;
}

export default function SpaceChatMic({ cohortName, onSend }: SpaceChatMicProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // The sheet mounts on the first tap (one Modal less per space chat), then stays so closing still slides.
  const [used, setUsed] = useState(false);
  const openSheet = () => { Keyboard.dismiss(); setUsed(true); setOpen(true); };
  return (
    <>
      <TouchableOpacity
        style={s.mic}
        onPress={openSheet}
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
