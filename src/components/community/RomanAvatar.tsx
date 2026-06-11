/**
 * RomanAvatar — Roman brand avatar for Community surfaces.
 *
 * Per ROMAN_VOICE_POLICY.md §4 avatar matrix:
 *   - `monogram` — compact spots: dense in-app rows, tab/empty-state accents,
 *     image-disabled fallback. The monogram is the smallest, most reliable
 *     crop and is the universal fallback.
 *   - `smile` — success / recovery / milestone moments only (e.g. a cleared
 *     moderation queue). NEVER on money-failure surfaces (N/A here).
 *   - `neutral` — generic empty states.
 *
 * FACE ASSET STATUS (fixer R1, UX P1.4 — SKIP-BECAUSE / DEFERRED):
 *   No bundled Roman face asset exists in this repo (verified: there is no
 *   `assets/roman/` directory and no `neutral.png` / `smile.png`). Per R70 the
 *   fixer did NOT invent placeholder PNGs. Instead this component now accepts an
 *   optional `source` URI so a face renders the moment an asset (bundled or CDN)
 *   is supplied — the empty-state payload can carry an `avatar_url` and the
 *   screens pass it straight through. When no `source` is given the component
 *   falls back to the accessible deep-gold monogram tile (the documented
 *   universal fallback), with the crop still driving the accessibility label
 *   and the celebratory ring so neutral and smile are visually distinguishable.
 *   The face+voice CONTRACT (payload-driven text + crop) is satisfied today;
 *   the literal photographic face remains DEFERRED until the asset lands.
 */
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

/** Approved crops used on Community surfaces (subset of the §4 matrix). */
export type RomanCrop = 'monogram' | 'smile' | 'neutral';

export interface RomanAvatarProps {
  /** Which approved crop to show. Defaults to the compact monogram. */
  crop?: RomanCrop;
  /**
   * Optional face image URI (bundled require()'d uri or CDN url). When present
   * the actual face renders; when absent the monogram fallback renders.
   */
  source?: string | null;
  /** Pixel size of the square avatar. Default 28 (dense row). */
  size?: number;
  testID?: string;
}

// Deep-gold accent from the Roman avatar run summary (ROMAN_VOICE_POLICY §8).
const ROMAN_ACCENT = '#C9A961';
const ROMAN_INK = '#1A1A18';

export default function RomanAvatar({
  crop = 'monogram',
  source,
  size = 28,
  testID,
}: RomanAvatarProps): React.ReactElement {
  const a11y = crop === 'smile' ? 'Roman, pleased' : 'Roman';
  // The celebratory ring distinguishes the smile crop from neutral even in the
  // monogram-fallback state (no face asset bundled yet — see header note).
  const showRing = crop === 'smile';

  if (source) {
    return (
      <Image
        testID={testID}
        accessibilityRole="image"
        accessibilityLabel={a11y}
        source={{ uri: source }}
        style={[
          styles.face,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: showRing ? ROMAN_ACCENT : 'transparent',
            borderWidth: showRing ? 1 : 0,
          },
        ]}
      />
    );
  }

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
          borderColor: showRing ? ROMAN_ACCENT : 'transparent',
          borderWidth: showRing ? 1 : 0,
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
  face: {
    backgroundColor: ROMAN_ACCENT,
  },
  mark: {
    color: ROMAN_INK,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
