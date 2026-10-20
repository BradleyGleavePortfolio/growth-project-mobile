/** LEARN-M6, board c07 (flag learnCourses; plan 8.A PR 6): a video lesson's player (expo-video, native controls, fullscreen).
 * It plays the lesson's address (courseVideoApi), starts at the place saved on the server, and saves the place on pause, every 15 s
 * while playing and on leaving; a finished video saves 0, so a rewatch starts at the start. The frame is dark from the first draw.
 * A video that stops with an error shows the failed sentence with Try again, never a dead frame. Offline: the frame waits, with the
 * approved offline line when the page has no footer to say it. */
import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { QuietError } from '../../../ui/states/QuietStates';
import { savePosition, useLessonVideo } from './courseVideoApi';
import type { CourseLesson } from './courseData';

const SAVE_EVERY_S = 15;
/** A stop in the last second is the finish (whichever native event comes first), so it saves 0. */
const finishedIs0 = (at: number, length: number) => (length > 0 && at >= length - 1 ? 0 : at);

interface Props {
  lesson: Pick<CourseLesson, 'id' | 'title' | 'positionSeconds'>;
  online: boolean;
  /** The frame's sentences: waiting offline (only when the page shows no footer reason), no address from the server, and no answer or
   * a video that stopped. */
  offline?: string;
  failed: string;
  noAnswer: string;
  onPosition?: (seconds: number) => void;
}

type PlayingProps = { url: string; lesson: Props['lesson']; place: React.MutableRefObject<number>; onPosition?: (s: number) => void; onFailed: (message: string) => void };

/** `place` is where it last was; it outlives this player, so a fresh address plays on from there. */
function Playing({ url, lesson, place, onPosition, onFailed }: PlayingProps) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const saved = useRef(place.current);
  const ended = useRef(false);
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.timeUpdateEventInterval = SAVE_EVERY_S; if (place.current > 0) p.currentTime = place.current; });
  const save = (seconds: number) => {
    place.current = seconds;
    if (Math.floor(seconds) === saved.current) return;
    saved.current = Math.floor(seconds);
    onPosition?.(saved.current);
    void savePosition(lesson.id, seconds);
  };
  const latest = useRef({ save, onFailed }); latest.current = { save, onFailed };
  useEffect(() => {
    const subs = [
      player.addListener('timeUpdate', ({ currentTime }) => { if (ended.current) return; place.current = currentTime; if (player.playing) latest.current.save(currentTime); }),
      player.addListener('playingChange', ({ isPlaying }) => {
        if (isPlaying) { ended.current = false; return; }
        if (!ended.current) latest.current.save(finishedIs0(player.currentTime, player.duration));
      }),
      player.addListener('playToEnd', () => { ended.current = true; latest.current.save(0); }),
      player.addListener('statusChange', ({ status, error }) => { if (status === 'error') latest.current.onFailed(error?.message ?? ''); }),
    ];
    return () => {
      subs.forEach((x) => x.remove());
      try { if (!ended.current && player.currentTime > 0) place.current = finishedIs0(player.currentTime, player.duration); } catch { /* the native player is already released */ }
      latest.current.save(place.current);
    };
  }, [player, place]);
  return <VideoView style={[s.frame, s.dark]} player={player} fullscreenOptions={{ enable: true }} allowsPictureInPicture accessibilityLabel={lesson.title} testID="course-video" />;
}

export default function CourseVideoPlayer({ lesson, online, offline, failed, noAnswer, onPosition }: Props) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const video = useLessonVideo(lesson.id, online);
  const place = useRef(lesson.positionSeconds);
  if (video.url) return <Playing url={video.url} lesson={lesson} place={place} onPosition={onPosition} onFailed={video.playerFailed} />;
  if (video.failed) {
    return <View style={[s.frame, s.pad, s.card]} testID="course-video-failed"><QuietError layout="inline" message={video.failed === 'connection' ? noAnswer : failed} onRetry={video.retry} /></View>;
  }
  const line = online ? null : offline;
  return (
    <View style={[s.frame, s.dark, s.pad]} accessible accessibilityLabel={line ?? lesson.title} accessibilityState={{ busy: online }} testID="course-video-waiting">
      {online ? <ActivityIndicator color={sc.textOnMastheadMuted} /> : line ? <Text style={s.ink}>{line}</Text> : null}
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.card, overflow: 'hidden', backgroundColor: sc.bgSurface, marginBottom: 16, alignItems: 'center', justifyContent: 'center' },
  dark: { backgroundColor: sc.surface.masthead },
  pad: { padding: 16 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  ink: { ...typography.bodySmall, color: sc.textOnMastheadMuted, textAlign: 'center' },
});
