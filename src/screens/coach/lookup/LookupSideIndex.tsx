/**
 * UI-4: the A to Z side index. It owns its own show/hide state, fed from the list's scroll by a ref, so a
 * scroll re-renders only this strip when the index appears or hides, never the rows. One 44 pt wide control:
 * touch or slide along it to jump (as the iOS section index does); for screen readers it is one adjustable
 * control that steps through the letters on the list.
 */
import React, { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { HapticService } from '../../../ui/haptics/haptics.service';

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const COLUMN: ViewStyle = { alignItems: 'center' };

type Props = {
  enabled: boolean;
  /** Scroll offset from which the index shows (Everyone near the top). */
  from: number;
  scrollY: MutableRefObject<number>;
  listen: MutableRefObject<((y: number) => void) | undefined>;
  /** Letters that have a section, in order. */
  present: string[];
  /** Scrolls to the letter's section (or the next one on the list); returns the letter it went to. */
  onJump: (letter: string, animated: boolean) => string | null;
  style: StyleProp<ViewStyle>;
  letterStyle: StyleProp<TextStyle>;
};

export default function LookupSideIndex({ enabled, from, scrollY, listen, present, onJump, style, letterStyle }: Props) {
  const [near, setNear] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const height = useRef(0);
  const last = useRef<string | null>(null);
  useEffect(() => {
    const check = (y: number) => setNear(y >= from); // same value: React skips the render
    check(scrollY.current);
    listen.current = check;
    return () => { listen.current = undefined; };
  }, [from, scrollY, listen]);
  if (!enabled || !near || present.length === 0) return null;

  const go = (letter: string, animated: boolean) => {
    const hit = onJump(letter, animated);
    if (hit && hit !== at) { setAt(hit); void HapticService.selection(); }
  };
  const touch = (y: number, animated: boolean) => {
    const i = Math.floor((y / (height.current || 1)) * LETTERS.length);
    const letter = LETTERS[Math.max(0, Math.min(LETTERS.length - 1, i))];
    if (letter !== last.current) { last.current = letter; go(letter, animated); }
  };
  const current = at ?? present[0];
  return (
    <View
      style={style}
      testID="lookup-index"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="A to Z"
      accessibilityValue={{ text: current }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const next = present[present.indexOf(current) + (e.nativeEvent.actionName === 'increment' ? 1 : -1)];
        if (next) go(next, false);
      }}
      onLayout={(e) => { height.current = e.nativeEvent.layout.height; }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => { last.current = null; touch(e.nativeEvent.locationY, true); }}
      onResponderMove={(e) => touch(e.nativeEvent.locationY, false)}
    >
      <View pointerEvents="none" style={COLUMN}>{LETTERS.map((l) => <Text key={l} style={letterStyle}>{l}</Text>)}</View>
    </View>
  );
}
