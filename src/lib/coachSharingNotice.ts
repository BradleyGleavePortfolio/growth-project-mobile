/**
 * Coach sharing at join (B-SHARE-127). Every screen where a client joins a
 * coach prints one sentence directly above the button they already tap and
 * sends its version as `coach_sharing_notice` on the same request; the
 * backend records the four fitness shares inside the link only then
 * (backend #827). Shown and sent only when GET /auth/signup-policy
 * advertises exactly this version, so against the current production
 * backend nothing is shown or sent and joining is unchanged.
 */
import { useEffect, useState } from 'react';
import { authApi } from '../services/api';
import { logger } from '../utils/logger';

/** Names the sentence below. A new wording needs a new version on both sides. */
export const COACH_SHARING_NOTICE_VERSION = 'coach_sharing_join_v1';

export function coachSharingNoticeText(coachName?: string | null): string {
  const who = coachName && coachName.trim() ? coachName.trim() : 'your coach';
  return `Joining shares your workouts, food logs, weigh-ins and check-ins with ${who}. Change this any time in Settings > Privacy.`;
}

/** This build's version when the policy body advertises it on the field this build sends; otherwise null. */
export function noticeVersionFromPolicy(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { coach_sharing_notice?: unknown; coach_sharing_notice_field?: unknown };
  if (b.coach_sharing_notice !== COACH_SHARING_NOTICE_VERSION) return null;
  if (b.coach_sharing_notice_field !== undefined && b.coach_sharing_notice_field !== 'coach_sharing_notice') {
    return null;
  }
  return COACH_SHARING_NOTICE_VERSION;
}

let cached: Promise<string | null> | null = null;

/** One policy read per app run; a failed read is retried next time (meanwhile no sentence, no field). */
export function loadCoachSharingNotice(): Promise<string | null> {
  if (!cached) {
    cached = Promise.resolve()
      .then(() => authApi.getSignupPolicy())
      .then(
        (res) => noticeVersionFromPolicy(res?.data),
        (err: unknown) => {
          logger.warn('coachSharingNotice', 'signup policy read failed', err);
          cached = null;
          return null;
        },
      );
  }
  return cached;
}

/** Tests only. */
export function resetCoachSharingNoticeForTests(): void {
  cached = null;
}

/** The version to show and send, or null (show nothing, send nothing). */
export function useCoachSharingNotice(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadCoachSharingNotice().then((v) => {
      if (live) setVersion(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return version;
}
