import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import RomanAvatar from '../roman/RomanAvatar';
import { colors, radius } from '../../theme/tokens';

export interface RomanDraftContext {
  coach: string;
  client: string;
  isSender: boolean;
}

/** S-03 is pending owner approval. Keep romanDraftMark off until approved. */
export const ROMAN_DRAFT_HINT =
  'Shows “Drafted by Roman”. Tap that line to open a short explanation.';

export const RomanDraftMark = React.forwardRef<View, {
  isMe: boolean;
  context: RomanDraftContext;
  expanded: boolean;
  onPress: () => void;
  onLongPress: () => void;
}>(function RomanDraftMark({ isMe, context, expanded, onPress, onLongPress }, ref) {
  return (
    <Pressable
      ref={ref}
      testID="roman-draft-mark"
      style={[styles.target, isMe ? styles.own : styles.incoming]}
      accessibilityRole="button"
      accessibilityLabel={`Roman helped draft this message. ${context.isSender ? 'You' : context.coach} sent it.`}
      accessibilityHint={ROMAN_DRAFT_HINT}
      accessibilityState={{ expanded }}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <View testID="roman-draft-ring" style={styles.cutRing} pointerEvents="none"
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.goldRing}><RomanAvatar crop="neutral" size={17} /></View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  target: { position: 'absolute', width: 44, height: 44, bottom: 0 },
  own: { left: 0 },
  incoming: { right: 0 },
  cutRing: {
    position: 'absolute', top: 18, left: 10, width: 24, height: 24,
    borderRadius: radius.chip, borderWidth: 2, borderColor: colors.bone,
    backgroundColor: colors.bone, alignItems: 'center', justifyContent: 'center',
  },
  goldRing: {
    width: 20, height: 20, borderRadius: radius.chip, borderWidth: 1.5,
    borderColor: colors.romanAccent, alignItems: 'center', justifyContent: 'center',
  },
});
