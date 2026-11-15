/**
 * FlaggedPhoto — a reported photo in the coach's report queue (PHOTO-MOD-M).
 *
 * Server contract (backend main, FX-1139): `GET /community/moderation/flagged`
 * adds `image` to an item whose target is a photo message
 * (community-moderation.service.ts FlaggedItemView.image):
 *   - `null` once the photo was hidden or deleted (`removed: true`);
 *   - `{ url: string | null, width, height, expires_at }` otherwise, where
 *     `url` is a 15-minute signed link, null when storage could not sign it.
 * Items for posts, wins, voice notes and text messages have no `image` key.
 *
 * What the coach sees: a rounded thumbnail they can tap to open the photo
 * full size (pinch to zoom on iPhone), with a short line under it, the same
 * pattern the queue uses for voice notes. A photo that cannot be shown (no
 * link, or the link fails to load) is a bordered notice with the way forward
 * (pull to refresh), never a blank tile. A removed photo draws nothing here:
 * the row reads "Removed" like any removed item. A failed load never refetches
 * on its own (no loop); pulling down mints a fresh link and the tile retries.
 *
 * Tokens only (no raw hex), line Ionicons, radius 12, 44 pt targets.
 */
import React, { useCallback, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import HapticPressable from '../../HapticPressable';
import { useTheme } from '../../../theme/useTheme';
import { colors, radius, spacing, withAlpha } from '../../../theme/tokens';

/** The `image` a photo item carries (same shape as the chat row's photo). */
export const FlaggedPhotoImageSchema = z
  .object({
    url: z.string().min(1).nullable(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    expires_at: z.string().optional(),
  })
  .passthrough();
export type FlaggedPhotoImage = z.infer<typeof FlaggedPhotoImageSchema>;

/**
 * What a queue item says about a photo:
 *   none    — not a photo item (no `image` key: post, win, voice, text);
 *   removed — a photo that was hidden or deleted (`removed`, or `image: null`);
 *   photo   — a photo to show. A malformed `image` reads as a photo with no
 *             link, so the coach sees the cannot-show notice, not a blank tile.
 */
export type FlaggedPhotoState =
  | { kind: 'none' }
  | { kind: 'removed' }
  | { kind: 'photo'; image: FlaggedPhotoImage };

export function readFlaggedPhoto(item: {
  target_type: string;
  removed?: boolean;
  [key: string]: unknown;
}): FlaggedPhotoState {
  if (item.target_type !== 'message' || !('image' in item) || item.image === undefined) {
    return { kind: 'none' };
  }
  // Key off `removed` first (contract): the photo went with the message.
  if (item.removed === true || item.image === null) return { kind: 'removed' };
  const parsed = FlaggedPhotoImageSchema.safeParse(item.image);
  if (parsed.success) return { kind: 'photo', image: parsed.data };
  return { kind: 'photo', image: { url: null, width: 0, height: 0 } };
}

/** Thumbnail box: 200 pt tall, width from the photo's shape, kept on the card. */
export const THUMB_HEIGHT = 200;
const THUMB_MIN_WIDTH = 150;
const THUMB_MAX_WIDTH = 280;

export function thumbnailSize(image: Pick<FlaggedPhotoImage, 'width' | 'height'>): {
  width: number;
  height: number;
} {
  const aspect = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  const width = Math.round(
    Math.min(THUMB_MAX_WIDTH, Math.max(THUMB_MIN_WIDTH, THUMB_HEIGHT * aspect)),
  );
  return { width, height: THUMB_HEIGHT };
}

export const PHOTO_HELP = 'Look before you decide. Tap the photo to see it full size.';
export const PHOTO_FAILED =
  'This photo cannot be shown right now. Pull down to refresh the queue, then try again.';

export interface FlaggedPhotoProps {
  image: FlaggedPhotoImage;
  authorName: string;
  testID: string;
}

export default function FlaggedPhoto({
  image,
  authorName,
  testID,
}: FlaggedPhotoProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const url = image.url;
  // Keyed on the link: a refreshed queue brings a new link and the tile retries.
  const failed = url == null || failedUrl === url;
  // A failure in the full-size view closes it onto the cannot-show notice.
  const onLoadError = useCallback(() => {
    setFailedUrl(url);
    setOpen(false);
  }, [url]);
  const close = useCallback(() => setOpen(false), []);

  if (failed) {
    return (
      <View
        style={[
          styles.failed,
          { backgroundColor: semanticColors.bgPrimary, borderColor: semanticColors.border },
        ]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Photo from ${authorName}. ${PHOTO_FAILED}`}
        testID={`${testID}-failed`}
      >
        <Ionicons name="image-outline" size={20} color={semanticColors.textMuted} />
        <Text style={[styles.failedText, { color: semanticColors.textMuted }]}>
          {PHOTO_FAILED}
        </Text>
      </View>
    );
  }

  const size = thumbnailSize(image);
  return (
    <View style={styles.wrap} testID={testID}>
      <HapticPressable
        intent="light"
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Photo from ${authorName}`}
        accessibilityHint="Opens the photo full size"
        testID={`${testID}-thumb`}
        style={[
          styles.thumb,
          size,
          { backgroundColor: semanticColors.bgPrimary, borderColor: semanticColors.border },
        ]}
      >
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={onLoadError}
          accessibilityIgnoresInvertColors
          testID={`${testID}-image`}
        />
        <View style={styles.expand} pointerEvents="none">
          <Ionicons name="expand-outline" size={16} color={colors.bone} />
        </View>
      </HapticPressable>
      <Text style={[styles.help, { color: semanticColors.textMuted }]}>{PHOTO_HELP}</Text>

      <Modal
        visible={open}
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
        supportedOrientations={['portrait', 'landscape']}
      >
        <View
          style={[styles.viewer, { backgroundColor: colors.ink }]}
          accessibilityViewIsModal
          testID={`${testID}-viewer`}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.viewerContent}
            maximumZoomScale={3}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              source={{ uri: url }}
              style={{ width: window.width, height: window.height }}
              resizeMode="contain"
              onError={onLoadError}
              accessible
              accessibilityLabel={`Photo from ${authorName}`}
              accessibilityIgnoresInvertColors
              testID={`${testID}-full`}
            />
          </ScrollView>
          {/* HapticPressable wraps its Pressable in a view: the wrapper is what sits over the photo. */}
          <View style={[styles.closeWrap, { top: insets.top + spacing.sm }]}>
            <HapticPressable
              intent="light"
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              hitSlop={8}
              testID={`${testID}-close`}
              style={[styles.close, { backgroundColor: withAlpha(colors.bone, 0.16) }]}
            >
              <Ionicons name="close" size={24} color={colors.bone} />
            </HapticPressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  thumb: {
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  expand: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.ink, 0.6),
  },
  help: {
    fontSize: 12,
  },
  failed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
  },
  failedText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  viewer: {
    flex: 1,
  },
  viewerContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeWrap: {
    position: 'absolute',
    right: spacing.lg,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
