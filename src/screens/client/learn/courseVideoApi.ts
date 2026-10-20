/** LEARN-M6 (flag learnCourses; plan 8.A PR 6; contract: OPERATOR RULING 6282886845 items 4 and 5): a course lesson's video address and
 * its saved place. The address expires and carries access, so it lives in component state only, never in the persisted query cache. */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../services/api';
import { isConnectionFailure } from '../../../ui/states/QuietStates';
import { quiet } from './courseData';

/** GET /v1/client/lessons/:id/video → { url, expires_at }. The server answers only for the caller's own enrolment, a published course, an
 * open week and a lesson with a video (404 otherwise). An address that is not https is refused. expires_at is null for a coach's own
 * video link: it never expires, so it is replaced only when the player reports an error. */
export async function lessonVideo(lessonId: string): Promise<{ url: string; expiresAt: number }> {
  const { data } = await api.get<{ url?: unknown; expires_at?: unknown }>(`/v1/client/lessons/${encodeURIComponent(lessonId)}/video`, quiet);
  if (typeof data?.url !== 'string' || !data.url.startsWith('https://')) throw new Error('no playback address');
  return { url: data.url, expiresAt: Date.parse(String(data.expires_at)) || Infinity };
}

/** PUT /v1/client/lessons/:id/position with { position_seconds }, whole seconds. Best effort: a missed save only means resuming earlier. */
export async function savePosition(lessonId: string, seconds: number): Promise<void> {
  try { await api.put(`/v1/client/lessons/${encodeURIComponent(lessonId)}/position`, { position_seconds: Math.max(0, Math.floor(seconds)) }, quiet); } catch { /* resume falls back to the last saved place */ }
}

/** How the player words a refused or expired address: iOS "HTTP 403: Forbidden", Android "Response code: 403". */
const refused = (message: string) => /\b40[13]\b|forbidden|unauthori[sz]ed|expired/i.test(message);
const WAIT = { url: null, failed: null } as const;

/** The address to play. It is asked only while online and kept once found, so a dropped signal never stops a lesson that is playing.
 * When the player fails, an expired or refused address is replaced once, quietly, and plays on from the same place; any other failure
 * is the failed frame ('connection' when the server gave no answer or the video stopped, 'other' when it answered without an address),
 * and Try again asks for a fresh address. */
export function useLessonVideo(lessonId: string, online: boolean) {
  const [state, setState] = useState<{ url: string | null; failed: 'connection' | 'other' | null }>(WAIT);
  const expiresAt = useRef(0);
  const quietLeft = useRef(true); // one quiet replacement per Try again, so a server that keeps refusing ends at Try again, never a loop
  const waiting = !state.url && !state.failed;
  useEffect(() => {
    if (!online || !waiting) return;
    let live = true;
    lessonVideo(lessonId).then(
      (v) => { if (live) { expiresAt.current = v.expiresAt; setState({ url: v.url, failed: null }); } },
      (err) => { if (live) setState({ url: null, failed: isConnectionFailure(err) ? 'connection' : 'other' }); },
    );
    return () => { live = false; };
  }, [lessonId, online, waiting]);
  const retry = useCallback(() => { quietLeft.current = true; setState(WAIT); }, []);
  const playerFailed = useCallback((message: string) => {
    const again = quietLeft.current && (Date.now() >= expiresAt.current || refused(message));
    if (again) quietLeft.current = false;
    setState(again ? WAIT : { url: null, failed: 'connection' });
  }, []);
  return { ...state, retry, playerFailed };
}
