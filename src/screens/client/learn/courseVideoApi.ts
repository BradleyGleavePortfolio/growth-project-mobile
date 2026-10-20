/** LEARN-M6 (flag learnCourses; plan 8.A PR 6): a lesson's playback address and its saved place. Signed addresses expire and carry
 * access, so they live in component state only, never in the persisted query cache. */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../services/api';
import type { CourseLesson } from './courseData';

const https = (v: unknown): v is string => typeof v === 'string' && v.startsWith('https://');

/** GET /v1/client/media/:id/signed-url → { url }; the server signs only for a client who may watch the asset. */
export async function signedUrl(mediaId: string): Promise<string> {
  const { data } = await api.get<{ url?: unknown }>(`/v1/client/media/${encodeURIComponent(mediaId)}/signed-url`);
  if (!https(data?.url)) throw new Error('no playback address');
  return data.url;
}

/** PUT /v1/client/lessons/:id/position, whole seconds. Best effort: a missed save only means resuming a little earlier. */
export async function savePosition(lessonId: string, seconds: number): Promise<void> {
  try { await api.put(`/v1/client/lessons/${encodeURIComponent(lessonId)}/position`, { position_seconds: Math.max(0, Math.floor(seconds)) }); } catch { /* resume falls back to the last saved place */ }
}

/** The address to play: the signed one for the lesson's media, else the lesson's own video address. It is asked only while online, and
 * once found it is kept, so a dropped signal never interrupts a lesson that is playing. */
export function usePlaybackUrl(lesson: Pick<CourseLesson, 'mediaId' | 'videoUrl'>, online: boolean) {
  const { mediaId, videoUrl } = lesson;
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const have = useRef(false);
  useEffect(() => {
    if (!online || have.current) return;
    let live = true;
    const fallback = https(videoUrl) ? videoUrl : null;
    (mediaId ? signedUrl(mediaId).catch(() => fallback) : Promise.resolve(fallback)).then((url) => {
      if (!live) return;
      have.current = !!url;
      setState({ url, failed: !url });
    });
    return () => { live = false; };
  }, [mediaId, videoUrl, online, attempt]);
  const retry = useCallback(() => { have.current = false; setState({ url: null, failed: false }); setAttempt((n) => n + 1); }, []);
  return { ...state, retry };
}
