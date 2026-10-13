/**
 * RomanJoinOfferHost (owner 62y2): right after a client with no coach joins a coach, the existing
 * AiConsentSheet opens once as "Roman and AI" with "Allow" and "Not now" (`variant="afterJoin"`, the
 * owner's option 1 words) and the coached Roman paragraph and optional box (the server's coached copy,
 * client-ai-v6 / v7). Mounted once beside the client tabs (with JoinPackageHost), it waits until
 * the coach-code and package sheets have closed (`useRomanJoinOfferHold`).
 *
 * Allow records the coached version on the server (the sheet's own grant), Roman is on at once, and a
 * success haptic plays (docs/HAPTICS.md: data saved). Not now (or Close, or Android back) keeps the
 * coached client's not-allowed behaviour; Settings > Privacy > Roman and AI is where they allow it
 * later. Either way the offer is done and never comes back by itself (lib/romanJoinOffer). A client
 * whose Roman grant is already live is not asked; when the status does not load, the sheet opens and
 * shows its own failure and Try again states. A client with no coach is never shown it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AiConsentSheet, { type AiConsentSheetApi } from './AiConsentSheet';
import defaultAiConsentApi, { type AiConsentOutcome } from '../../api/aiConsentApi';
import { isLiveRomanGrant } from '../../lib/consultation/aiConsent';
import { finishRomanJoinOffer, romanJoinOfferDue, subscribeRomanJoinOffer } from '../../lib/romanJoinOffer';
import { patchUserCache, readUserCacheSync } from '../../lib/userCache';
import { authApi } from '../../services/api';
import { JOIN_SHEET_HANDOFF_MS } from '../join/JoinPackageHost';
import { HapticService } from '../../ui/haptics/haptics.service';
import { logger } from '../../utils/logger';

/** After the package sheet's own handoff, so the two never open at once. */
export const ROMAN_JOIN_OFFER_DELAY_MS = JOIN_SHEET_HANDOFF_MS * 2;

/**
 * A web join (coach landing page, storefront or guest checkout) happens on the server while the client
 * may stay signed in here. On opening the client app and on each return from the background, a client
 * cached without a coach re-reads their account (GET /auth/me, the paid in-app join's read); a coach
 * the server confirms goes into the user cache, where the one offer rule (lib/romanJoinOffer) makes the
 * offer due. A client with a coach and a coach account send nothing extra.
 */
export async function learnServerCoach(): Promise<void> {
  const user = readUserCacheSync();
  if (!user?.id || user.coach_id || user.role !== 'student') return;
  const me = ((await authApi.me())?.data ?? {}) as { id?: unknown; coach_id?: unknown };
  const coachId = me.id === user.id && typeof me.coach_id === 'string' ? me.coach_id : '';
  const now = readUserCacheSync();
  // Only for the same signed-in account, still without a coach here; never written after a sign-out.
  if (coachId && now?.id === user.id && !now.coach_id) await patchUserCache({ coach_id: coachId });
}

export interface RomanJoinOfferHostProps {
  /** Injected in tests. */
  api?: AiConsentSheetApi;
}

export default function RomanJoinOfferHost({ api = defaultAiConsentApi }: RomanJoinOfferHostProps) {
  const [openFor, setOpenFor] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      const id = romanJoinOfferDue();
      if (!id) return;
      const user = readUserCacheSync();
      if (user?.id !== id || !user.coach_id) return; // never for a client with no coach
      let out: AiConsentOutcome | null = null;
      try {
        out = await api.getStatus();
      } catch (err) {
        logger.warn('RomanJoinOffer', 'status read failed', err);
      }
      if (!live || romanJoinOfferDue() !== id) return;
      if (out?.kind === 'ok' && out.status && isLiveRomanGrant(out.status)) {
        await finishRomanJoinOffer(id);
        return;
      }
      // Not allowed yet, or the status did not load: the sheet reads it again and shows its own loading,
      // failure and Try again states, so a failed read never drops the choice.
      setOpenFor(id);
    };
    const sync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        check().catch((err: unknown) => logger.warn('RomanJoinOffer', 'offer check failed', err));
      }, ROMAN_JOIN_OFFER_DELAY_MS);
    };
    sync();
    const unsubscribe = subscribeRomanJoinOffer(sync);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [api]);

  // Opening the client app (cold start or sign-in) and each return from the background.
  useEffect(() => {
    const learn = () => {
      learnServerCoach().catch((err: unknown) => logger.warn('RomanJoinOffer', 'account read failed', err));
    };
    learn();
    let away = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') away = true;
      if (state !== 'active' || !away) return;
      away = false;
      learn();
    });
    return () => sub.remove();
  }, []);

  const done = useCallback(() => {
    if (openFor) void finishRomanJoinOffer(openFor);
    setOpenFor(null);
  }, [openFor]);

  const granted = useCallback(() => {
    void HapticService.success();
    done();
  }, [done]);

  if (!openFor) return null;
  return (
    <AiConsentSheet
      visible
      variant="afterJoin"
      api={api}
      onGranted={granted}
      onClose={done}
      testID="roman-join-offer"
    />
  );
}
