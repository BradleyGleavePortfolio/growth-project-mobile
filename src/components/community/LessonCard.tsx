/**
 * LessonCard — a single classroom lesson in the student feed (v3-2).
 *
 * BEHAVIORAL DESIGN (DESIGN_INTELLIGENCE Part III):
 *   - ONE clear affordance per card (Hick's Law): tapping the card opens the
 *     lesson. There is no competing secondary control.
 *   - A pinned lesson carries a calm "Pinned" cue (a line pin icon), because
 *     the coach surfaced it deliberately — it is a wayfinding signal, not a
 *     ranking or a badge-theater reward (§3.7).
 *   - A release-locked lesson renders the LessonReleaseLockBadge and reads as
 *     "on its way", never "denied" (§3.4 — no punitive states). The card stays
 *     tappable so the student can open the detail and see the unlock context.
 *   - A compact media summary ("Video · 3 items") tells the student what kind
 *     of lesson this is before they commit a tap, using the primary media kind
 *     as the headline cue. Media kinds map to line Ionicons (no emoji).
 *
 * Tokens only (no raw hex). Line Ionicons only. >=48dp touch target.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import LessonReleaseLockBadge from './LessonReleaseLockBadge';
import type {
  ClassroomPost,
  ClassroomMediaKind,
} from '../../api/communityClassroomApi';

export interface LessonCardProps {
  lesson: ClassroomPost;
  /** Open the lesson detail. */
  onPress: (lesson: ClassroomPost) => void;
  /** Pin the "now" used by the release-lock relative hint (tests inject it). */
  now?: Date;
  testID?: string;
}

const MEDIA_ICON: Record<ClassroomMediaKind, keyof typeof Ionicons.glyphMap> = {
  video: 'videocam-outline',
  audio: 'headset-outline',
  pdf: 'document-text-outline',
  image: 'image-outline',
};

const MEDIA_NOUN: Record<ClassroomMediaKind, string> = {
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  image: 'Image',
};

/**
 * The headline media kind for the card cue: the first attachment's kind, or
 * null when the lesson is text-only. First occurrence wins so the cue is
 * stable across reorders of equivalent media.
 */
export function primaryMediaKind(
  media: ClassroomPost['media'],
): ClassroomMediaKind | null {
  return media.length > 0 ? media[0].kind : null;
}

/** "Video · 3 items" / "Video" / "" (text-only) — a calm, bounded summary. */
export function mediaSummary(media: ClassroomPost['media']): string {
  const kind = primaryMediaKind(media);
  if (kind === null) return '';
  const noun = MEDIA_NOUN[kind];
  if (media.length === 1) return noun;
  return `${noun} · ${media.length} items`;
}

export default function LessonCard({
  lesson,
  onPress,
  now,
  testID,
}: LessonCardProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const kind = primaryMediaKind(lesson.media);
  const summary = mediaSummary(lesson.media);
  const locked = lesson.release_locked;

  // A single, descriptive a11y label that folds in the pinned + locked +
  // media context so a screen-reader user hears the full state in one read.
  const a11yParts = [`Open lesson ${lesson.title}.`];
  if (lesson.pinned) a11yParts.push('Pinned.');
  if (locked) a11yParts.push('Unlocks later.');
  if (summary) a11yParts.push(summary + '.');
  const accessibilityLabel = a11yParts.join(' ');

  return (
    <HapticPressable
      intent="light"
      onPress={() => onPress(lesson)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        {lesson.pinned ? (
          <Ionicons
            name="pin-outline"
            size={16}
            color={semanticColors.accent}
            testID={`${testID ?? 'lesson-card'}-pinned-icon`}
          />
        ) : null}
        <Text
          style={[styles.title, { color: semanticColors.textPrimary }]}
          numberOfLines={2}
        >
          {lesson.title}
        </Text>
      </View>

      {summary ? (
        <View style={styles.mediaRow}>
          {kind ? (
            <Ionicons
              name={MEDIA_ICON[kind]}
              size={15}
              color={semanticColors.textMuted}
            />
          ) : null}
          <Text
            style={[styles.media, { color: semanticColors.textMuted }]}
            numberOfLines={1}
            testID={`${testID ?? 'lesson-card'}-media`}
          >
            {summary}
          </Text>
        </View>
      ) : null}

      {locked ? (
        <LessonReleaseLockBadge
          releaseAt={lesson.release_at}
          now={now}
          testID={`${testID ?? 'lesson-card'}-lock`}
        />
      ) : null}
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: 48,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  media: { flex: 1, fontSize: 14, lineHeight: 20 },
});
