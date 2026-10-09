/**
 * PrimaryButton (one filled forest button per screen) and TextLink (every
 * other action), DS-PRIMITIVES-133, B16. Prototype 00 and 07: full width,
 * 54 pt, sentence-case Inter 500; rounded radius.button (owner 17:07).
 * Haptics go through HapticService (Settings switch honoured). No springs.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { colors, layout, radius, typography, withAlpha } from '../../theme/tokens';
import { HapticService } from '../haptics/haptics.service';

export interface PrimaryButtonProps {
  label: string;
  onPress: (e?: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean; // spinner, presses ignored, label kept for screen readers
  haptic?: boolean; // light impact on press (default true)
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  haptic = true,
  accessibilityHint,
  testID,
  style,
}: PrimaryButtonProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const inert = disabled || loading;
  const labelColor = disabled ? sc.textOnDisabled : sc.textOnAccent;
  const handlePress = (e: GestureResponderEvent) => {
    if (inert) return;
    if (haptic) void HapticService.softImpact();
    onPress(e);
  };
  return (
    <Pressable
      onPress={handlePress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      testID={testID}
      style={[styles.primary, { backgroundColor: disabled ? sc.disabledBg : sc.accent }, style]}
    >
      {({ pressed }) => (
        <>
          {pressed && !inert ? <View pointerEvents="none" style={styles.pressedVeil} /> : null}
          {loading ? (
            <ActivityIndicator color={labelColor} testID={testID ? `${testID}-spinner` : undefined} />
          ) : (
            <Text style={[styles.primaryLabel, { color: labelColor }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {label}
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}

export type TextLinkTone = 'muted' | 'accent' | 'ink';

export interface TextLinkProps {
  label: string;
  onPress: () => void;
  tone?: TextLinkTone;
  size?: 'body' | 'small';
  underline?: boolean;
  align?: 'center' | 'start' | 'end';
  role?: 'button' | 'link'; // "link" when it opens a web page
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ALIGN = { center: 'center', start: 'flex-start', end: 'flex-end' } as const;

/** The quiet secondary action: text only, 44 pt target, no fill. */
export function TextLink({
  label,
  onPress,
  tone = 'muted',
  size = 'body',
  underline = true,
  align = 'center',
  role = 'button',
  disabled = false,
  accessibilityHint,
  testID,
  style,
}: TextLinkProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const color = tone === 'accent' ? sc.accentText : tone === 'ink' ? sc.textPrimary : sc.textMuted;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      hitSlop={8}
      testID={testID}
      style={({ pressed }) => [styles.link, { alignSelf: ALIGN[align] }, pressed && !disabled && styles.linkPressed, style]}
    >
      <Text
        style={[
          size === 'small' ? styles.linkSmall : styles.linkBody,
          { color: disabled ? sc.textOnDisabled : color },
          underline && styles.underline,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Inline secondary action (e.g. Try again): forest text, no underline, left aligned. */
export function QuietTextButton(props: Omit<TextLinkProps, 'tone'> & { tone?: TextLinkTone }): React.ReactElement {
  return <TextLink tone="accent" underline={false} align="start" {...props} />;
}

const styles = StyleSheet.create({
  primary: {
    alignSelf: 'stretch',
    minHeight: layout.buttonHeight,
    borderRadius: radius.button,
    paddingHorizontal: layout.gutter,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pressedVeil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: withAlpha(colors.ink, 0.16) },
  primaryLabel: { ...typography.bodyMd, lineHeight: 22, letterSpacing: 0.1, textAlign: 'center' },
  link: { minHeight: layout.touchMin, justifyContent: 'center', paddingHorizontal: 4 },
  linkPressed: { opacity: 0.6 },
  linkBody: { ...typography.body, lineHeight: 22 },
  linkSmall: { ...typography.bodySmall, letterSpacing: 0.3 },
  underline: { textDecorationLine: 'underline' },
});
