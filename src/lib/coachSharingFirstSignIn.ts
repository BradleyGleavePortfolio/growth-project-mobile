/**
 * Coach sharing on the first onboarding screen (B-SHARE-GUEST-127), for an
 * account linked to its coach outside the app (a share-link buyer). The
 * screen prints the same sentence as the in-app join (same version) on the
 * screen the client taps through anyway, and records the four shares on that
 * tap. Never a separate step. Against a backend without the route nothing is
 * shown or sent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptFirstSignInSharing,
  readFirstSignInSharing,
  type FirstSignInSharing,
} from '../api/coachSharingApi';
import { COACH_SHARING_NOTICE_VERSION } from './coachSharingNotice';

export type { FirstSignInSharing };

/** GET: the sentence to print (this build's version), or null. */
export const readFirstSignInCoachSharing = (): Promise<FirstSignInSharing | null> =>
  readFirstSignInSharing(COACH_SHARING_NOTICE_VERSION);

/** POST on the tap under the sentence. */
export const acceptFirstSignInCoachSharing = (version: string): Promise<boolean> =>
  acceptFirstSignInSharing(version);

/**
 * `notice`: what to print (null: print nothing). `accept()`: call on the tap
 * that moves on from the screen; sends once, only when the sentence was shown.
 */
export function useFirstSignInCoachSharing(): { notice: FirstSignInSharing | null; accept: () => void } {
  const [notice, setNotice] = useState<FirstSignInSharing | null>(null);
  const shown = useRef<FirstSignInSharing | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    let live = true;
    void readFirstSignInCoachSharing().then((n) => {
      if (!live) return;
      shown.current = n;
      setNotice(n);
    });
    return () => {
      live = false;
    };
  }, []);
  const accept = useCallback(() => {
    const n = shown.current;
    if (!n || sent.current) return;
    sent.current = true;
    void acceptFirstSignInCoachSharing(n.version);
  }, []);
  return { notice, accept };
}
