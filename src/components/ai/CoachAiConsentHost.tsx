/**
 * CoachAiConsentHost (COACH-AI-CONSENT, owner ruling op 2 item 2): beside the coach tabs, so it
 * opens over coach Home. At app open (CoachNavigator mounts afresh on cold start, sign-in and
 * account switch) it reads GET /me/ai-consent/coach once; only a coach the server says was never
 * asked (`asked` false) sees CoachAiConsentSheet. Allow grants; Not now declines, so the server
 * never asks again on open, on any device. A sub-coach (no coach Roman routes), a status that does
 * not load, and the run in which this account just signed up (the box was the ask) show nothing.
 */
import React, { useEffect, useState } from 'react';
import CoachAiConsentSheet from './CoachAiConsentSheet';
import { coachAiConsentApi, coachAskedAtSignUp, type CoachAiConsentApi } from '../../api/coachAiConsentApi';
import { readUserCacheSync } from '../../lib/userCache';
import { logger } from '../../utils/logger';

export interface CoachAiConsentHostProps {
  /** Injected in tests. */
  api?: CoachAiConsentApi;
}

export default function CoachAiConsentHost({ api = coachAiConsentApi }: CoachAiConsentHostProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const user = readUserCacheSync();
    if (user?.role === 'sub_coach' || coachAskedAtSignUp(user?.id)) return undefined;
    let live = true;
    void api.getStatus().then((out) => {
      if (!live) return;
      if (out.kind === 'ok' && !out.status.asked) setOpen(true);
      else if (out.kind !== 'ok') logger.warn('CoachAiConsentHost.status', out.kind);
    });
    return () => {
      live = false;
    };
  }, [api]);

  return (
    <CoachAiConsentSheet
      visible={open}
      api={api}
      onGranted={() => setOpen(false)}
      onClose={() => setOpen(false)}
      testID="coach-ai-consent-once"
    />
  );
}
