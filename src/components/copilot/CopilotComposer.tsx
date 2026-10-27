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
import { forestPop, layout, pathTint, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { ROMAN_COMPOSER_PLACEHOLDER } from '../roman/romanVoice';
import { footerBottomPadding, useScreenInsets } from '../../ui/layout/Screen';
import { ledger, ledgerType } from '../../screens/client/copilot/ledger';

const MIN_HEIGHT = 44;

export interface CopilotComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /**
   * Style A's composer bar (.cmp, Sol B-G2): cream, a hairline on top, the page gutter at the sides, drawn edge to
   * edge over the pinned footer's own padding (the composer is Screen's footer, edges bottom).
   */
  gutter?: number;
  testID?: string;
}

export default function CopilotComposer({ value, onChangeText, onSend, sending, gutter, testID }: CopilotComposerProps): React.ReactElement {
  const { semanticColors: c } = useTheme();
  const insets = useScreenInsets();
  const under = footerBottomPadding(insets.bottom);
  const bar = gutter == null ? null : {
    marginHorizontal: -layout.gutter, marginTop: -layout.footerTopGap, marginBottom: -under,
    paddingHorizontal: gutter, paddingTop: 10, paddingBottom: Math.max(6, under - 8),
    backgroundColor: ledger.bar, borderTopWidth: 1, borderTopColor: ledger.line,
  };
  const overCap = value.length > ROMAN_MESSAGE_MAX_LENGTH;
  const canSend = !sending && value.trim().length > 0 && !overCap;
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = Math.max(120, Math.round(windowHeight * 0.3));
  const [contentHeight, setContentHeight] = useState(MIN_HEIGHT);
  const height = Math.min(Math.max(MIN_HEIGHT, contentHeight), maxHeight);
  return (
    <View style={[s.wrap, bar]} testID={testID}>
      {overCap ? (
        <Text style={[typography.bodySmall, { color: forestPop.error }]} accessibilityRole="text">
          {`Message is too long by ${value.length - ROMAN_MESSAGE_MAX_LENGTH} characters.`}
        </Text>
      ) : null}
      <View style={s.row}>
        <View style={[s.field, { backgroundColor: ledger.card, borderColor: ledger.chip }]} testID="roman-composer-field">
          <TextInput
            style={[s.input, { height, maxHeight, color: c.textPrimary }]}
            value={value}
            onChangeText={onChangeText}
            onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
            scrollEnabled={contentHeight >= maxHeight}
            editable={!sending}
            placeholder={ROMAN_COMPOSER_PLACEHOLDER}
            placeholderTextColor={ledger.muted}
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
            <ActivityIndicator color={forestPop.moss} testID="roman-composer-spinner" />
          ) : (
            <Ionicons name="arrow-up" size={22} color={forestPop.moss} style={canSend ? undefined : s.idle} accessible={false} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.sm },
  // Style A (.cmp .in, .cmp .go; Sol B-G2): a 46-high field with the leaf hairline, radius 12, 14 in; the send square.
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  field: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  input: { minHeight: MIN_HEIGHT, ...ledgerType.field, paddingHorizontal: 0, paddingTop: 11, paddingBottom: 11, textAlignVertical: 'center' },
  send: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  idle: { opacity: 0.5 },
});
