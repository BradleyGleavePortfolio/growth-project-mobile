/**
 * FX-871 (agent 169; Opus C5, Sol B7 on m#871): the space chat composer of mockup VOICE-B 05b. A pill field between two
 * 44 pt slots: the left slot is where SC-M4 adds "+" (photos), the right one is where SC-M2 adds the mic while the field
 * is empty; until then the left slot is empty and the right one shows Send only once there is text (no dead buttons),
 * and adding either control moves nothing. The text is this space's draft, kept on the device (owner chat-discard op 1);
 * Send hands it to the outbox, which keeps it until it is sent, so the field empties at once.
 */
import React from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChatDraft } from '../../../lib/chatDrafts';
import { colors, forestPop as fp, neutral, spacing, typography, voiceShades } from '../../../theme/tokens';
import { SPACE_MESSAGE_MAX } from './spaceChatApi';

export interface SpaceChatComposerProps {
  cohortId: string;
  onSend: (body: string) => void;
  /** SC-M4: the "+" control. */
  leading?: React.ReactNode;
  /** SC-M2: the mic, shown while the field is empty. */
  trailing?: React.ReactNode;
}

export default function SpaceChatComposer({ cohortId, onSend, leading, trailing }: SpaceChatComposerProps): React.ReactElement {
  const [text, setText] = useChatDraft(`space:${cohortId}`);
  const body = text.trim();
  return (
    <View style={[s.bar, leading ? null : s.noLead]} testID="space-chat-composer">
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
  bar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm,
    backgroundColor: colors.bone, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.sageLine,
  },
  noLead: { paddingLeft: spacing.lg },
  slot: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  field: {
    ...typography.body, flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: spacing.lg, paddingTop: 11, paddingBottom: 11,
    borderRadius: 22, borderWidth: 1, borderColor: voiceShades.track, backgroundColor: neutral[0], color: fp.ink,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: fp.forest },
});
