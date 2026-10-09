/**
 * Headline, Lede and AccentRule: the serif title stack of the prototype
 * (00 AUTH, 03 W1, 07 B2). Headline reads its lineHeight from the token
 * scale (>= 1.25 x fontSize, B15), so Cormorant descenders never clip on
 * Android. Overline lives in ui/sections/QuietSection (QuietOverline).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { colors, typography, type SerifRole } from '../../theme/tokens';

export interface HeadlineProps {
  children: React.ReactNode;
  level?: SerifRole;
  align?: 'left' | 'center';
  tone?: 'ink' | 'muted';
  numberOfLines?: number;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

export function Headline({
  children,
  level = 'h1',
  align = 'left',
  tone = 'ink',
  numberOfLines,
  testID,
  style,
}: HeadlineProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={1.4}
      testID={testID}
      style={[
        typography[level],
        { color: tone === 'muted' ? sc.textMuted : sc.textPrimary, textAlign: align },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export interface LedeProps {
  children: React.ReactNode;
  size?: 'body' | 'small';
  align?: 'left' | 'center';
  testID?: string;
  style?: StyleProp<TextStyle>;
}

/** The muted line under a headline. */
export function Lede({ children, size = 'body', align = 'left', testID, style }: LedeProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return (
    <Text
      testID={testID}
      style={[size === 'small' ? typography.bodySmall : typography.body, styles.lede, { color: sc.textMuted, textAlign: align }, style]}
    >
      {children}
    </Text>
  );
}

/** The short camel hairline between title and tagline (prototype 00). */
export function AccentRule({ testID }: { testID?: string }): React.ReactElement {
  return <View testID={testID} accessible={false} style={styles.rule} />;
}

const styles = StyleSheet.create({
  lede: { marginTop: 8 },
  rule: { width: 48, height: 1, backgroundColor: colors.camel, marginVertical: 24 },
});
