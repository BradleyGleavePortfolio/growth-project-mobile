/**
 * Resolve the best available media reference for an exercise demo.
 *
 * Order of preference, honest about what we have:
 *   1. `video_url` — direct mp4 served by the backend (PR #214). Used when
 *      a real video pipeline is wired up.
 *   2. `mux_playback_id` — HLS via Mux. Builds the well-known stream URL.
 *   3. `gifUrl` — ExerciseDB animated thumbnail. Always present for real
 *      ExerciseDB ids; empty string for `seed:` rows.
 *   4. `null` — nothing to show. Callers render the static placeholder and
 *      surface the written instructions instead of a fabricated video.
 *
 * Never returns a stub or placeholder URL — null is the explicit signal
 * that "this exercise has no demo media yet", which keeps coach-vs-client
 * expectations honest in pre-TestFlight.
 */

export type ExerciseMediaKind = 'video' | 'gif' | 'none';

export interface ExerciseMediaSource {
  kind: ExerciseMediaKind;
  uri: string | null;
}

interface ExerciseMediaInput {
  gifUrl?: string | null;
  video_url?: string | null;
  mux_playback_id?: string | null;
}

export function resolveExerciseMedia(
  ex: ExerciseMediaInput | null | undefined,
): ExerciseMediaSource {
  if (!ex) return { kind: 'none', uri: null };

  if (ex.video_url && ex.video_url.trim()) {
    return { kind: 'video', uri: ex.video_url.trim() };
  }

  const playbackId = ex.mux_playback_id?.trim();
  if (playbackId) {
    return {
      kind: 'video',
      uri: `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8`,
    };
  }

  const gif = ex.gifUrl?.trim();
  if (gif) return { kind: 'gif', uri: gif };

  return { kind: 'none', uri: null };
}
