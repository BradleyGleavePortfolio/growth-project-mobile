import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { useTheme } from '../../../theme/useTheme';
import { brand, colors, radius, spacing, typography } from '../../../theme/tokens';
import { importJourneyCopy as t } from './importJourneyCopy';

/** Local presentation primitives only; no provider or task authority. */
export function ImportJourneyAction({
  label, onPress, primary = false, disabled = false, hint,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const { semanticColors: c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[ui.focusFrame, { borderColor: focused ? c.textPrimary : 'transparent' }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onPress()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [ui.action, {
          backgroundColor: disabled ? c.disabledBg : primary ? (pressed ? brand[800] : colors.forest) : (pressed ? c.disabledBg : 'transparent'),
          borderColor: primary ? c.textMuted : 'transparent',
        }]}
      >
        <Text style={[typography.bodyMd, ui.actionLabel, {
          color: disabled ? c.textOnDisabled : primary ? c.textOnAccent : c.textPrimary,
          textDecorationLine: primary ? 'none' : 'underline',
        }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

export function ImportJourneyPortrait() {
  // One localized announcement, including the existing avatar's image-failure fallback.
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('accessibility.roman')} style={ui.portrait}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <RomanAvatar crop="neutral" size={48} />
      </View>
    </View>
  );
}

/** Focus only on a step/variant transition, or an explicitly requested initial entry. */
export function useImportHeadingFocus(key: string, focusOnMount: boolean) {
  const ref = useRef<Text>(null);
  const previous = useRef(key);
  const mounted = useRef(false);
  useEffect(() => {
    const shouldFocus = mounted.current ? previous.current !== key : focusOnMount;
    mounted.current = true;
    previous.current = key;
    // RNWeb explicitly throws from findNodeHandle. Native focus remains native;
    // the optional web preview does not claim equivalent heading focus delivery.
    if (Platform.OS !== 'web' && shouldFocus && ref.current) {
      const target = findNodeHandle(ref.current);
      if (target != null) AccessibilityInfo.setAccessibilityFocus(target);
    }
  }, [key, focusOnMount]);
  return ref;
}

export const ui = StyleSheet.create({
  action: {
    minHeight: 48, minWidth: 48, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderWidth: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { textAlign: 'center', flexShrink: 1 },
  focusFrame: { borderWidth: 2, padding: 2, alignSelf: 'stretch' },
  portrait: { width: 48, height: 48 },
  actions: { gap: spacing.sm },
  text: { textAlign: 'auto' },
});
