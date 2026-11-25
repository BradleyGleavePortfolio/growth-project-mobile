// Harness-only @expo/vector-icons: Ionicons drawn from the real glyph map and font.
import React from 'react';
import { Text } from 'react-native';
// @ts-ignore
import map from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
export function Ionicons({ name, size = 16, color, style }: any) {
  const code = (map as Record<string, number>)[name];
  return (
    <Text allowFontScaling={false} style={[{ fontFamily: 'ionicons', fontSize: size, lineHeight: size, color }, style]}>
      {code ? String.fromCodePoint(code) : ''}
    </Text>
  );
}
(Ionicons as any).glyphMap = map;
export default { Ionicons };
