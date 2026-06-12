/**
 * romanAvatarAssets — the bundled Roman brand-character face assets (Option A).
 *
 * The operator-locked face+voice contract (2026-06-10) requires every
 * Roman-voiced surface to render Roman's actual face, not a monogram. These are
 * the launch face assets, bundled at `assets/roman/{neutral,smile}.png` (with
 * @2x/@3x densities resolved by the Metro asset pipeline) so the face renders
 * offline, on first paint, with no network/CDN dependency. The monogram in
 * `RomanAvatar` is now ONLY an image-load-failure fallback (`onError`), never
 * the default render.
 *
 * `neutral` — generic empty states (home/inbox/cohorts/cohort-members blank).
 * `smile`   — celebratory empty states only (moderation queue cleared).
 *
 * `monogram` is not a face asset; it is the in-row/`onError` text fallback, so
 * it maps to `null` here.
 */
import type { ImageSourcePropType } from 'react-native';
import type { RomanCrop } from './RomanAvatar';

/**
 * Resolve the bundled face image for a crop. Returns `null` for `monogram`
 * (the text fallback) so the caller renders the monogram tile instead.
 */
export function romanFaceAsset(crop: RomanCrop): ImageSourcePropType | null {
  switch (crop) {
    case 'smile':
      // React Native's Metro bundler resolves bundled image assets ONLY through
      // a static `require()` literal (it cannot follow an `import` for a binary
      // asset path), so a `require` here is required, not a style choice.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('../../../assets/roman/smile.png') as ImageSourcePropType;
    case 'neutral':
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('../../../assets/roman/neutral.png') as ImageSourcePropType;
    case 'monogram':
    default:
      return null;
  }
}
