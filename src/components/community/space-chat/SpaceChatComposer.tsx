/**
 * FX-871 (agent 169; Opus C5, Sol B7 on m#871): the space chat composer of mockup VOICE-B 05b. A pill field between two
 * 44 pt slots: the left slot is where SC-M4 adds "+" (photos), the right one is where SC-M2 adds the mic while the field
 * is empty; until then the left slot is empty and the right one shows Send only once there is text (no dead buttons),
 * and adding either control moves nothing. The text is this space's draft, kept on the device (owner chat-discard op 1);
 * Send hands it to the outbox, which keeps it until it is sent, so the field empties at once.
 * FR-871R6 (Sol B871-2): a text the server refused for its words (422 community.content.rejected) comes back into the
 * field to rephrase, with the thread's and the DMs' reason ("Please rephrase"), as soon as the field is empty: a newer
 * draft is never overwritten (the row keeps the text and the reason until then). Sent again it is a new message with
 * a new key; Try again on any other failure resends the same text with the same key.
 */
import React, { useEffect } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChatDraft } from '../../../lib/chatDrafts';
import { forestPop as fp, neutral, spacing, typography, voiceShades } from '../../../theme/tokens';
import { SPACE_MESSAGE_MAX } from './spaceChatApi';
import { REJECTED_WORDS, spaceOutbox, useSpaceOutbox } from './spaceChatOutbox';

export interface SpaceChatComposerProps {
  cohortId: string;
  onSend: (body: string) => void;
  /** SC-M4: the "+" control. */
  leading?: React.ReactNode;
  /** SC-M2: the mic, shown while the field is empty. */
  trailing?: React.ReactNode;
  /** FR-871R6 (m#879 Opus B1): the bottom safe area to keep clear while no tab bar is under the dock (0 otherwise). */
  bottomInset?: number;
}

export default function SpaceChatComposer({ cohortId, onSend, leading, trailing, bottomInset = 0 }: SpaceChatComposerProps): React.ReactElement {
  const [text, setText] = useChatDraft(`space:${cohortId}`);
  const body = text.trim();
  const rejected = useSpaceOutbox(cohortId).find((r) => r.state === 'failed' && r.reason === 'rejected');
  useEffect(() => {
    if (!rejected || text.trim() !== '') return;
    setText(rejected.body);
    spaceOutbox.discard(rejected.localId);
    Alert.alert(REJECTED_WORDS.title, REJECTED_WORDS.message);
  }, [rejected, text, setText]);
  return (
    <View style={[s.bar, leading ? null : s.noLead, bottomInset ? { paddingBottom: spacing.sm + bottomInset } : null]} testID="space-chat-composer">
      {leading ? <View style={s.slot}>{leading}</View> : null}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Type a message..."
        placeholderTextColor={fp.n700}
        maxLength={SPACE_MESSAGE_MAX}
        multiline
        accessibilityLabel="Type a message..."
        style={s.field}
        testID="space-chat-composer-field"
      />
      <View style={s.slot}>
        {body ? (
          <TouchableOpacity
            onPress={() => { onSend(body); setText(''); }}
            accessibilityRole="button" accessibilityLabel="Send" style={s.send} testID="space-chat-composer-send"
          >
            <Ionicons name="arrow-up" size={20} color={fp.onDeep} />
          </TouchableOpacity>
        ) : trailing}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // 05b .dock / .comp: a white dock (FR-871 Opus B1 a), 6 pt gaps, 8 10 8 6 padding, a 1 pt hairline; 15 pt text.
  bar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingLeft: 6, paddingRight: 10, paddingVertical: spacing.sm,
    backgroundColor: neutral[0], borderTopWidth: 1, borderTopColor: voiceShades.hairline,
  },
  noLead: { paddingLeft: spacing.lg },
  slot: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  field: {
    ...typography.body, fontSize: 15, lineHeight: 20, flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: spacing.lg, paddingTop: 11, paddingBottom: 11,
    borderRadius: 22, borderWidth: 1, borderColor: voiceShades.track, backgroundColor: neutral[0], color: fp.ink,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: fp.forest },
});
