import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import RomanAvatar from '../roman/RomanAvatar';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useTheme } from '../../theme/ThemeProvider';
import { colors, radius, typography } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { RomanDraftSheet, focusRomanControl } from './RomanDraftSheet';

export interface RomanDraftContext {
  coach: string;
  client: string;
  isSender: boolean;
}

/** ROMANMARK-S-03, the owner's new two-step hint (#ROMANMARK-S03 "new hint", 10-15). */
export const ROMAN_DRAFT_HINT =
  'Shows “Drafted by Roman”. Tap that line to open a short explanation.';

/** The one eligibility rule for every thread bubble: a drafted, not deleted message, in a thread that names its coach. */
export function romanMarked(m: { drafted?: boolean; deleted?: boolean }, context?: RomanDraftContext): context is RomanDraftContext {
  return featureFlags.romanDraftMark && !!m.drafted && !m.deleted && !!context;
}

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

/**
 * Wraps one thread bubble (MessageBubble or the C3 Style B bubble): the mark on its bottom inner corner, the faint
 * "Drafted by Roman" line under it, and the sheet. `width` is the bubble's max width in percent of the row; a marked
 * bubble keeps that limit through the inner gutter, and the frame's padding keeps the 44 pt target inside native bounds.
 * `inset` is the bubble's side padding, so the line starts under the text. Unmarked, it is only the max-width box.
 */
export function RomanDraftFrame({ marked, isMe, context, width, inset, onLongPress, children }: {
  marked: boolean;
  isMe: boolean;
  context?: RomanDraftContext;
  width: number;
  inset: number;
  onLongPress: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const muted = useTheme().semanticColors.textMuted;
  const [revealed, setRevealed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const mark = useRef<View>(null);
  if (!marked || !context) return <View style={{ maxWidth: `${width}%` }}>{children}</View>;
  return (
    <>
      <View style={[styles.gutter, isMe ? { paddingLeft: `${100 - width}%`, alignItems: 'flex-end' } : { paddingRight: `${100 - width}%`, alignItems: 'flex-start' }]}>
        <View testID="roman-draft-frame" style={styles.frame}>
          {children}
          <RomanDraftMark ref={mark} isMe={isMe} context={context} expanded={revealed}
            onPress={() => { HapticService.selection(); setRevealed((v) => !v); }} onLongPress={onLongPress} />
        </View>
      </View>
      {revealed ? (
        <Pressable style={[styles.line, { paddingHorizontal: inset }]} accessibilityRole="button" accessibilityLabel="Drafted by Roman"
          accessibilityHint="Opens a short explanation." onLongPress={onLongPress} delayLongPress={350}
          onPress={() => { HapticService.selection(); setSheet(true); }}>
          <Text style={[styles.lineText, { color: muted }]}>Drafted by Roman</Text>
        </Pressable>
      ) : null}
      {sheet ? <RomanDraftSheet context={context} onClose={() => setSheet(false)} onDismiss={() => focusRomanControl(mark.current)} /> : null}
    </>
  );
}

/** Added to a marked bubble: room under the text for the 44 pt target, never a target narrower than itself. */
export const romanMarkedBubble = { paddingBottom: 26, minWidth: 44 } as const;

const styles = StyleSheet.create({
  gutter: { alignSelf: 'stretch' },
  frame: { paddingBottom: 18, paddingHorizontal: 16, marginHorizontal: -16 },
  line: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  lineText: { ...typography.bodySmall, fontStyle: 'italic', textDecorationLine: 'underline' },
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
