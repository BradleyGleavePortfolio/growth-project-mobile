/**
 * Coach sharing at join (B-SHARE-127, SHARE-UNWIND). Every screen where a
 * client joins a coach prints one sentence directly above the button they
 * already tap and sends its version as `coach_sharing_notice` on the same
 * request. Workouts, food logs, weigh-ins and check-ins always reach the
 * current coach (owner #SHARE-SIMPLE / #SHARE-JOIN, backend #1061); the
 * sentence says so, and names connected Apple Health / Health Connect data.
 * Shown and sent only when GET /auth/signup-policy advertises exactly this
 * version; otherwise nothing is shown or sent and joining is unchanged.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { authApi } from '../services/api';
import { logger } from '../utils/logger';

/** Names the sentence below. A new wording needs a new version on both sides. */
export const COACH_SHARING_NOTICE_VERSION = 'coach_sharing_join_v1';

/** W-SU-1 (owner #SHARE-JOIN op 1): Android says Health Connect where iPhone says Apple Health. */
export function coachSharingNoticeText(coachName?: string | null): string {
  const who = coachName && coachName.trim() ? coachName.trim() : 'your coach';
  const health = Platform.OS === 'android' ? 'Health Connect' : 'Apple Health';
  return `Joining shares your workouts, food logs, weigh-ins, check-ins and any ${health} data you connect with ${who}. You can stop new ${health} data in your phone's ${health} permissions.`;
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
