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
 *
 * REFINE-986: the screen sets its own bar as C2_detail draws it (rows 130-161), for every way in: no title and no
 * back label, and the drawn play control at the right only while a demonstration can show (a tap scrolls to it and
 * starts a video). ClientNavigator.tsx keeps the registration as it was.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { exerciseCatalogApi } from '../../api/exerciseCatalog';
import type { ExerciseDetail } from '../../types/exerciseCatalog';
import { layout, radius, spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import HapticPressable from '../../components/HapticPressable';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';
import { sectionHead } from './workouts/workoutStyleC';
import { exerciseHistoryApi, type ExerciseHistory } from '../../api/exerciseHistoryApi';
import { ExerciseHistoryStyleC } from './workouts/exerciseHistoryStyleC';
import { isBodyWeightEquipment } from '../../utils/workout/bodyWeight';

type Props = NativeStackScreenProps<WorkoutStackParamList, 'ExerciseDetail'>;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
/**
 * The meta line as C2_detail draws it (rows 287-307, "Chest · Barbell"): the body part and the first equipment, each
 * with a capital first letter; one of them alone; the two equal, once. With neither, main's line exactly.
 */
export function metaLine(d: Pick<ExerciseDetail, 'primaryMuscle' | 'category' | 'difficulty' | 'equipment'>): string {
  const facts = [d.category, (d.equipment ?? [])[0]].map((x) => (x ?? '').trim()).filter(Boolean);
  if (facts.length === 0) return [d.primaryMuscle, d.category, d.difficulty].filter(Boolean).join(' · ');
  const once = facts.length === 2 && facts[0].toLowerCase() === facts[1].toLowerCase() ? [facts[0]] : facts;
  return once.map(capital).join(' · ');
}

/** C2_detail's play triangle (cols 703-726, rows 130-161: 15.5 pt tall) in a 44 pt box at the bar's right. */
function PlayControl({ onPress, color }: { onPress: () => void; color: string }) {
  return (
    <HapticPressable
      disableAnimation onPress={onPress} accessibilityRole="button" accessibilityLabel="Play demonstration"
      testID="exercise-detail-play" style={playBox.box}
    >
      <Ionicons name="play-outline" size={21} color={color} />
    </HapticPressable>
  );
}
const playBox = StyleSheet.create({
  box: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
});

export default function ExerciseDetailScreen({ route, navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const { idOrSlug } = route.params;
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  // 'missing': the library has no details for this id (404, W3);
  // 'failed': no network, a timeout, a 5xx or a refusal (Retry helps).
  const [error, setError] = useState<'missing' | 'failed' | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  // WORKOUT-DETAIL-M: the client's own history of this exercise (null while it loads, after a failure, or never).
  const [history, setHistory] = useState<ExerciseHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMediaFailed(false);
    setHistory(null);
    exerciseCatalogApi
      .getDetail(idOrSlug)
      .then((res) => {
        if (cancelled) return;
        const next = res.data as ExerciseDetail;
        setDetail(next);
        // Read by the page's name once the catalog answers; never awaited, so the page draws as before meanwhile
        // and draws none of it when the read fails.
        exerciseHistoryApi.get(next.name).then(
          (answer) => {
            if (!cancelled) setHistory(answer);
          },
          () => undefined,
        );
      })
      .catch((err) => {
        if (!cancelled) {
          const status = (err as { response?: { status?: number } } | null)?.response?.status;
          setError(status === 404 ? 'missing' : 'failed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idOrSlug, attempt]);

  // Always call useVideoPlayer (hook contract). We pass null when there is
  // no URL — the player simply sits idle in that case.
  const playbackUrl = detail?.playbackUrl ?? null;
  const player = useVideoPlayer(playbackUrl, (instance) => {
    // Conservative defaults for v1: muted-off, no autoplay. The user taps
    // the native play control to start the HLS stream.
    instance.loop = false;
  });
  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setMediaFailed(true);
    });
    return () => subscription.remove();
  }, [player]);

  // The bar (C2_detail rows 130-161): no title (the page's own title is its spoken header) and a back with no label.
  useLayoutEffect(() => {
    navigation.setOptions({ title: '', headerBackButtonDisplayMode: 'minimal' });
  }, [navigation]);
  // The play control: only while the player or the animation can show (never a dead tap); a tap scrolls the page to
  // the demonstration and starts a video. Unset in every other state.
  const scrollRef = useRef<ScrollView>(null);
  const demoY = useRef(0);
  const demo = !loading && !error && detail && !mediaFailed
    ? (playbackUrl ? 'video' : detail.gifUrl ? 'animation' : null)
    : null;
  const play = useRef<() => void>(() => undefined);
  play.current = () => {
    scrollRef.current?.scrollTo({ y: demoY.current, animated: true });
    if (demo === 'video') player.play();
  };
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: demo ? () => <PlayControl onPress={() => play.current()} color={sc.textPrimary} /> : undefined,
    });
  }, [navigation, demo, sc]);
  const onDemoLayout = (e: LayoutChangeEvent) => {
    demoY.current = e.nativeEvent.layout.y;
  };

  if (loading) {
    return <SkeletonScreen testID="exercise-detail-loading" count={5} />;
  }

  if (error === 'missing') {
    return (
      <View style={[styles.screen, styles.center, styles.stateBody]} testID="exercise-detail-missing">
        <Text style={styles.errorText}>No details for this exercise yet.</Text>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View
        style={[styles.screen, styles.center, styles.stateBody]}
        testID="exercise-detail-error"
      >
        <Text style={styles.errorText}>
          {error ? 'Exercise details did not load. Check your connection and try again.' : 'Exercise not found.'}
        </Text>
        <HapticPressable disableAnimation style={styles.retry} accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)}>
          <Text style={styles.retryText}>Retry</Text>
        </HapticPressable>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      testID="exercise-detail-screen"
    >
      <Text style={styles.title} accessibilityRole="header">{detail.name}</Text>
      <Text style={styles.meta}>{metaLine(detail)}</Text>

      {history ? (
        <ExerciseHistoryStyleC history={history} bodyWeight={detail.equipment.some(isBodyWeightEquipment)} />
      ) : null}

      {playbackUrl && !mediaFailed ? (
        <VideoView
          style={styles.player}
          player={player}
          // SDK 56: 'allowsFullscreen' was replaced with 'fullscreenOptions.enable'.
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
          onLayout={onDemoLayout}
          testID="exercise-detail-player"
        />
      ) : detail.gifUrl && !mediaFailed ? (
        <Image
          source={{ uri: detail.gifUrl }}
          style={styles.player}
          resizeMode="contain"
          accessibilityLabel={`${detail.name} demonstration`}
          onError={() => setMediaFailed(true)}
          onLayout={onDemoLayout}
          testID="exercise-detail-animation"
        />
      ) : (
        <View style={styles.noVideo} testID="exercise-detail-no-video">
          <Text style={styles.noVideoText}>
            {mediaFailed
              ? detail.instructions.length > 0
                ? 'The demonstration did not load. Follow the instructions below.'
                : 'The demonstration did not load.'
              : 'No demonstration available for this exercise.'}
          </Text>
        </View>
      )}

      {detail.primaryMuscle || detail.secondaryMuscles.length > 0 ? (
        <View>
          <Text style={styles.sectionHead}>MUSCLES</Text>
          {detail.primaryMuscle ? <Text style={styles.facetValue}>{detail.primaryMuscle}</Text> : null}
          {detail.secondaryMuscles.length > 0 ? (
            <Text style={styles.alsoWorks}>Also works: {detail.secondaryMuscles.join(', ')}</Text>
          ) : null}
        </View>
      ) : null}

      {detail.equipment.length > 0 ? (
        <View>
          <Text style={styles.sectionHead}>EQUIPMENT</Text>
          <Text style={styles.facetValue}>{detail.equipment.join(', ')}</Text>
        </View>
      ) : null}

      {detail.instructions.length > 0 ? (
        <View>
          <Text style={styles.sectionHead}>HOW TO</Text>
          <View style={styles.steps}>
            {detail.instructions.map((step, i) => (
              <View key={`${i}-${step.slice(0, 16)}`} style={styles.stepRow}>
                <Text style={styles.stepIndex}>{i + 1}.</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>
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
    // C2_detail (STYLE-WORKOUTS-M): the title and every section start at col 48 of the 2x frame, a 24 pt gutter.
    // REFINE-986: the title's ink 15 pt under the bar (the frame's bar ends at 91 pt, ink row 212).
    scrollContent: {
      paddingHorizontal: layout.gutter,
      paddingTop: spacing.sm,
      paddingBottom: spacing['3xl'],
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    stateBody: {
      paddingHorizontal: spacing.lg,
    },
    // The drawn letters sit 0.7 pt closer than h1's 0.6 (cols 50-335 against 50-349, the same glyph widths).
    title: {
      ...typography.h1,
      letterSpacing: 0,
      color: sc.textPrimary,
    },
    // Title ink row 212 to meta ink row 287 (37.5 pt): no margin above the meta line.
    meta: {
      ...typography.bodySmall,
      color: sc.textMuted,
      marginTop: 0,
      marginBottom: spacing.md,
    },
    player: {
      width: '100%',
      aspectRatio: 16 / 9,
      backgroundColor: sc.bgPrimary,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    // The demonstration's caption; the next section's own rule follows it (C2_detail rows 868-891).
    noVideo: {
      width: '100%',
      paddingVertical: spacing.md,
    },
    noVideoText: {
      ...typography.bodySmall,
      color: sc.textMuted,
    },
    // Inside a section the second line follows the value; the next section's 18 pt is the only gap after it.
    alsoWorks: {
      ...typography.bodySmall,
      color: sc.textMuted,
      marginTop: spacing.xs,
    },
    // MUSCLES, EQUIPMENT and HOW TO in C2_detail's "YOUR HISTORY" look: eyebrow over its own hairline.
    sectionHead: sectionHead(sc),
    facetValue: {
      ...typography.body,
      color: sc.textPrimary,
    },
    steps: {
      gap: spacing.md,
    },
    stepRow: {
      flexDirection: 'row',
    },
    stepIndex: {
      ...typography.bodyMd,
      color: sc.textMuted,
      fontVariant: ['tabular-nums'],
      width: 24,
    },
    stepText: {
      ...typography.body,
      color: sc.textPrimary,
      flex: 1,
    },
    errorText: {
      ...typography.body,
      color: sc.textPrimary,
      textAlign: 'center',
    },
    retry: {
      minHeight: 44,
      minWidth: 120,
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.button,
      backgroundColor: sc.accent,
    },
    retryText: {
      ...typography.bodyMd,
      color: sc.textOnAccent,
    },
  });
}
