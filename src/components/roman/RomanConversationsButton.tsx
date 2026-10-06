/**
 * Header entry from the Roman chat to "Your conversations with Roman"
 * (Settings > Privacy > Roman and AI has the same entry). The target route
 * is registered in the same stack as RomanChat in both navigators.
 */
import React, { useContext } from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContext } from '@react-navigation/native';
import HapticPressable from '../HapticPressable';
import { colors } from '../../theme/tokens';
import { ROMAN_CHATS_COPY } from '../../screens/settings/romanChatsCopy';

export default function RomanConversationsButton({ testID = 'roman-conversations-button' }: { testID?: string }) {
  // Read the context directly so the chat still renders outside a navigator
  // (tests, previews); without one there is nowhere to go, so no button.
  const navigation = useContext(NavigationContext);
  if (!navigation) return null;
  return (
    <HapticPressable
      intent="light"
      onPress={() => navigation.navigate('RomanConversations')}
      accessibilityRole="button"
      accessibilityLabel={ROMAN_CHATS_COPY.entryLabel}
      accessibilityHint={ROMAN_CHATS_COPY.entryHint}
      style={styles.button}
      testID={testID}
    >
      <Ionicons name="time-outline" size={22} color={colors.ink} />
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  button: { marginLeft: 'auto', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
