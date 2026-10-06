/**
 * "Contact support" for the Roman conversations screens. Opens the one
 * support email (constants/support.ts) through the shared useSupportEmail
 * handle, with the short reference in the subject and never any chat content.
 * When the phone cannot open an email app, SupportEmailFallback says so and
 * offers the address to copy (S-ERRORS, Sol B-324-1: never a silent failure).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { SupportEmailFallback, useSupportEmail } from '../../components/support/SupportEmailFallback';
import { ROMAN_CHATS_COPY, supportSubject } from './romanChatsCopy';

export interface RomanChatsSupportActionProps {
  /** The short reference shown in the message, if any. */
  reference: string | null;
  testID: string;
  buttonStyle: StyleProp<ViewStyle>;
  buttonTextStyle: StyleProp<TextStyle>;
  bodyStyle: StyleProp<TextStyle>;
  linkColor: string;
}

export default function RomanChatsSupportAction({
  reference,
  testID,
  buttonStyle,
  buttonTextStyle,
  bodyStyle,
  linkColor,
}: RomanChatsSupportActionProps): React.ReactElement {
  const handle = useSupportEmail(supportSubject(reference));
  return (
    <>
      <HapticPressable
        intent="light"
        onPress={() => void handle.open()}
        accessibilityRole="button"
        accessibilityLabel={ROMAN_CHATS_COPY.contactSupport}
        style={buttonStyle}
        testID={testID}
      >
        <Text style={buttonTextStyle}>{ROMAN_CHATS_COPY.contactSupport}</Text>
      </HapticPressable>
      {handle.state !== 'idle' ? (
        <View style={styles.fullRow}>
          <SupportEmailFallback
            handle={handle}
            textStyle={bodyStyle}
            linkColor={linkColor}
            testID={`${testID}-fallback`}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fullRow: { flexBasis: '100%' },
});
