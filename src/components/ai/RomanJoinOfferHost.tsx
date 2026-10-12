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
import AiConsentSheet, { type AiConsentSheetApi } from './AiConsentSheet';
import defaultAiConsentApi, { type AiConsentOutcome } from '../../api/aiConsentApi';
import { isLiveRomanGrant } from '../../lib/consultation/aiConsent';
import { finishRomanJoinOffer, romanJoinOfferDue, subscribeRomanJoinOffer } from '../../lib/romanJoinOffer';
import { readUserCacheSync } from '../../lib/userCache';
import { JOIN_SHEET_HANDOFF_MS } from '../join/JoinPackageHost';
import { HapticService } from '../../ui/haptics/haptics.service';
import { logger } from '../../utils/logger';

/** After the package sheet's own handoff, so the two never open at once. */
export const ROMAN_JOIN_OFFER_DELAY_MS = JOIN_SHEET_HANDOFF_MS * 2;

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
