/**
 * CopilotComposer: the "Your path" composer (style A, owner #162-1; GOAL frames 02-05, Opus B-G3, Sol B-851-G2).
 * A white field with the cool hairline and, beside it, a separate pale leaf square with an up arrow. The disclaimer
 * sits in the page above it, not under the field. Same contract as main's RomanComposer, which is left as it is:
 * the parent owns the draft (a failed send keeps the words), Send stays off while empty, too long or sending, and the
 * field grows with its text up to a share of the window before it scrolls.
 */
import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { ROMAN_MESSAGE_MAX_LENGTH } from '../../api/romanApi';
import { forestPop, pathTint, radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { ROMAN_COMPOSER_PLACEHOLDER } from '../roman/romanVoice';
import { ledger } from '../../screens/client/copilot/ledger';

const MIN_HEIGHT = 44;

export interface CopilotComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  testID?: string;
}

export default function CopilotComposer({ value, onChangeText, onSend, sending, testID }: CopilotComposerProps): React.ReactElement {
  const { semanticColors: c } = useTheme();
  const overCap = value.length > ROMAN_MESSAGE_MAX_LENGTH;
  const canSend = !sending && value.trim().length > 0 && !overCap;
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = Math.max(120, Math.round(windowHeight * 0.3));
  const [contentHeight, setContentHeight] = useState(MIN_HEIGHT);
  const height = Math.min(Math.max(MIN_HEIGHT, contentHeight), maxHeight);
  return (
    <View style={s.wrap} testID={testID}>
      {overCap ? (
        <Text style={[typography.bodySmall, { color: forestPop.error }]} accessibilityRole="text">
          {`Message is too long by ${value.length - ROMAN_MESSAGE_MAX_LENGTH} characters.`}
        </Text>
      ) : null}
      <View style={s.row}>
        <View style={[s.field, { backgroundColor: ledger.card, borderColor: ledger.line }]} testID="roman-composer-field">
          <TextInput
            style={[s.input, { height, maxHeight, color: c.textPrimary }]}
            value={value}
            onChangeText={onChangeText}
            onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
            scrollEnabled={contentHeight >= maxHeight}
            editable={!sending}
            placeholder={ROMAN_COMPOSER_PLACEHOLDER}
            placeholderTextColor={c.textMuted}
            multiline
            maxLength={ROMAN_MESSAGE_MAX_LENGTH + 1}
            accessibilityLabel="Message Roman"
            testID="roman-composer-input"
          />
        </View>
        <TouchableOpacity
          style={[s.send, { backgroundColor: pathTint.leaf }]}
          onPress={onSend}
          disabled={!canSend}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          accessibilityLabel={sending ? 'Sending message' : 'Send message'}
          testID="roman-composer-send"
        >
          {sending ? (
            <ActivityIndicator color={forestPop.forest} testID="roman-composer-spinner" />
          ) : (
            <Ionicons name="arrow-up" size={20} color={forestPop.forest} style={canSend ? undefined : s.idle} accessible={false} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  field: { flex: 1, borderWidth: 1, borderRadius: radius.input, paddingHorizontal: spacing.lg },
  input: { minHeight: MIN_HEIGHT, ...typography.body, paddingHorizontal: 0, paddingTop: spacing.md, paddingBottom: spacing.md, textAlignVertical: 'center' },
  send: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button },
  idle: { opacity: 0.5 },
});
