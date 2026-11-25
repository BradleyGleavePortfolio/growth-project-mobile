/**
 * RomanHeldCard: Roman's place, held (owner #203-E41, 203-D13 op B; GOAL ctx#520 planning/ROMAN-RETRY-C frames/B and
 * src/build.py :173-178, :294-298, :381-386 at a5e4f65b). When a send to Roman gets no answer, or Roman cannot answer
 * now, his answer turn is drawn at once where the answer would be: a cream card with a gold left edge, his face at the
 * start of the line, his words in italic Cormorant, three still dots while the answer is "not ready yet" and, where the
 * state has it, Send again under the words. The words, the dots and Send again tell it from an answer; it adds no
 * words of its own. Used by the Roman room (client and coach) and by Path Copilot's turn card.
 *
 * Gold is the card's left edge and the interrupted note's short rule only, never text: tokens.ts keeps gold for the
 * coach on deep; the owner picked "a gold left edge" here (#203-E41) as a mark.
 */
import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CormorantGaramond_400Regular_Italic, useFonts } from '@expo-google-fonts/cormorant-garamond';
import RomanAvatar from './RomanAvatar';
import { ROMAN_INTERRUPTED_NOTE } from './romanVoice';
import { colors, forestPop, layout, radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

const FACE = 22;
const DOTS = 18;

/** Roman's italic face, loaded where it is drawn and named as FoodDayView.tsx does; a slanted serif until it loads. */
function useRomanItalic() {
  const [loaded] = useFonts({ CormorantGaramond_400Regular_Italic });
  return loaded ? styles.italicFace : null;
}

export interface RomanHeldCardProps {
  /** Roman's line, also what the screen announces. */
  line: string;
  /** "Not ready yet": three still dots at the end of the first line. */
  pending?: boolean;
  /** Send again under the line (the room's states that have it); none on Copilot or for S8. */
  onSendAgain?: () => void;
  /** Send again is disabled while a send is out. */
  sending?: boolean;
  accessibilityRole?: 'alert';
  accessibilityLiveRegion?: 'polite' | 'assertive';
  style?: StyleProp<ViewStyle>;
  testID: string;
}

export default function RomanHeldCard({
  line,
  pending = false,
  onSendAgain,
  sending = false,
  accessibilityRole,
  accessibilityLiveRegion,
  style,
  testID,
}: RomanHeldCardProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const italic = useRomanItalic();
  // The face and the dots sit on the middle of the first line at any text size.
  const { fontScale } = useWindowDimensions();
  const lineHeight = typography.h3.lineHeight * fontScale;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: sc.bgSurface, borderLeftColor: forestPop.gold, borderBottomColor: sc.border },
        onSendAgain ? null : styles.noAction,
        style,
      ]}
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion={accessibilityLiveRegion}
      testID={testID}
    >
      <View style={styles.firstLine}>
        <View style={{ marginTop: Math.max(0, (lineHeight - FACE) / 2) }}>
          <RomanAvatar crop="neutral" size={FACE} />
        </View>
        <Text style={[styles.line, { color: sc.textPrimary }, italic]} accessibilityRole="text" testID={`${testID}-line`}>
          {line}
        </Text>
        {pending ? (
          // A mark only: the line says "not ready yet"; the icon is not read.
          <View style={{ marginTop: Math.max(0, (lineHeight - DOTS) / 2) }} testID={`${testID}-dots`}>
            <Ionicons name="ellipsis-horizontal" size={DOTS} color={sc.textMuted} accessible={false} />
          </View>
        ) : null}
      </View>
      {onSendAgain ? (
        <TouchableOpacity
          style={styles.sendAgain}
          onPress={onSendAgain}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Send again"
          accessibilityState={{ disabled: sending }}
          testID="roman-send-retry"
        >
          <Text style={[styles.sendAgainLabel, { color: sc.accentText }]}>Send again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** The interrupted note under a cut reply (B frame S9): a short gold rule, then the same words in Roman's italic. */
export function RomanInterruptedNote({ testID }: { testID?: string }): React.ReactElement {
  const italic = useRomanItalic();
  return (
    <View testID={testID}>
      <View style={styles.rule} testID={testID ? `${testID}-rule` : undefined} />
      <Text style={[styles.note, italic]}>{ROMAN_INTERRUPTED_NOTE}</Text>
    </View>
  );
}

const serifItalic = {
  ...typography.h3,
  fontFamily: typography.h2.fontFamily,
  fontWeight: '400' as const,
  fontStyle: 'italic' as const,
  letterSpacing: 0,
};

const styles = StyleSheet.create({
  // .bc: 3 pt gold edge, corners 4/16/16/4 (radius.control, radius.card), a 1 pt line under it, padding 8/14/0/12.
  card: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.xl,
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderTopLeftRadius: radius.control,
    borderBottomLeftRadius: radius.control,
    borderTopRightRadius: radius.card,
    borderBottomRightRadius: radius.card,
    paddingTop: spacing.sm,
    paddingRight: spacing.md,
    paddingLeft: spacing.md,
  },
  // .bc.noact: a card with no action ends 12 under the line.
  noAction: { paddingBottom: spacing.md },
  firstLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  // Cormorant italic 18 on h3's 25 line, ink (the drawing's 18/25).
  line: { ...serifItalic, fontSize: 18, flex: 1 },
  italicFace: { fontFamily: 'CormorantGaramond_400Regular_Italic', fontStyle: 'normal' },
  // Today's forest underlined text action, whole at 44 x 44, its words in line with Roman's face.
  sendAgain: {
    alignSelf: 'flex-start',
    minHeight: layout.touchMin,
    minWidth: layout.touchMin,
    paddingHorizontal: spacing.xs,
    marginLeft: -spacing.xs,
    justifyContent: 'center',
  },
  sendAgainLabel: { ...typography.bodyMd, textDecorationLine: 'underline' },
  // The interrupted note: a 1 pt gold rule 48 wide, then Cormorant italic 17/24 in charcoal.
  rule: { width: spacing['3xl'], height: 1, backgroundColor: forestPop.gold, marginBottom: spacing.sm },
  note: { ...serifItalic, fontSize: 17, lineHeight: 24, color: colors.charcoal },
});
