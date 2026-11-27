/**
 * DmCoachCard — REFINE-985R3 (owner pick 203-P2, DM-LIST-MOCK Style 1 "Coach first"): the client's own coach in a
 * forest card at the top of her message list, above "Conversations". Only the client's DM list draws it, and only for
 * client.coach_id. Its numbers are the drawing's CSS (planning/DM-LIST-MOCK/src/html/S1_L1_ios.html): .ccard :42,
 * .ctile :43, .ctile.ring :44, .cnm :45, .crel :46, .cmeta :47-48, the chevron #B8CCBF 20 pt.
 *
 * The name is the one the phone read ("Coach" until it has, with a blank tile: no letter from "Coach"). The time line
 * is her coach's thread's, in DmRow's words (dmActivity); it is left out when the phone cannot know it. The whole card
 * is one button: it says who (as the row always has) and, as its spoken value, "your coach".
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { brand, forestPop as fp } from '../../theme/tokens';
import { dmActivity } from './DmRow';

export interface DmCoachCardProps {
  /** Her coach's name as the phone read it, or "Coach" until it has. */
  name: string;
  /** The name's first character for the tile; null draws the tile blank. */
  letter: string | null;
  /** Her coach's thread's last message: a time, null when the read shows there is no message yet, undefined when the
   * phone cannot tell (the read has not answered, or its one page is full without her coach's thread). */
  lastMessageAt?: string | null;
  onPress: () => void;
  testID?: string;
}

export default function DmCoachCard({ name, letter, lastMessageAt, onPress, testID = 'dm-coach-card' }: DmCoachCardProps): React.ReactElement {
  const activity = lastMessageAt === undefined ? null : dmActivity(lastMessageAt);
  return (
    <HapticPressable
      intent="light"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open conversation with ${name}`}
      accessibilityValue={{ text: lastMessageAt === null ? 'your coach, no messages yet' : 'your coach' }}
      testID={testID}
      style={styles.card}
    >
      {/* The name beside it is what is read; the letter grows with the phone's text size to 150% and no further (24 pt
          to 36 pt: the face's widest capital is then 33 pt and its line 43.6 pt, inside the tile's 46 pt). */}
      <View style={styles.tile} testID={`${testID}-tile`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {activity?.now ? <View style={styles.ring} testID={`${testID}-ring`} /> : null}
        {letter ? <Text style={styles.letter} maxFontSizeMultiplier={1.5}>{letter}</Text> : null}
      </View>
      <View style={styles.words}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.relation}>Your coach</Text>
        {activity ? <Text style={[styles.meta, activity.now ? styles.metaNow : null]}>{activity.line}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={fp.onDeepMuted} />
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  // .ccard: margin 12 16 4, #1C3023, radius 16, padding 12 14, gap 14, words #FBF7F0.
  card: {
    marginTop: 12, marginHorizontal: 16, marginBottom: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: fp.deep,
  },
  // .ctile: 48 pt, radius 12, #2C4A36 with a 1 pt #3A5C46 line inside, Cormorant 600 24, #E0EBE4.
  tile: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: brand[500], backgroundColor: fp.forest, alignItems: 'center', justifyContent: 'center' },
  // .ctile.ring: a 2 pt #A3C46A outline 2 pt off the tile (5 pt out from inside its 1 pt line, outer radius 16).
  ring: { position: 'absolute', top: -5, right: -5, bottom: -5, left: -5, borderRadius: 16, borderWidth: 2, borderColor: fp.leaf },
  letter: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 24, color: fp.sage },
  words: { flex: 1, minWidth: 0 },
  // .cnm 600 17/1.25, wraps; .crel 14.5/1.3 #B8CCBF; .cmeta 13.5/1.3 #B8CCBF, "now" #FBF7F0 600.
  name: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 17, lineHeight: 21.25, color: fp.onDeep },
  relation: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 18.85, color: fp.onDeepMuted },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 17.55, color: fp.onDeepMuted },
  metaNow: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: fp.onDeep },
});
