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
 * CANONICAL IDENTITY (owner ruling, 2026-06-12 and restated 2026-09-30):
 * Roman is an older Black man in his 60s in a black three-piece butler suit,
 * white shirt and straight black tie (tgp-agent-context
 * strategy/AI_BUTLER_ROMAN_IDENTITY_SPEC.md section 3). The only approved art
 * is tgp-agent-context/design/roman/ (chat avatar, full-body hero, welcome
 * card). Every file in assets/roman/ is derived from that art and pinned by
 * sha256 in __tests__/romanCanonicalAssets.test.ts, so a different face cannot
 * ship silently. The smile crop currently uses the same canonical portrait
 * (which already carries the spec's slight smile) until a dedicated
 * expression asset is approved.
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

/**
 * Larger canonical Roman art for onboarding, reveal and tutorial surfaces.
 * `portrait` is the square chat portrait on its painted background, `hero` the
 * 9:16 full-body figure with the silver platter, `welcome` the 16:9 card.
 */
export type RomanArt = 'portrait' | 'hero' | 'welcome';

export function romanArtAsset(art: RomanArt): ImageSourcePropType {
  switch (art) {
    case 'hero':
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('../../../assets/roman/hero.jpg') as ImageSourcePropType;
    case 'welcome':
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('../../../assets/roman/welcome.jpg') as ImageSourcePropType;
    case 'portrait':
    default:
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('../../../assets/roman/portrait.jpg') as ImageSourcePropType;
  }
}
