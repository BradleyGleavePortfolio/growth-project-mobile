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
 * net (the inline refusal row).
 *
 * Coaches (COACH-AI-CONSENT, owner op 2 item 3): the gate wraps the coach room and reads the
 * coach's own grant (GET /me/ai-consent/coach) once. Never asked, Not now or turned off shows the
 * CAC-5 "Roman is off" state instead, whose button opens the same request (CoachAiConsentSheet).
 * A status that does not load leaves the room open. Once the room is open it is never taken away:
 * the server's typed refusal on a send shows CAC-5 inside the room (AiRefusalNotice), with the draft.
 */
import React, { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';
import AiConsentSheet, { type AiConsentSheetApi } from '../ai/AiConsentSheet';
import CoachAiConsentSheet from '../ai/CoachAiConsentSheet';
import JoinCoachState from '../coachless/JoinCoachState';
import defaultAiConsentApi from '../../api/aiConsentApi';
import { coachAiConsentApi, type CoachAiConsentApi } from '../../api/coachAiConsentApi';
import { isLiveRomanGrant } from '../../lib/consultation/aiConsent';
import { COACH_AI_CONSENT_COPY } from '../../lib/ai/coachAiConsentCopy';
import { logger } from '../../utils/logger';
import { Screen, ScreenTopBar } from '../../ui';
import RomanLoadingSkeleton from './RomanLoadingSkeleton';

export interface RomanConsentGateProps {
  surface: 'client' | 'coach';
  /** Injected in tests. */
  api?: AiConsentSheetApi;
  /** Coach surface: the room, shown while the coach's Roman is on. */
  children?: React.ReactNode;
  /** Injected in tests (coach surface). */
  coachApi?: CoachAiConsentApi;
  testID?: string;
}

export default function RomanConsentGate(props: RomanConsentGateProps): React.ReactElement | null {
  return props.surface === 'coach' ? <CoachRomanGate {...props} /> : <ClientRomanGate {...props} />;
}

function ClientRomanGate({
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

function CoachRomanGate({ children, coachApi = coachAiConsentApi, testID = 'roman-consent-gate' }: RomanConsentGateProps) {
  const navigation = useContext(NavigationContext);
  // null while the first read is out (no flash of the room); an unreadable status keeps the room.
  const [off, setOff] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    void coachApi.getStatus().then((out) => live && setOff(out.kind === 'ok' && !out.status.granted));
    return () => {
      live = false;
    };
  }, [coachApi]);

  if (off === null) {
    return (
      <Screen
        edges={['top']}
        scroll={false}
        header={<ScreenTopBar onBack={navigation ? () => navigation.goBack() : undefined} />}
        testID={`${testID}-loading`}
      >
        <RomanLoadingSkeleton />
      </Screen>
    );
  }
  if (!off) return <>{children}</>;
  const { title, body, button } = COACH_AI_CONSENT_COPY.off;
  return (
    <>
      <JoinCoachState
        roman
        title={title}
        body={body}
        action={{ label: button, onPress: () => setAsking(true) }}
        onBack={navigation ? () => navigation.goBack() : undefined}
        testID={`${testID}-off`}
      />
      <CoachAiConsentSheet
        visible={asking}
        api={coachApi}
        onGranted={() => {
          setAsking(false);
          setOff(false);
        }}
        onClose={() => setAsking(false)}
        testID={`${testID}-sheet`}
      />
    </>
  );
}
