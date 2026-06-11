/**
 * RomanAvatar — Roman brand-character avatar for Community surfaces.
 *
 * Per ROMAN_VOICE_POLICY.md §4 avatar matrix:
 *   - `neutral` — generic empty states. Renders Roman's neutral face.
 *   - `smile`   — success / recovery / milestone moments only (e.g. a cleared
 *     moderation queue). Renders Roman's pleased face with a celebratory ring.
 *   - `monogram` — compact spots (dense in-app rows) and the universal
 *     image-load-failure fallback. Renders the deep-gold "R" tile.
 *
 * FACE+VOICE CONTRACT (fixer R2 — Option A, RESOLVED):
 *   The operator-locked rule requires Roman's literal face on every Roman-voiced
 *   empty state. Roman's brand-character face is now BUNDLED at
 *   `assets/roman/{neutral,smile}.png` (with @2x/@3x densities) and is the
 *   DEFAULT render for the `neutral`/`smile` crops — resolved through
 *   `romanFaceAsset(crop)`. The face paints offline on first frame, with no
 *   network/CDN dependency.
 *
 *   An optional `source` override (a bundled `ImageSourcePropType` or a CDN
 *   `{ uri }` / URL string from a future backend `avatar_url`) takes precedence
 *   over the bundled asset when supplied, so a backend-served face can swap in
 *   without another code change.
 *
 *   The monogram is reached ONLY when (a) the crop is explicitly `monogram`, or
 *   (b) the resolved face image fails to load at runtime (`onError`). It is
 *   never the default for an empty-state surface — that was the launch blocker
 *   this fix removes.
 */
import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  type ImageSourcePropType,
} from 'react-native';
import { romanFaceAsset } from './romanAvatarAssets';

/** Approved crops used on Community surfaces (subset of the §4 matrix). */
export type RomanCrop = 'monogram' | 'smile' | 'neutral';

export interface RomanAvatarProps {
  /** Which approved crop to show. Defaults to the compact monogram. */
  crop?: RomanCrop;
  /**
   * Optional face image OVERRIDE. Accepts either a CDN/remote URL string (e.g.
   * a future backend `avatar_url`) or a resolved React Native image source
   * (bundled `require()` / `{ uri }`). When provided it takes precedence over
   * the bundled brand asset selected by `crop`. When absent, the bundled face
   * for the crop renders. When the chosen image fails to load, the monogram
   * fallback renders.
   */
  source?: string | ImageSourcePropType | null;
  /** Pixel size of the square avatar. Default 28 (dense row). */
  size?: number;
  testID?: string;
}

// Deep-gold accent from the Roman avatar run summary (ROMAN_VOICE_POLICY §8).
const ROMAN_ACCENT = '#C9A961';
const ROMAN_INK = '#1A1A18';

/** Normalize the `source` prop / bundled asset into an Image `source` value. */
function resolveSource(
  override: string | ImageSourcePropType | null | undefined,
  crop: RomanCrop,
): ImageSourcePropType | null {
  if (typeof override === 'string') {
    return override.length > 0 ? { uri: override } : null;
  }
  if (override != null) return override;
  // No override: use the bundled brand face for neutral/smile (null for
  // monogram, which renders the text tile).
  return romanFaceAsset(crop);
}

export default function RomanAvatar({
  crop = 'monogram',
  source,
  size = 28,
  testID,
}: RomanAvatarProps): React.ReactElement {
  const a11y = crop === 'smile' ? 'Roman, pleased' : 'Roman';
  // The celebratory ring distinguishes the smile crop from neutral (carried on
  // both the face image and the monogram fallback).
  const showRing = crop === 'smile';

  // Track an image-load failure so we can fall back to the accessible monogram
  // tile WITHOUT silently showing a broken image. This is the ONLY path to the
  // monogram for a neutral/smile crop.
  const [failed, setFailed] = React.useState(false);
  // Reset the failure flag if the resolved image identity changes.
  const resolved = resolveSource(source, crop);
  const resolvedKey = typeof source === 'string' ? source : crop;
  React.useEffect(() => {
    setFailed(false);
  }, [resolvedKey]);

  const ringStyle = {
    borderColor: showRing ? ROMAN_ACCENT : 'transparent',
    borderWidth: showRing ? 1 : 0,
  };

  if (resolved != null && !failed) {
    return (
      <Image
        testID={testID}
        accessibilityRole="image"
        accessibilityLabel={a11y}
        source={resolved}
        onError={() => setFailed(true)}
        style={[
          styles.face,
          { width: size, height: size, borderRadius: size / 2 },
          ringStyle,
        ]}
      />
    );
  }

  // Monogram fallback: explicit `monogram` crop, or an image that failed to
  // load. Accessible, crop-aware label + celebratory ring preserved.
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={a11y}
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size / 2 },
        ringStyle,
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
    backgroundColor: 'transparent',
  },
  mark: {
    color: ROMAN_INK,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
