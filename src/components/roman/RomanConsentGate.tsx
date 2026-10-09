/**
 * RomanConsentGate — B32, prototype 68 "Before Roman answers".
 *
 * Opening the client Roman room reads the AI consent status once (the same
 * `getStatus` Settings > Privacy > Roman uses). Without a live Roman grant the
 * consent sheet opens BEFORE anything can be sent: Allow records consent
 * through the existing ledger and leaves the room open; Not now (or the
 * Android back gesture) closes Roman calmly and the rest of the app works.
 * Nothing is sent to Anthropic until Allow. When the status cannot be read the
 * gate stays closed and the server's 403 ai_consent_required stays the safety
 * net (the inline refusal row). Coaches never see it.
 */
import React, { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';
import AiConsentSheet, { type AiConsentSheetApi } from '../ai/AiConsentSheet';
import defaultAiConsentApi from '../../api/aiConsentApi';
import { isLiveRomanGrant } from '../../lib/consultation/aiConsent';
import { logger } from '../../utils/logger';

export interface RomanConsentGateProps {
  surface: 'client' | 'coach';
  /** Injected in tests. */
  api?: AiConsentSheetApi;
  testID?: string;
}

export default function RomanConsentGate({
  surface,
  api = defaultAiConsentApi,
  testID = 'roman-consent-gate',
}: RomanConsentGateProps): React.ReactElement | null {
  const navigation = useContext(NavigationContext);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (surface !== 'client') return undefined;
    let live = true;
    api
      .getStatus()
      .then((out) => {
        if (live && out.kind === 'ok' && !isLiveRomanGrant(out.status)) setOpen(true);
      })
      .catch((err: unknown) => {
        // The server still refuses an unconsented turn (403), so a failed read
        // only means the sheet opens from the refusal row instead.
        logger.warn('RomanConsentGate.status', err);
      });
    return () => {
      live = false;
    };
  }, [api, surface]);

  if (surface !== 'client') return null;
  return (
    <AiConsentSheet
      visible={open}
      variant="beforeAnswer"
      api={api}
      onGranted={() => setOpen(false)}
      onClose={() => {
        setOpen(false);
        navigation?.goBack();
      }}
      testID={testID}
    />
  );
}
