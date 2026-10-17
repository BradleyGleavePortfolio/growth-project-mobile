/**
 * CoachAiConsentHost (COACH-AI-CONSENT, owner op 2 item 2): beside the coach tabs; at app open the sheet
 * opens over coach Home only for a coach the server says was never asked (`asked` false). Not for a
 * sub-coach, a status that does not load, or the run the account signed up in (the box was the ask).
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
