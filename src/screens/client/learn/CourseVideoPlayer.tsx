/** LEARN-M6, board c07 (flag learnCourses; plan 8.A PR 6): a video lesson's player (expo-video, native controls, fullscreen and rotation).
 * It plays the signed address for the lesson's media, starts at the place saved on the server, and saves the place on pause, every 15 s
 * while playing, and on leaving. Offline: the frame waits, with the approved offline line when the page has no footer to say it. */
import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { QuietError } from '../../../ui/states/QuietStates';
import { savePosition, usePlaybackUrl } from './courseVideoApi';
import type { CourseLesson } from './courseData';

const SAVE_EVERY_S = 15;

interface Props {
  lesson: Pick<CourseLesson, 'id' | 'title' | 'mediaId' | 'videoUrl' | 'positionSeconds'>;
  online: boolean;
  /** The sentences for the frame: waiting offline (only when the page shows no footer reason) and a video that did not start. */
  offline?: string;
  failed: string;
  onPosition?: (seconds: number) => void;
}

function Playing({ url, lesson, onPosition }: { url: string; lesson: Props['lesson']; onPosition?: (s: number) => void }) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const place = useRef(lesson.positionSeconds); // where it last was; read on leaving, when the native player may already be gone
  const saved = useRef(lesson.positionSeconds);
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.timeUpdateEventInterval = SAVE_EVERY_S; if (place.current > 0) p.currentTime = place.current; });
  const save = (seconds: number) => {
    place.current = seconds;
    if (Math.floor(seconds) === saved.current) return;
    saved.current = Math.floor(seconds);
    onPosition?.(saved.current);
    void savePosition(lesson.id, seconds);
  };
  const latest = useRef(save); latest.current = save;
  useEffect(() => {
    const subs = [
      player.addListener('timeUpdate', ({ currentTime }) => { place.current = currentTime; if (player.playing) latest.current(currentTime); }),
      player.addListener('playingChange', ({ isPlaying }) => { if (!isPlaying) latest.current(player.currentTime); }),
    ];
    return () => {
      subs.forEach((x) => x.remove());
      try { if (player.currentTime > 0) place.current = player.currentTime; } catch { /* the native player is already released */ }
      latest.current(place.current);
    };
  }, [player]);
  return <VideoView style={[s.frame, s.dark]} player={player} fullscreenOptions={{ enable: true }} allowsPictureInPicture accessibilityLabel={lesson.title} testID="course-video" />;
}

export default function CourseVideoPlayer({ lesson, online, offline, failed, onPosition }: Props) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const { url, failed: broke, retry } = usePlaybackUrl(lesson, online);
  if (url) return <Playing url={url} lesson={lesson} onPosition={onPosition} />;
  if (broke) return <View style={[s.frame, s.pad]} testID="course-video-failed"><QuietError layout="inline" message={failed} onRetry={retry} /></View>;
  return (
    <View style={[s.frame, s.pad]} accessibilityState={{ busy: online }} testID="course-video-waiting">
      {online ? <ActivityIndicator color={sc.textMuted} /> : offline ? <Text style={s.ink}>{offline}</Text> : null}
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.card, overflow: 'hidden', backgroundColor: sc.bgSurface, marginBottom: 16, alignItems: 'center', justifyContent: 'center' },
  dark: { backgroundColor: sc.surface.masthead },
  pad: { padding: 16 },
  ink: { ...typography.bodySmall, color: sc.textPrimary, textAlign: 'center' },
});
