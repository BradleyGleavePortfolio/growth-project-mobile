/**
 * SC-M2 (FX-871 PR 2, agent 170): the mic at the right of the space chat's composer (mockup VOICE-B 05b; the send arrow
 * takes its place while there is text). It opens m#848's record sheet (VoiceRecordSheet, FX-848: hold to record,
 * review, the microphone-off state) aimed at this space; Send hands the recording to the space's voice outbox.
 * FR-871: the first time (the server's voice-consent answer), the 08a card comes first (SpaceVoiceFirstUse); a tap
 * before the answer is in waits for it rather than opening either sheet. On iOS the record sheet opens once the card has
 * gone (its onDismiss): iOS shows one Modal at a time (FR-871R5, m#879 Opus C5).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceRecordSheet from '../VoiceRecordSheet';
import SpaceVoiceFirstUse, { useSpaceVoiceConsent } from './SpaceVoiceFirstUse';
import type { VoiceRecordingResult } from '../../../hooks/voiceRecorderPort';
import { forestPop as fp } from '../../../theme/tokens';

export interface SpaceChatMicProps {
  cohortName: string;
  /** The signed-in person: the first-use answer is kept per person. */
  userId: string;
  /** A coach's first-use card has no report line. */
  coach: boolean;
  onSend: (recording: VoiceRecordingResult) => void;
}

export default function SpaceChatMic({ cohortName, userId, coach, onSend }: SpaceChatMicProps): React.ReactElement {
  const consent = useSpaceVoiceConsent(userId);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(false);
  const [asked, setAsked] = useState(false);
  // The sheet mounts on the first tap (one Modal less per space chat), then stays so closing still slides.
  const [used, setUsed] = useState(false);
  const afterCard = useRef(false);
  const openSheet = () => { setUsed(true); setOpen(true); };
  useEffect(() => {
    if (!asked || !consent.known) return;
    setAsked(false);
    if (consent.needsCard) setCard(true);
    else { setUsed(true); setOpen(true); }
  }, [asked, consent.known, consent.needsCard]);
  return (
    <>
      <TouchableOpacity
        style={s.mic}
        onPress={() => setAsked(true)}
        accessibilityRole="button"
        accessibilityLabel="Record a voice note"
        testID="space-chat-mic"
      >
        <Ionicons name="mic-outline" size={24} color={fp.forest} />
      </TouchableOpacity>
      <SpaceVoiceFirstUse
        visible={card}
        cohortName={cohortName}
        coach={coach}
        onRecord={() => { consent.record(); setCard(false); if (Platform.OS === 'ios') afterCard.current = true; else openSheet(); }}
        onClose={() => setCard(false)}
        onDismiss={() => { if (afterCard.current) { afterCard.current = false; openSheet(); } }}
      />
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
