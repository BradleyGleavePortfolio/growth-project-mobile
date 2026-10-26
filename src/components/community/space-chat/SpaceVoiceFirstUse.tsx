/**
 * FR-871 (m#879 Sol B1 / Opus B2; operator ruling agent 173, undo = drop this file and its use in SpaceChatMic): the
 * 08a first-use card before the space chat's first recording, ported from m#858 (op166/voice-m-2: useVoiceConsent and
 * VoiceNoteComposer's card). The answer is the server's (GET community/voice-consent), kept per signed-in person.
 * `seen: false`, or no answer at all, shows the card; Record stores it (POST) and opens the record sheet, where the
 * phone asks for the microphone; Not now closes it with no phone ask (design training 5.5 anti-pattern 1). A coach's
 * card leaves out the report line (VN-C1, needs owner). Metrics are 08a's CSS (.sheet, .bpts, .bico, .btn).
 */
import React, { useCallback, useContext } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { describeVoiceAudience } from '../VoicePrivacyCopy';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { forestPop as fp, neutral, voiceShades } from '../../../theme/tokens';
import { spaceChatApi, type VoiceConsent } from './spaceChatApi';

export const voiceConsentKey = (userId: string) => ['community', 'space-chat', 'voice-consent', userId] as const;

/** `known` is false until the server has answered (or failed); the mic waits for it. */
export function useSpaceVoiceConsent(userId: string): { known: boolean; needsCard: boolean; record: () => void } {
  const qc = useQueryClient();
  const q = useQuery<VoiceConsent>({
    queryKey: voiceConsentKey(userId),
    queryFn: () => spaceChatApi.getVoiceConsent(),
    retry: false,
    staleTime: Infinity,
  });
  const record = useCallback(() => {
    qc.setQueryData<VoiceConsent>(voiceConsentKey(userId), { seen: true, seen_at: new Date().toISOString() });
    // A failed write only means the card shows once more next time.
    void spaceChatApi.recordVoiceConsent().catch(() => undefined);
  }, [qc, userId]);
  return { known: !q.isLoading, needsCard: q.data?.seen !== true, record };
}

export interface SpaceVoiceFirstUseProps {
  visible: boolean;
  cohortName: string;
  coach: boolean;
  onRecord: () => void;
  onClose: () => void;
  /** iOS: the card has finished closing. */
  onDismiss?: () => void;
}

type Icon = React.ComponentProps<typeof Ionicons>['name'];

export default function SpaceVoiceFirstUse({ visible, cohortName, coach, onRecord, onClose, onDismiss }: SpaceVoiceFirstUseProps): React.ReactElement {
  // As Screen (src/ui) does: read the context, so a tree with no provider gets 0, not a throw.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const lines: [Icon, string][] = [
    ['lock-closed-outline', describeVoiceAudience({ kind: 'cohort', cohortName })],
    ['flag-outline', 'If someone reports a voice note, your coach and the TGP Fitness team can listen to it.'],
    ['trash-outline', 'You can delete your voice note at any time.'],
  ];
  if (coach) lines.splice(1, 1);
  return (
    <Modal visible={visible} transparent animationType={useReducedMotion() ? 'none' : 'slide'} onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={s.scrim}>
        <View style={[s.sheet, { paddingBottom: Math.max(bottomInset, 12) }]} accessibilityViewIsModal testID="space-chat-voice-first-use">
          <View style={s.grab} />
          <Text style={s.title} accessibilityRole="header">Voice notes</Text>
          <View style={s.points}>
            {lines.map(([icon, line]) => (
              <View key={icon} style={s.point}>
                <View style={s.wash}><Ionicons name={icon} size={20} color={fp.forest} /></View>
                <Text style={s.text}>{line}</Text>
              </View>
            ))}
          </View>
          <View style={s.buttons}>
            <TouchableOpacity onPress={onRecord} accessibilityRole="button" accessibilityLabel="Record" style={s.record} testID="space-chat-voice-first-use-record">
              <Ionicons name="mic-outline" size={20} color={fp.onDeep} />
              <Text style={[s.label, { color: fp.onDeep }]}>Record</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Not now" style={s.quiet} testID="space-chat-voice-first-use-not-now">
              <Text style={[s.label, { color: fp.forest }]}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: voiceShades.scrim },
  sheet: { backgroundColor: neutral[0], borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 20 },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: voiceShades.track, marginBottom: 10 },
  title: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 22, lineHeight: 29, color: fp.ink, marginTop: 8, marginBottom: 6 },
  points: { gap: 12, marginTop: 10, marginBottom: 6 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wash: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: voiceShades.leafWash, borderWidth: 1, borderColor: voiceShades.washEdge },
  text: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: fp.ink },
  // GOAL 08a .btn { flex: 1 1 130px } in a column: Record and Not now are 130 pt each (FR-871R5, m#879 Sol B3).
  buttons: { gap: 10, marginTop: 14, marginBottom: 10 },
  record: { minHeight: 130, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: fp.forest },
  quiet: { minHeight: 130, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  label: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 20 },
});
