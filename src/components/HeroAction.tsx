/**
 * HeroAction — Wave 3: luxury button spec.
 *
 * - ink-fill rectangle (backgroundColor: colors.ink)
 * - bone text (color: colors.bone)
 * - radius: 0 (no border radius)
 * - no shadow, no glow
 * - pressed state: opacity 0.85 over ~200ms
 *
 * Note: HomeScreen now has an inline Pressable that does the same job.
 * HeroAction is kept for any feature screens that still reference it.
 * Usage: `grep -r "HeroAction" src/` — if 0 usages beyond this file,
 * the file can be deleted in a follow-up pass.
 */

import React from 'react';
import { Pressable, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { track } from '../lib/analytics';
import { colors, typography } from '../theme/tokens';
import type { MotivationalTone } from '../hooks/usePreferences';

interface HeroActionProps {
  /** Retained for back-compat — not used in Wave 3 rendering */
  motivationalTone?: MotivationalTone;
}

export default function HeroAction({ motivationalTone: _tone }: HeroActionProps = {}) {
  const navigation = useNavigation<any>();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    track('hero_action_tapped', { surface: 'hero_action_component' });
    navigation.navigate('WorkoutTab');
  };

  return (
    <Pressable
      style={({ pressed }) => ({
        backgroundColor: colors.ink,
        paddingVertical: 20,
        alignItems: 'center',
        opacity: pressed ? 0.85 : 1,
        // radius: 0 — no borderRadius
      })}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Continue"
      accessibilityHint="Opens your workout tracker"
    >
      <Text style={{ ...typography.eyebrow, color: colors.bone }}>CONTINUE</Text>
    </Pressable>
  );
}
