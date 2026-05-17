/**
 * ExerciseDetailScreen — exercise detail with optional Mux HLS player.
 *
 * Backed by `GET /exercise-catalog/:idOrSlug` (PR
 * `feat/video-library-v1-backend`). The backend mints a signed Mux HLS
 * URL on demand and returns it as `playbackUrl`; if no asset is
 * attached, `playbackUrl` is `null` and we render a small "video not
 * yet available" caption rather than a broken player.
 *
 * Player: `expo-video` (Expo SDK 53+; this app is SDK 55). HLS playback
 * is supported on iOS and Android out of the box. We rely on the
 * default native controls so the screen stays compact and accessible
 * — autoplay deferred to v2.
 *
 * Mounted both as a regular stack screen (from ExerciseLibrary) and as
 * a modal from the in-workout flow. The presentation is owned by the
 * navigator; the screen itself is presentation-agnostic.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { exerciseCatalogApi } from '../../api/exerciseCatalog';
import type { ExerciseDetail } from '../../types/exerciseCatalog';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';

type Props = NativeStackScreenProps<WorkoutStackParamList, 'ExerciseDetail'>;

export default function ExerciseDetailScreen({ route }: Props) {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const { idOrSlug } = route.params;
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    exerciseCatalogApi
      .getByIdOrSlug(idOrSlug)
      .then((res) => {
        if (!cancelled) setDetail(res.data as ExerciseDetail);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load exercise.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idOrSlug]);

  // Always call useVideoPlayer (hook contract). We pass null when there is
  // no URL — the player simply sits idle in that case.
  const playbackUrl = detail?.playbackUrl ?? null;
  const player = useVideoPlayer(playbackUrl, (instance) => {
    // Conservative defaults for v1: muted-off, no autoplay. The user taps
    // the native play control to start the HLS stream.
    instance.loop = false;
  });

  if (loading) {
    return <SkeletonScreen testID="exercise-detail-loading" count={5} />;
  }

  if (error || !detail) {
    return (
      <View
        style={[styles.screen, styles.center]}
        testID="exercise-detail-error"
      >
        <Text style={styles.errorText}>{error ?? 'Exercise not found.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      testID="exercise-detail-screen"
    >
      <Text style={styles.title}>{detail.name}</Text>
      <Text style={styles.meta}>
        {[detail.primaryMuscle, detail.category, detail.difficulty]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {playbackUrl ? (
        <VideoView
          style={styles.player}
          player={player}
          allowsFullscreen
          allowsPictureInPicture
          testID="exercise-detail-player"
        />
      ) : (
        <View style={styles.noVideo} testID="exercise-detail-no-video">
          <Text style={styles.noVideoText}>Video not yet available.</Text>
        </View>
      )}

      {detail.equipment.length > 0 ? (
        <View style={styles.facetBlock}>
          <Text style={styles.facetLabel}>Equipment</Text>
          <Text style={styles.facetValue}>{detail.equipment.join(', ')}</Text>
        </View>
      ) : null}

      {detail.secondaryMuscles.length > 0 ? (
        <View style={styles.facetBlock}>
          <Text style={styles.facetLabel}>Also works</Text>
          <Text style={styles.facetValue}>
            {detail.secondaryMuscles.join(', ')}
          </Text>
        </View>
      ) : null}

      {detail.instructions.length > 0 ? (
        <View style={styles.instructionsBlock}>
          <Text style={styles.facetLabel}>Instructions</Text>
          {detail.instructions.map((step, i) => (
            <View key={`${i}-${step.slice(0, 16)}`} style={styles.stepRow}>
              <Text style={styles.stepIndex}>{i + 1}.</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: sc.bgPrimary,
    },
    scrollContent: {
      padding: spacing.lg,
      paddingBottom: spacing['2xl'],
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      ...typography.h1,
      color: sc.textPrimary,
    },
    meta: {
      ...typography.bodySmall,
      color: sc.textMuted,
      marginTop: spacing.xs,
      marginBottom: spacing.md,
      textTransform: 'capitalize',
    },
    player: {
      width: '100%',
      aspectRatio: 16 / 9,
      backgroundColor: '#000',
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: spacing.lg,
    },
    noVideo: {
      width: '100%',
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
      backgroundColor: sc.bgSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
      borderRadius: 10,
      marginBottom: spacing.lg,
      alignItems: 'center',
    },
    noVideoText: {
      ...typography.bodySmall,
      color: sc.textMuted,
    },
    facetBlock: {
      marginBottom: spacing.md,
    },
    facetLabel: {
      ...typography.eyebrow,
      color: sc.textMuted,
      marginBottom: spacing.xs,
    },
    facetValue: {
      ...typography.body,
      color: sc.textPrimary,
      textTransform: 'capitalize',
    },
    instructionsBlock: {
      marginTop: spacing.sm,
    },
    stepRow: {
      flexDirection: 'row',
      marginTop: spacing.sm,
    },
    stepIndex: {
      ...typography.bodyMd,
      color: sc.accent,
      width: 24,
    },
    stepText: {
      ...typography.body,
      color: sc.textPrimary,
      flex: 1,
    },
    errorText: {
      ...typography.body,
      color: sc.accent,
      textAlign: 'center',
    },
  });
}
