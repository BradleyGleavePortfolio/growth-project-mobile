/**
 * RomanAvatar — Roman brand avatar for Community surfaces.
 *
 * Per ROMAN_VOICE_POLICY.md §4 avatar matrix:
 *   - `monogram` — compact spots: dense in-app rows, tab/empty-state accents,
 *     image-disabled fallback. The monogram is the smallest, most reliable
 *     crop and is the universal fallback.
 *   - `smile` — success / recovery / milestone moments only (e.g. a post just
 *     published, a personal best). NEVER on money-failure surfaces (N/A here).
 *   - `neutral` — generic empty states.
 *
 * v1-5 scope uses ONLY the monogram (compact rows + empty-state accents) and
 * the smile (success/milestone moments). The CDN object-path SHAPE is fixed by
 * policy §6 (`/roman/v{N}/...`) with a bundled monogram fallback; since no
 * Roman image asset is bundled in this repo yet, we render an accessible
 * deep-gold monogram tile (accent colour `#C9A961` per the run summary) as the
 * always-available fallback. A Phase 1 builder can swap in the CDN/bundled
 * crop without changing this component's contract.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/** Approved crops used on Community surfaces (subset of the §4 matrix). */
export type RomanCrop = 'monogram' | 'smile' | 'neutral';

export interface RomanAvatarProps {
  /** Which approved crop to show. Defaults to the compact monogram. */
  crop?: RomanCrop;
  /** Pixel size of the square avatar. Default 28 (dense row). */
  size?: number;
  testID?: string;
}

// Deep-gold accent from the Roman avatar run summary (ROMAN_VOICE_POLICY §8).
const ROMAN_ACCENT = '#C9A961';
const ROMAN_INK = '#1A1A18';

export default function RomanAvatar({
  crop = 'monogram',
  size = 28,
  testID,
}: RomanAvatarProps): React.ReactElement {
  // The monogram is always the bundled fallback. Smile/neutral reuse it until a
  // bundled/CDN crop ships; the `crop` is exposed for the success/milestone
  // accessibility label so screen readers announce the celebratory variant.
  const a11y =
    crop === 'smile'
      ? 'Roman, pleased'
      : crop === 'neutral'
        ? 'Roman'
        : 'Roman';

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={a11y}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: crop === 'smile' ? ROMAN_ACCENT : 'transparent',
          borderWidth: crop === 'smile' ? 1 : 0,
        },
      ]}
    >
      <Text style={[styles.mark, { fontSize: size * 0.5 }]}>R</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: ROMAN_ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mark: {
    color: ROMAN_INK,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
